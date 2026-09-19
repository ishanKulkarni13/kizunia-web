/**
 * Search Core - Filter layout resolution (CLIENT-SAFE)
 *
 * =============================================================================
 * The problem this solves
 * =============================================================================
 *
 * A filter's spec declares where it *should* sit — quick or advanced, and in
 * what order. Those declarations are compiled into the build, which makes them
 * the wrong place to express anything that varies: a deployment that wants
 * Location promoted, a user who never touches Difficulty, an experiment that
 * reorders the quick bar.
 *
 * Rather than making the spec mutable, layout is resolved at render time by
 * layering overrides over the spec's defaults. The spec stays a static,
 * reviewable declaration of what a filter is; this module decides where a
 * particular viewer sees it.
 *
 * =============================================================================
 * Precedence
 * =============================================================================
 *
 *   spec defaults  →  deployment config  →  user preferences  →  runtime
 *
 * Later sources win, field by field. A user who has reordered the quick bar
 * keeps their order when a deployment changes a weight they did not override.
 *
 * Only the first two exist today. The signature takes a list of sources
 * precisely so adding the third is passing one more argument rather than
 * reworking the call sites — which is what "designed for the later phases
 * without building them" means concretely here.
 *
 * =============================================================================
 * What hiding does NOT do
 * =============================================================================
 *
 * Hiding a filter removes its control from the interface. It does **not**
 * prevent that filter from being applied: a URL carrying its parameter is
 * still decoded and still narrows the results, exactly as before.
 *
 * That is deliberate, and the distinction matters. Visibility is a
 * presentation preference; restricting *what a caller may filter on* is an
 * authorization concern, and the engine already has a mechanism for it —
 * `SearchScope.allowedFilters`, which drops disallowed keys before the query
 * is composed and cannot be influenced by anything a client sends.
 *
 * Using layout to hide a filter for security reasons would be a defect. If a
 * caller must not be able to filter on something, narrow the scope.
 */

import { isFilterActive } from "./spec-values";
import type { FilterGroup, FilterSpec } from "./spec";
import type { RawSearchParams } from "./types";

// =============================================================================
// Sources
// =============================================================================

/**
 * A change to one filter's presentation. Every field is optional; an omitted
 * field leaves whatever the previous source decided.
 */
export interface FilterLayoutOverride {
  readonly key: string;

  readonly group?: FilterGroup;

  readonly weight?: number;

  /**
   * Removes the control from the interface. See the note above: this is
   * presentation only and never restricts what a URL may request.
   */
  readonly hidden?: boolean;
}

/**
 * One layer of layout decisions.
 *
 * `pinned` is a convenience for the common "these first, in this order" case,
 * which is otherwise expressed as a run of hand-picked weights that have to be
 * renumbered whenever the list changes.
 */
export interface FilterLayoutSource {
  /** Identifies the layer in diagnostics. */
  readonly id: string;

  readonly overrides?: readonly FilterLayoutOverride[];

  /**
   * Filter keys to place first within their group, in the order given.
   *
   * Applied after weights, so a pinned filter leads its group regardless of
   * what weight any layer assigned it. Unknown keys are ignored rather than
   * rejected — a stored user preference naming a filter that has since been
   * removed must not break the page.
   */
  readonly pinned?: readonly string[];
}

// =============================================================================
// Result
// =============================================================================

export interface ResolvedFilter {
  readonly spec: FilterSpec;

  readonly group: FilterGroup;

  readonly weight: number;

  /**
   * True when the filter is hidden by layout but shown anyway because it
   * currently holds a value.
   *
   * Surfaced so the UI can explain the exception rather than appearing to
   * ignore the user's own preference.
   */
  readonly revealedBecauseActive: boolean;
}

export interface ResolvedFilterLayout {
  readonly quick: readonly ResolvedFilter[];

  readonly advanced: readonly ResolvedFilter[];

  /** Every visible filter, quick first, then advanced. */
  readonly visible: readonly ResolvedFilter[];

  /**
   * Every filter the entity registers, visible or not.
   *
   * Chip rendering and Clear all iterate this rather than `visible`: a hidden
   * filter that somehow holds a value must still be removable, and a Clear all
   * that skipped hidden filters would leave the search narrowed with no
   * on-screen explanation.
   */
  readonly all: readonly FilterSpec[];
}

// =============================================================================
// Resolution
// =============================================================================

interface Placement {
  group: FilterGroup;
  weight: number;
  hidden: boolean;
}

/** Applies every source's overrides, in order, to the spec defaults. */
function resolvePlacements(
  specs: readonly FilterSpec[],
  sources: readonly FilterLayoutSource[],
): Map<string, Placement> {
  const placements = new Map<string, Placement>(
    specs.map((spec) => [
      spec.key,
      { group: spec.group, weight: spec.weight, hidden: false },
    ]),
  );

  for (const source of sources) {
    for (const override of source.overrides ?? []) {
      const current = placements.get(override.key);

      // An override naming an unknown filter is ignored. Stored preferences
      // outlive the filters they mention, and a removed filter must not turn
      // into a crash for every user who had customised it.
      if (!current) {
        continue;
      }

      placements.set(override.key, {
        group: override.group ?? current.group,
        weight: override.weight ?? current.weight,
        hidden: override.hidden ?? current.hidden,
      });
    }
  }

  return placements;
}

/**
 * Builds a rank for each key from the last source that pinned it.
 *
 * Later sources replace, rather than merge with, an earlier pin list: a user
 * who has arranged their own quick bar means that arrangement to stand, not to
 * be interleaved with the deployment's.
 */
function resolvePinRanks(
  sources: readonly FilterLayoutSource[],
): Map<string, number> {
  const ranks = new Map<string, number>();

  for (const source of sources) {
    if (!source.pinned || source.pinned.length === 0) {
      continue;
    }

    ranks.clear();

    source.pinned.forEach((key, index) => ranks.set(key, index));
  }

  return ranks;
}

/**
 * Resolves the final filter layout for one render.
 *
 * `params` is required because visibility depends on the current search: a
 * filter hidden by preference but holding a value is revealed, so the user can
 * always see and remove every restriction actually being applied. A UI that
 * hid an active filter would show results the user could not explain and could
 * not undo without editing the URL by hand.
 */
export function resolveFilterLayout(
  specs: readonly FilterSpec[],
  params: RawSearchParams,
  sources: readonly FilterLayoutSource[] = [],
): ResolvedFilterLayout {
  const placements = resolvePlacements(specs, sources);
  const pinRanks = resolvePinRanks(sources);

  const resolved: ResolvedFilter[] = [];

  for (const spec of specs) {
    const placement = placements.get(spec.key);

    if (!placement) {
      continue;
    }

    const active = isFilterActive(spec, params);

    if (placement.hidden && !active) {
      continue;
    }

    resolved.push({
      spec,
      group: placement.group,
      weight: placement.weight,
      revealedBecauseActive: placement.hidden && active,
    });
  }

  const byPlacement = (a: ResolvedFilter, b: ResolvedFilter): number => {
    const rankA = pinRanks.get(a.spec.key);
    const rankB = pinRanks.get(b.spec.key);

    if (rankA !== undefined || rankB !== undefined) {
      // Pinned filters lead, in pin order; unpinned ones follow.
      return (rankA ?? Number.MAX_SAFE_INTEGER) - (rankB ?? Number.MAX_SAFE_INTEGER);
    }

    if (a.weight !== b.weight) {
      return a.weight - b.weight;
    }

    // Stable, meaningful last resort so equal weights do not reorder between
    // renders — which would move controls under the user's cursor.
    return a.spec.key.localeCompare(b.spec.key);
  };

  const quick = resolved
    .filter((entry) => entry.group === "quick")
    .sort(byPlacement);

  const advanced = resolved
    .filter((entry) => entry.group === "advanced")
    .sort(byPlacement);

  return {
    quick,
    advanced,
    visible: [...quick, ...advanced],
    all: specs,
  };
}

/**
 * Turns a plain map of preferences into a layout source.
 *
 * The shape a persisted user preference would take, provided now so that the
 * eventual preferences feature has a defined target and this module does not
 * have to change when it arrives.
 */
export function userLayoutSource(preferences: {
  readonly hidden?: readonly string[];
  readonly pinned?: readonly string[];
  readonly promoted?: readonly string[];
}): FilterLayoutSource {
  const overrides: FilterLayoutOverride[] = [];

  for (const key of preferences.hidden ?? []) {
    overrides.push({ key, hidden: true });
  }

  // Promotion moves a filter into the quick bar without asserting a position;
  // ordering there is `pinned`'s job.
  for (const key of preferences.promoted ?? []) {
    overrides.push({ key, group: "quick" });
  }

  return { id: "user", overrides, pinned: preferences.pinned };
}
