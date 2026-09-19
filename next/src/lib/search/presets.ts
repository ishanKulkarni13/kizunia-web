/**
 * Search Core - Presets (CLIENT-SAFE)
 *
 * =============================================================================
 * What a preset is
 * =============================================================================
 *
 * A named starting point for a search: a set of filter values, applied
 * together, that a person can reach for instead of assembling the same four
 * filters by hand every time.
 *
 * A preset is *not* a second way to filter. It produces an ordinary
 * `ParamPatch` over the ordinary filter parameters, applied through the
 * ordinary navigation seam, and the result is a URL indistinguishable from one
 * the same person could have built by clicking the controls. Nothing
 * downstream — the engine, the chips, pagination, the server render — knows
 * presets exist, and that is the property to preserve.
 *
 * =============================================================================
 * Why the active preset is a URL marker
 * =============================================================================
 *
 * Two candidate representations, and the choice matters:
 *
 * 1. *Derive* it — a preset is active when the current filters match its
 *    filters. This makes "refine what a preset gave me" impossible to express:
 *    adding a category, or changing the mode, would silently deactivate the
 *    preset the person deliberately started from. It also cannot distinguish
 *    two presets that happen to encode the same filters.
 *
 * 2. *Record* it — the search remembers which preset seeded it. Refinement
 *    keeps the marker because nothing touched it; selecting another preset
 *    replaces it; clearing every filter removes it. All three behaviours fall
 *    out of the patch semantics rather than needing rules of their own.
 *
 * This module implements the second, in `PRESET_PARAM`. Being in the URL — the
 * same place the rest of the applied search lives — means the marker survives a
 * refresh, a shared link and the back button, which a marker held in component
 * state would not.
 *
 * =============================================================================
 * Trust
 * =============================================================================
 *
 * Platform presets are authored in code. Custom presets come out of the
 * viewer's own `localStorage`, which is hand-editable and may hold anything at
 * all. Every preset therefore passes through `sanitizePresetFilters` on its way
 * into a patch, which discards any parameter the filter registry does not own.
 *
 * That is what makes the promise in `PresetFilters` structural rather than
 * conventional: a preset cannot set `page`, cannot set `sort`, cannot smuggle
 * in an unrelated query parameter, and cannot mark itself active — no matter
 * what is stored under its name.
 */

import { PAGE_PARAM, PRESET_PARAM, type ParamPatch } from "./params";
import { allFilterParams, type FilterSpec, type ValueOfSpec } from "./spec";
import {
  clearAllFiltersPatch,
  readFilterValue,
  writeFilterValue,
} from "./spec-values";
import type { RawSearchParams } from "./types";

// =============================================================================
// Shapes
// =============================================================================

/**
 * A preset's filters, in the same encoded form the URL carries.
 *
 * Deliberately the wire form rather than decoded values. A preset is stored
 * for months and read back by a later build, so it should depend on the
 * *parameter* contract — which is public, shared with every bookmark, and
 * already the thing the codebase is careful about — rather than on the shape
 * of a decoded value, which is an implementation detail free to change.
 *
 * Only set values appear. A key mapped to `undefined` is how the URL layer
 * expresses removal; a preset has nothing to remove, so the type does not
 * admit it.
 */
export type PresetFilters = Readonly<Record<string, string>>;

/** Who owns a preset, and therefore what may be done to it. */
export type PresetKind = "platform" | "custom";

/**
 * Visual metadata, as a name rather than a component.
 *
 * A name survives being moved into a database and sent over the wire, which a
 * React component reference does not — and platform presets are expected to
 * become admin-managed data later. The interface resolves the name; nothing in
 * the application logic reads it.
 */
export type PresetIcon =
  | "sparkles"
  | "globe"
  | "map-pin"
  | "bookmark"
  | "compass"
  | "star";

/**
 * A preset Kizunia maintains.
 *
 * `displayOrder` and `enabled` exist so that changing which presets appear,
 * and in what order, is a data change rather than a code change — including
 * later, when this list is served from somewhere else. A disabled preset stays
 * declared rather than being deleted, so links that reference it degrade to
 * "no preset" instead of to a broken name.
 */
export interface PlatformPreset {
  /** Stable across renames. Appears in URLs, so it must never be recycled. */
  readonly id: string;

  readonly name: string;

  readonly description?: string;

  readonly filters: PresetFilters;

  /** Lower sorts earlier. Declared in steps so one can be inserted between. */
  readonly displayOrder: number;

  readonly enabled: boolean;

  readonly icon?: PresetIcon;
}

/**
 * A preset the viewer saved.
 *
 * The field set is deliberately the one an account-synchronised row would
 * have: a stable id the client generates, a name, the filters, and two
 * timestamps. Nothing here is local-storage-shaped, so moving the persistence
 * behind an API later changes the storage module and nothing else.
 */
export interface CustomPreset {
  /**
   * Generated, never derived from the name — a rename must not orphan a link,
   * and two presets may legitimately share a name.
   */
  readonly id: string;

  readonly name: string;

  readonly filters: PresetFilters;

  /** ISO 8601, UTC. */
  readonly createdAt: string;

  readonly updatedAt: string;
}

/**
 * What the interface is showing as active.
 *
 * Three cases rather than a nullable preset, because "none", "a preset Kizunia
 * owns" and "a preset this browser owns" differ in what the user may do to
 * them: renaming and deleting exist only in the third case, and a component
 * that received a bare preset would have to re-derive which one it had.
 */
export type ActivePreset =
  | { readonly kind: "none" }
  | { readonly kind: "platform"; readonly preset: PlatformPreset }
  | { readonly kind: "custom"; readonly preset: CustomPreset };

/** Shared identity, so nothing re-allocates "nothing is active" per render. */
export const NO_ACTIVE_PRESET: ActivePreset = Object.freeze({ kind: "none" });

/** The minimum a preset must supply to be applied. */
export interface AppliablePreset {
  readonly id: string;

  readonly filters: PresetFilters;
}

// =============================================================================
// Declaring a preset's filters
// =============================================================================

/**
 * One filter value, encoded exactly as the control would have written it.
 *
 * This is the reason a preset definition cannot drift from the filter it
 * targets: the value goes through `writeFilterValue`, so a preset is type
 * checked against its spec's decoded value type, and a change to how that
 * spec is encoded reaches every preset without any of them being edited.
 *
 * Hand-writing `{ modes: "ONLINE" }` would compile just as well and would be
 * exactly the kind of parallel encoding this codebase does not have.
 */
export function presetFilter<TSpec extends FilterSpec>(
  spec: TSpec,
  value: ValueOfSpec<TSpec>,
): ParamPatch {
  return writeFilterValue(spec, value);
}

/**
 * Merges filter patches into the stored form.
 *
 * `writeFilterValue` names every parameter its filter owns, setting the unused
 * ones to `undefined` so that applying it clears whatever was there before.
 * A preset is not applied to anything yet, so those removals are dropped here
 * and re-derived at apply time from the registry — see `applyPresetPatch`.
 */
export function presetFilters(
  ...patches: readonly ParamPatch[]
): PresetFilters {
  const filters: Record<string, string> = {};

  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        filters[key] = value;
      }
    }
  }

  return filters;
}

/**
 * Drops every parameter the registry does not own.
 *
 * The guard between stored data and the URL. A custom preset's filters have
 * been through `localStorage` and are attacker- or accident-editable; without
 * this, a stored `{"page":"9000"}` or `{"preset":"platform:x"}` would be
 * merged into the applied search verbatim.
 *
 * Applied to platform presets too. They are trusted, but a typo in one should
 * produce a preset that does slightly less rather than a parameter nobody
 * meant to introduce.
 */
export function sanitizePresetFilters(
  specs: readonly FilterSpec[],
  filters: PresetFilters,
): PresetFilters {
  const owned = new Set(allFilterParams(specs));

  const kept: Record<string, string> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (owned.has(key) && value.length > 0) {
      kept[key] = value;
    }
  }

  return kept;
}

// =============================================================================
// The URL marker
// =============================================================================

/**
 * Which preset a search was started from.
 *
 * Kind and id together, because the two id spaces are independent: a platform
 * preset's id is a slug chosen by Kizunia and a custom preset's is generated
 * in the browser, and nothing stops them colliding. Encoding the kind also
 * means resolution never has to search both collections to find out what it
 * is holding.
 */
export interface PresetIdentity {
  readonly kind: PresetKind;

  readonly id: string;
}

const PRESET_KINDS: ReadonlySet<string> = new Set<PresetKind>([
  "platform",
  "custom",
]);

/** `platform:online-and-free`, `custom:0f1c…`. */
export function presetToken(identity: PresetIdentity): string {
  return `${identity.kind}:${identity.id}`;
}

/**
 * Reads a token back, rejecting anything malformed.
 *
 * Splits on the first separator only, so an id containing a colon survives
 * intact rather than being silently truncated to its first segment.
 */
export function parsePresetToken(raw: string): PresetIdentity | undefined {
  const separator = raw.indexOf(":");

  if (separator <= 0 || separator === raw.length - 1) {
    return undefined;
  }

  const kind = raw.slice(0, separator);

  if (!PRESET_KINDS.has(kind)) {
    return undefined;
  }

  return { kind: kind as PresetKind, id: raw.slice(separator + 1) };
}

/** The identity named by the current URL, if it names a well-formed one. */
export function readPresetIdentity(
  params: RawSearchParams,
): PresetIdentity | undefined {
  const raw = params[PRESET_PARAM];

  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? parsePresetToken(trimmed) : undefined;
}

export interface PresetCatalog {
  readonly platformPresets: readonly PlatformPreset[];

  readonly customPresets: readonly CustomPreset[];
}

/**
 * Resolves the marker against what actually exists.
 *
 * Every failure resolves to "none": a deleted custom preset, a platform preset
 * that has since been disabled, a hand-edited token, a link opened in a
 * browser whose storage has never heard of that id. A stale marker must never
 * be able to break the page or invent a preset — the filters in the URL are
 * the search either way, and the marker only decides which name is highlighted.
 */
export function resolveActivePreset(
  params: RawSearchParams,
  catalog: PresetCatalog,
): ActivePreset {
  const identity = readPresetIdentity(params);

  if (identity === undefined) {
    return NO_ACTIVE_PRESET;
  }

  if (identity.kind === "platform") {
    const preset = catalog.platformPresets.find(
      (candidate) => candidate.id === identity.id && candidate.enabled,
    );

    return preset ? { kind: "platform", preset } : NO_ACTIVE_PRESET;
  }

  const preset = catalog.customPresets.find(
    (candidate) => candidate.id === identity.id,
  );

  return preset ? { kind: "custom", preset } : NO_ACTIVE_PRESET;
}

/** Platform presets that should be offered, in the order they should appear. */
export function visiblePlatformPresets(
  presets: readonly PlatformPreset[],
): readonly PlatformPreset[] {
  return presets
    .filter((preset) => preset.enabled)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

// =============================================================================
// Patches
// =============================================================================

/**
 * Selecting a preset: a fresh search from that preset's filters.
 *
 * Three things happen in one patch, and they happen in one patch precisely so
 * that no caller can perform two of them and forget the third:
 *
 *   1. every registered filter is cleared, so a preset never lands on top of
 *      what was already there — selecting "Online and Free" while filtered to
 *      Mumbai must not mean "online, free, *and* in Mumbai";
 *   2. the preset's own filters are written, sanitised against the registry;
 *   3. the marker is set, replacing whichever preset was active before.
 *
 * Pagination is named explicitly rather than left to the caller's `resetPage`.
 * A preset is by definition a different result set, so page 7 of the last one
 * is meaningless, and a call site that forgot the option would strand someone
 * on an empty page.
 *
 * Sorting is deliberately untouched. A sort is a way of reading a result set,
 * not a restriction on it: someone who asked for "deadline soonest" still
 * wants that when they switch presets, and clearing it would be a surprise no
 * part of the interface had suggested.
 */
export function applyPresetPatch(
  specs: readonly FilterSpec[],
  kind: PresetKind,
  preset: AppliablePreset,
): ParamPatch {
  return {
    ...clearAllFiltersPatch(specs),
    ...sanitizePresetFilters(specs, preset.filters),
    [PRESET_PARAM]: presetToken({ kind, id: preset.id }),
    [PAGE_PARAM]: undefined,
  };
}

/**
 * Marks a preset active without touching the search.
 *
 * For the one case where the filters are already exactly right: saving the
 * current search as a preset. Re-applying the preset we just built from what
 * is on screen would be a pointless navigation, and would reset the page for
 * no reason.
 */
export function activatePresetPatch(
  kind: PresetKind,
  presetId: string,
): ParamPatch {
  return { [PRESET_PARAM]: presetToken({ kind, id: presetId }) };
}

/**
 * Drops the marker and nothing else.
 *
 * Used when the active preset stops existing — the viewer deleted it. Their
 * current search is still their current search; destroying it because the
 * bookmark that seeded it was tidied away would be the search equivalent of
 * closing someone's document when they delete its template.
 */
export function deactivatePresetPatch(): ParamPatch {
  return { [PRESET_PARAM]: undefined };
}

// =============================================================================
// Capturing the current search
// =============================================================================

/**
 * The current search, as a preset would store it.
 *
 * Read and re-written through the registry's own codecs rather than copied out
 * of the URL, which buys three things at once: only parameters filters own are
 * captured, each value is canonical, and anything the decoders reject — a
 * removed enum member, a malformed date — is dropped instead of being
 * preserved forever in a saved preset.
 *
 * Page and sort are absent by construction: neither is a filter, so neither is
 * in the registry this iterates.
 */
export function capturePresetFilters(
  specs: readonly FilterSpec[],
  params: RawSearchParams,
): PresetFilters {
  const patches: ParamPatch[] = [];

  for (const spec of specs) {
    const value = readFilterValue(spec, params);

    if (value !== undefined) {
      patches.push(writeFilterValue(spec, value));
    }
  }

  return presetFilters(...patches);
}

/**
 * Whether there is anything worth saving.
 *
 * A preset of the empty search is a button that does what the page already
 * does, and it would sit in the saved list forever looking like it means
 * something. The interface offers an explanation instead of a saved nothing.
 */
export function hasCapturableFilters(
  specs: readonly FilterSpec[],
  params: RawSearchParams,
): boolean {
  return Object.keys(capturePresetFilters(specs, params)).length > 0;
}
