/**
 * Standing regression suite for Competition filter presets
 * (`src/lib/search/presets.ts`, `src/lib/search/preset-storage.ts` and
 * `src/modules/competitions/search/presets.ts`).
 *
 * Every behavioural rule a preset has lives in a pure function over URL
 * parameters, and the React layer does nothing but hand those functions to
 * `useSearchParamsState.apply`. That is what makes this suite possible without
 * a browser or a test runner: the acceptance scenarios below are asserted
 * against the same functions the interface calls, not against a re-description
 * of them.
 *
 * No database is touched. Presets never reach Prisma — they produce ordinary
 * filter parameters, and `verify-search-invariants.ts` already asserts what
 * those mean to the engine.
 *
 * There is no test runner in this repository yet, so this follows the existing
 * convention of a standalone script. Run with:
 *
 *   pnpm exec tsx scripts/verify-competition-presets.ts
 *
 * Invariants asserted:
 *   - the three platform presets exist, are enabled, and map onto the
 *     *existing* filter specs rather than to preset-only concepts
 *   - applying a preset clears what was there, resets the page, and marks
 *     itself active; selecting another replaces it entirely
 *   - refining a preset by hand keeps it active and keeps its filters
 *   - Clear all removes the marker along with the filters
 *   - saved presets survive a reload, and never carry page, sort or any
 *     parameter the filter registry does not own
 *   - create / rename / delete behave, and deleting the active preset leaves
 *     the current search exactly where it was
 *   - malformed, foreign-versioned and unavailable storage all degrade to
 *     "no saved presets" instead of throwing
 *   - acceptance scenarios A–F from the feature specification
 */

// =============================================================================
// A browser, for the parts that need one
// =============================================================================
//
// Installed before the modules under test are imported, because the storage
// module reads `window.localStorage` lazily but the competitions preset module
// builds its store at import time.

class MemoryStorage {
  private data = new Map<string, string>();

  /** Flipped on to simulate a browser that refuses to store anything. */
  public failing = false;

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    if (this.failing) {
      throw new Error("storage is unavailable");
    }

    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.failing) {
      throw new Error("storage is unavailable");
    }

    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  /** Test-only: writes a payload without going through the store. */
  seed(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const memory = new MemoryStorage();

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: memory as unknown as Storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  writable: true,
  configurable: true,
});

import {
  applyParamPatch,
  buildSearchHref,
  toQueryString,
  type ParamPatch,
} from "../src/lib/search/params";
import {
  clearAllFiltersPatch,
  readFilterValue,
  writeFilterValue,
} from "../src/lib/search/spec-values";
import {
  activatePresetPatch,
  applyPresetPatch,
  capturePresetFilters,
  deactivatePresetPatch,
  hasCapturableFilters,
  parsePresetToken,
  presetToken,
  resolveActivePreset,
  sanitizePresetFilters,
  visiblePlatformPresets,
  type CustomPreset,
  type PlatformPreset,
} from "../src/lib/search/presets";
import {
  createCustomPresetStore,
  CUSTOM_PRESET_SCHEMA_VERSION,
  MAX_CUSTOM_PRESETS,
  PRESET_NAME_MAX_LENGTH,
} from "../src/lib/search/preset-storage";
import type { RawSearchParams } from "../src/lib/search/types";
import { allFilterParams } from "../src/lib/search/spec";
import {
  COMPETITION_ADMIN_PLATFORM_PRESETS,
  COMPETITION_ADMIN_PRESET_NAMESPACE,
  COMPETITION_PLATFORM_PRESETS,
  COMPETITION_PRESET_NAMESPACE,
} from "../src/modules/competitions/search/presets";
import {
  competitionFilterSpecs,
  COMPETITION_FILTER_SPECS,
  RECORD_STATE_SPEC,
} from "../src/modules/competitions/search/ui";
import { resolveCompetitionFilterLayout } from "../src/modules/competitions/search/layout";

let failures = 0;
let checks = 0;

function report(label: string, ok: boolean, detail?: string): void {
  checks += 1;

  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }

  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const specs = COMPETITION_FILTER_SPECS;

/**
 * What the interface does with a patch.
 *
 * `useSearchParamsState.apply` merges through `applyParamPatch` with
 * `resetPage` defaulting to true. Mirroring it here — rather than
 * re-implementing what a preset "should" do — is what makes these assertions
 * about the real navigation path.
 */
function apply(
  params: RawSearchParams,
  patch: ParamPatch,
  options: { resetPage?: boolean } = {},
): RawSearchParams {
  return applyParamPatch(params, patch, {
    resetPage: options.resetPage ?? true,
  });
}

function canonical(params: RawSearchParams): string {
  return toQueryString(applyParamPatch(params));
}

function sameSearch(a: RawSearchParams, b: RawSearchParams): boolean {
  return canonical(a) === canonical(b);
}

function presetById(id: string): PlatformPreset {
  const preset = COMPETITION_PLATFORM_PRESETS.find(
    (candidate) => candidate.id === id,
  );

  if (!preset) {
    throw new Error(`Platform preset "${id}" is missing from the catalogue.`);
  }

  return preset;
}

const catalogOf = (customPresets: readonly CustomPreset[] = []) => ({
  platformPresets: COMPETITION_PLATFORM_PRESETS,
  customPresets,
});

// =============================================================================
// The catalogue
// =============================================================================

function verifyPlatformCatalogue(): void {
  console.log("\n== Platform presets are available, and are data ==");

  report(
    "three platform presets are declared",
    COMPETITION_PLATFORM_PRESETS.length === 3,
    `${COMPETITION_PLATFORM_PRESETS.length} declared`,
  );

  const visible = visiblePlatformPresets(COMPETITION_PLATFORM_PRESETS);

  report(
    "all three are enabled and offered",
    visible.length === 3,
    `${visible.length} visible`,
  );

  report(
    "they are offered in displayOrder, not declaration order",
    visible.every(
      (preset, index) =>
        index === 0 || visible[index - 1].displayOrder <= preset.displayOrder,
    ),
  );

  report(
    "every id is unique and URL-safe",
    new Set(COMPETITION_PLATFORM_PRESETS.map((p) => p.id)).size === 3 &&
      COMPETITION_PLATFORM_PRESETS.every((p) => /^[a-z0-9-]+$/.test(p.id)),
  );

  const owned = new Set(allFilterParams(specs));

  report(
    "no preset sets a parameter the filter registry does not own",
    COMPETITION_PLATFORM_PRESETS.every((preset) =>
      Object.keys(preset.filters).every((key) => owned.has(key)),
    ),
  );

  // Disabling one must make it inert everywhere, including for links that
  // already name it — that is what lets a preset be withdrawn without breaking
  // bookmarks.
  const disabled: PlatformPreset = { ...presetById("in-pune"), enabled: false };

  const active = resolveActivePreset(
    { preset: presetToken({ kind: "platform", id: "in-pune" }) },
    { platformPresets: [disabled], customPresets: [] },
  );

  report("a disabled platform preset resolves to no active preset", active.kind === "none");
}

function verifyPlatformMappings(): void {
  console.log("\n== Each preset maps onto the existing filter specs ==");

  report(
    "Open for All is the existing OPEN eligibility, not a new filter",
    JSON.stringify(presetById("open-for-all").filters) ===
      JSON.stringify({ eligibilities: "OPEN" }),
    JSON.stringify(presetById("open-for-all").filters),
  );

  // Asserted through the spec's own decoder: whatever the preset stored, the
  // filter layer has to read it back as the value we meant.
  const openParams = apply({}, applyPresetPatch(specs, "platform", presetById("open-for-all")));

  report(
    "and decodes back through the eligibilities filter as [OPEN]",
    JSON.stringify(
      readFilterValue(competitionFilterSpecs.eligibilities, openParams),
    ) === JSON.stringify(["OPEN"]),
  );

  report(
    "Online and Free is mode=ONLINE plus fee=FREE",
    JSON.stringify(presetById("online-and-free").filters) ===
      JSON.stringify({ modes: "ONLINE", registrationFeeTypes: "FREE" }),
    JSON.stringify(presetById("online-and-free").filters),
  );

  const freeParams = apply(
    {},
    applyPresetPatch(specs, "platform", presetById("online-and-free")),
  );

  report(
    "and decodes back as fully online, free entry",
    JSON.stringify(readFilterValue(competitionFilterSpecs.modes, freeParams)) ===
      JSON.stringify(["ONLINE"]) &&
      JSON.stringify(
        readFilterValue(competitionFilterSpecs.registrationFeeTypes, freeParams),
      ) === JSON.stringify(["FREE"]),
  );

  const pune = presetById("in-pune").filters;

  report(
    "In Pune uses the existing place filter's own parameters",
    pune.placeId !== undefined &&
      pune.placeLabel === "Pune" &&
      pune.includeOnline === undefined,
    JSON.stringify(pune),
  );

  const puneParams = apply({}, applyPresetPatch(specs, "platform", presetById("in-pune")));

  const place = readFilterValue(competitionFilterSpecs.location, puneParams);

  report(
    "and decodes back as a selected place with online excluded",
    place?.center.kind === "place" &&
      place.center.id === pune.placeId &&
      place.center.label === "Pune" &&
      place.includeOnline === false &&
      // The platform preset carries no radius, so applying it must not turn
      // distance matching on.
      place.radiusKm === undefined,
    JSON.stringify(place),
  );
}

/**
 * The admin catalogue is a separate, complete list of its own.
 *
 * Not a filtered view of `COMPETITION_PLATFORM_PRESETS` — a distinct array,
 * so a stray `platform:deleted-records` token can never resolve as active on
 * the public page just because the id happens to be enabled somewhere.
 */
function verifyAdminPlatformCatalogue(): void {
  console.log("\n== Admin platform presets are their own catalogue ==");

  report(
    "two admin platform presets are declared",
    COMPETITION_ADMIN_PLATFORM_PRESETS.length === 2,
    `${COMPETITION_ADMIN_PLATFORM_PRESETS.length} declared`,
  );

  report(
    "both are enabled",
    visiblePlatformPresets(COMPETITION_ADMIN_PLATFORM_PRESETS).length === 2,
  );

  report(
    "every id is unique and shares no id with the public catalogue",
    new Set(COMPETITION_ADMIN_PLATFORM_PRESETS.map((p) => p.id)).size === 2 &&
      COMPETITION_ADMIN_PLATFORM_PRESETS.every(
        (admin) =>
          !COMPETITION_PLATFORM_PRESETS.some((pub) => pub.id === admin.id),
      ),
  );

  const adminSpecs = [...COMPETITION_FILTER_SPECS, RECORD_STATE_SPEC];

  const owned = new Set(allFilterParams(adminSpecs));

  report(
    "no admin preset sets a parameter the admin registry does not own",
    COMPETITION_ADMIN_PLATFORM_PRESETS.every((preset) =>
      Object.keys(preset.filters).every((key) => owned.has(key)),
    ),
  );

  const deleted = COMPETITION_ADMIN_PLATFORM_PRESETS.find(
    (p) => p.id === "deleted-records",
  ) as PlatformPreset;

  const deletedParams = apply(
    {},
    applyPresetPatch(adminSpecs, "platform", deleted),
  );

  report(
    "Deleted decodes back through recordState as [DELETED] alone",
    JSON.stringify(readFilterValue(RECORD_STATE_SPEC, deletedParams)) ===
      JSON.stringify(["DELETED"]),
  );

  const all = COMPETITION_ADMIN_PLATFORM_PRESETS.find(
    (p) => p.id === "all-records",
  ) as PlatformPreset;

  const allParams = apply({}, applyPresetPatch(adminSpecs, "platform", all));

  report(
    "All records decodes back as both ACTIVE and DELETED selected",
    JSON.stringify(readFilterValue(RECORD_STATE_SPEC, allParams)) ===
      JSON.stringify(["ACTIVE", "DELETED"]),
  );

  report(
    "no admin preset merely reproduces the unfiltered default (ACTIVE alone)",
    COMPETITION_ADMIN_PLATFORM_PRESETS.every(
      (preset) => preset.filters.recordState !== "ACTIVE",
    ),
  );
}

/**
 * Two stores of the same entity, genuinely independent.
 *
 * `createCustomPresetStore`'s namespace parameter has anticipated a second
 * scope since it was written, but nothing had exercised it: this is the first
 * assertion that two namespaces of the same entity never read or write each
 * other's collection.
 */
function verifyAdminNamespaceIsolation(): void {
  console.log("\n== Admin presets live in a separate namespace from public ==");

  report(
    "the admin namespace is distinct from the public one",
    (COMPETITION_ADMIN_PRESET_NAMESPACE as string) !==
      (COMPETITION_PRESET_NAMESPACE as string),
  );

  const publicStorageKey: string = `kizunia:search-presets:${COMPETITION_PRESET_NAMESPACE}`;
  const adminStorageKey: string = `kizunia:search-presets:${COMPETITION_ADMIN_PRESET_NAMESPACE}`;

  report(
    "their storage keys are distinct",
    publicStorageKey !== adminStorageKey,
  );

  memory.clear();

  const publicStore = createCustomPresetStore(COMPETITION_PRESET_NAMESPACE);
  const adminStore = createCustomPresetStore(COMPETITION_ADMIN_PRESET_NAMESPACE);

  publicStore.create({ name: "Public one", filters: { modes: "ONLINE" } });

  report(
    "a preset saved under public does not appear under admin",
    adminStore.getSnapshot().length === 0,
  );

  adminStore.create({
    name: "Admin one",
    filters: { recordState: "DELETED" },
  });

  report(
    "a preset saved under admin does not appear under public",
    publicStore.getSnapshot().length === 1 &&
      publicStore.getSnapshot()[0].name === "Public one",
  );

  report(
    "each namespace persists independently across a reload",
    createCustomPresetStore(COMPETITION_PRESET_NAMESPACE).getSnapshot()
      .length === 1 &&
      createCustomPresetStore(COMPETITION_ADMIN_PRESET_NAMESPACE).getSnapshot()
        .length === 1,
  );

  memory.clear();
}

// =============================================================================
// Applying
// =============================================================================

function verifyApplyClearsAndMarks(): void {
  console.log("\n== Applying a preset starts a fresh search ==");

  const before: RawSearchParams = {
    categories: "ai",
    modes: "HYBRID",
    placeId: "ChIJ_____MUMBAI",
    placeLabel: "Mumbai",
    page: "7",
    sort: "oldest",
    utm_source: "newsletter",
  };

  const after = apply(
    before,
    applyPresetPatch(specs, "platform", presetById("online-and-free")),
  );

  report(
    "the previous filters do not survive",
    after.categories === undefined &&
      after.placeId === undefined &&
      after.placeLabel === undefined,
    canonical(after),
  );

  report(
    "the preset's filters are applied",
    after.modes === "ONLINE" && after.registrationFeeTypes === "FREE",
  );

  report("pagination is reset to the first page", after.page === undefined);

  report(
    "the preset is marked active",
    after.preset === "platform:online-and-free",
  );

  report(
    "the sort survives — it is a way of reading results, not a filter",
    after.sort === "oldest",
  );

  report(
    "unrelated parameters survive",
    after.utm_source === "newsletter",
  );

  report(
    "the result is an ordinary search URL",
    canonical(after) ===
      "modes=ONLINE&preset=platform%3Aonline-and-free&registrationFeeTypes=FREE&sort=oldest&utm_source=newsletter",
    canonical(after),
  );

  report(
    "and the active preset resolves from that URL alone",
    resolveActivePreset(after, catalogOf()).kind === "platform",
  );
}

function verifyRefinementKeepsPreset(): void {
  console.log("\n== Refining a preset by hand keeps it active ==");

  const applied = apply(
    {},
    applyPresetPatch(specs, "platform", presetById("online-and-free")),
  );

  // Exactly what the category picker emits — no preset-aware code path.
  const refined = apply(
    applied,
    writeFilterValue(competitionFilterSpecs.categories, ["ai"]),
  );

  report(
    "the manual filter is added to the preset's filters",
    refined.modes === "ONLINE" &&
      refined.registrationFeeTypes === "FREE" &&
      refined.categories === "ai",
    canonical(refined),
  );

  const active = resolveActivePreset(refined, catalogOf());

  report(
    "the preset stays active",
    active.kind === "platform" && active.preset.id === "online-and-free",
  );

  // A conflicting change is still just a filter change: the search says what
  // it says, and the preset still records where it started.
  const conflicting = apply(
    refined,
    writeFilterValue(competitionFilterSpecs.modes, ["HYBRID"]),
  );

  report(
    "a conflicting change is applied normally, with no special preset logic",
    conflicting.modes === "HYBRID" &&
      resolveActivePreset(conflicting, catalogOf()).kind === "platform",
  );
}

function verifyPresetReplacement(): void {
  console.log("\n== Selecting another preset replaces the first ==");

  const first = apply(
    {},
    applyPresetPatch(specs, "platform", presetById("online-and-free")),
  );

  const refined = apply(
    first,
    writeFilterValue(competitionFilterSpecs.categories, ["ai"]),
  );

  const second = apply(
    { ...refined, page: "4" },
    applyPresetPatch(specs, "platform", presetById("in-pune")),
  );

  report(
    "the previous preset's filters are gone",
    second.modes === undefined &&
      second.registrationFeeTypes === undefined &&
      second.categories === undefined,
    canonical(second),
  );

  report(
    "only the new preset's filters remain",
    second.placeId === presetById("in-pune").filters.placeId,
  );

  report("the page resets again", second.page === undefined);

  const active = resolveActivePreset(second, catalogOf());

  report(
    "and the new preset is the active one",
    active.kind === "platform" && active.preset.id === "in-pune",
  );
}

function verifyClearAllDeactivates(): void {
  console.log("\n== Clearing every filter ends the preset ==");

  const applied = apply(
    {},
    applyPresetPatch(specs, "platform", presetById("in-pune")),
  );

  const refined = apply(
    applied,
    writeFilterValue(competitionFilterSpecs.categories, ["ai"]),
  );

  // The existing Clear all — the same patch the chip bar, the sheet and both
  // empty-state links use. No preset-specific reset exists.
  const cleared = apply(refined, clearAllFiltersPatch(specs));

  report(
    "no filters remain",
    specs.every((spec) => readFilterValue(spec, cleared) === undefined),
    canonical(cleared),
  );

  report("the marker is removed too", cleared.preset === undefined);

  report(
    "so nothing is shown as active",
    resolveActivePreset(cleared, catalogOf()).kind === "none",
  );

  report(
    "and an unrelated parameter still survives Clear all",
    apply({ ...refined, utm_source: "x" }, clearAllFiltersPatch(specs))
      .utm_source === "x",
  );
}

/**
 * Clear all lands on page 1, through every route that offers it.
 *
 * The interesting half is the *link* route. `apply` here mirrors the client
 * seam, which defaults `resetPage` to true and would have masked the defect;
 * the two server-rendered "Clear filters" links call `buildSearchHref` with no
 * options at all, so the reset has to be in the patch or it does not happen.
 */
function verifyClearAllResetsPagination(): void {
  console.log("\n== Clear all returns to the first page ==");

  const deepInAFilteredList: RawSearchParams = {
    modes: "ONLINE",
    categories: "ai",
    preset: "platform:online-and-free",
    sort: "oldest",
    page: "3",
  };

  const patch = clearAllFiltersPatch(specs);

  report("the patch itself names the page parameter", "page" in patch);

  report("…as a removal, which is the canonical page 1", patch.page === undefined);

  // Route 1: the client controls — the always-available button on the page and
  // the sheet's own footer, both of which navigate through `apply`.
  const viaApply = apply(deepInAFilteredList, patch);

  report("clearing from a control leaves no page parameter", viaApply.page === undefined);

  // Route 2: the server-rendered links, which build an href directly and pass
  // no `resetPage`. This is the case that was broken.
  const viaLink = buildSearchHref("/competitions", deepInAFilteredList, patch);

  report(
    "the empty-state and error-state links land on page 1 too",
    viaLink === "/competitions?sort=oldest",
    viaLink,
  );

  report(
    "and clearing an unpaginated search is unchanged by the fix",
    canonical(apply({ modes: "ONLINE", sort: "oldest" }, patch)) ===
      "sort=oldest",
  );

  // Every filter named in the brief, plus the two engine parameters that must
  // go with them. Sort deliberately stays: it is how results are read, not a
  // restriction on which ones there are.
  report(
    "one Clear all covers every registered filter, the marker and the page",
    [...allFilterParams(specs), "preset", "page"].every(
      (param) => param in patch && patch[param] === undefined,
    ),
  );

  report("and still leaves sort alone", !("sort" in patch));
}

/**
 * "All filters" contains all of them — with one deliberate exception.
 *
 * The sheet renders `layout.visible` and the quick bar renders `layout.quick`,
 * which is a subset of it. Asserted against the resolved layout rather than
 * against a list written out here, so promoting or demoting a filter cannot
 * make this pass while the interface loses one — except `registrationTypes`,
 * which `KIZUNIA_COMPETITION_LAYOUT` hides on purpose: it duplicated the
 * "Entry format" control now nested inside `teamSize`'s own panel (same
 * label, same Solo/Team/Either options), and only `teamSize`'s version is
 * wired to the size/policy coordination logic. Hiding it is presentation
 * only — the filter itself, its URL parameter and its Prisma clause are all
 * untouched, and the check below confirms the layout's own safety net still
 * reveals it the moment a URL actually uses it.
 */
function verifyAllFiltersCompleteness(): void {
  console.log("\n== The All filters panel holds every filter ==");

  const layout = resolveCompetitionFilterLayout({}, "public");

  const visibleKeys = layout.visible.map((entry) => entry.spec.key);

  const DELIBERATELY_HIDDEN: readonly string[] = ["registrationTypes"];

  const alwaysVisible = specs.filter(
    (spec) => !DELIBERATELY_HIDDEN.includes(spec.key),
  );

  report(
    `every one of the ${alwaysVisible.length} non-hidden Competition filters is in the panel`,
    alwaysVisible.every((spec) => visibleKeys.includes(spec.key)),
    alwaysVisible
      .filter((spec) => !visibleKeys.includes(spec.key))
      .map((spec) => spec.key)
      .join(", "),
  );

  report(
    "registrationTypes is deliberately hidden by default",
    !visibleKeys.includes("registrationTypes"),
  );

  const revealedWhenActive = resolveCompetitionFilterLayout(
    { registrationTypes: "TEAM" },
    "public",
  );

  report(
    "registrationTypes still reveals itself once its URL parameter is in use",
    revealedWhenActive.visible.some((entry) => entry.spec.key === "registrationTypes"),
  );

  // The five the page also promotes. Named explicitly because these are the
  // ones the brief says must not vanish from the panel merely for having a
  // shortcut on the page.
  for (const key of [
    "categories",
    "modes",
    "location",
    "statuses",
    "registrationFeeTypes",
  ]) {
    report(`quick filter "${key}" is still inside All filters`, visibleKeys.includes(key));
  }

  report(
    "the quick bar is a subset of the panel, not a second list",
    layout.quick.every((entry) => visibleKeys.includes(entry.spec.key)),
  );

  report(
    "and the panel lists nothing twice",
    new Set(visibleKeys).size === visibleKeys.length,
  );
}

/**
 * One filter state, two views of it.
 *
 * A quick control and its panel section are the *same spec object*, so there is
 * no encoding to keep in step: writing a value in either place produces a
 * byte-identical patch, and reading it back from either produces the same
 * value. This is the property that makes "there is only one source of truth"
 * structural rather than a claim.
 */
function verifyQuickAndPanelShareState(): void {
  console.log("\n== Quick filters and All filters write the same state ==");

  const layout = resolveCompetitionFilterLayout({}, "public");

  const panelSpecs = new Map(
    layout.visible.map((entry) => [entry.spec.key, entry.spec]),
  );

  report(
    "each quick control is the identical spec object the panel renders",
    layout.quick.every((entry) => panelSpecs.get(entry.spec.key) === entry.spec),
  );

  const modesFromQuick = layout.quick.find((entry) => entry.spec.key === "modes");

  const modesFromPanel = panelSpecs.get("modes");

  if (!modesFromQuick || !modesFromPanel) {
    report("Mode is present in both surfaces", false);
    return;
  }

  const fromQuick = writeFilterValue(modesFromQuick.spec, ["ONLINE"]);
  const fromPanel = writeFilterValue(modesFromPanel, ["ONLINE"]);

  report(
    "setting Mode from either surface produces the same patch",
    JSON.stringify(fromQuick) === JSON.stringify(fromPanel),
  );

  const applied = apply({}, fromPanel);

  report(
    "and the value set in the panel is what the quick control reads back",
    JSON.stringify(readFilterValue(modesFromQuick.spec, applied)) ===
      JSON.stringify(["ONLINE"]),
  );

  report(
    "a filter hidden by layout is still cleared by Clear all",
    allFilterParams(specs).every(
      (param) => clearAllFiltersPatch(specs)[param] === undefined,
    ),
  );
}

/**
 * Saving from a staged panel.
 *
 * `useSearchPresets` commits the staged patch in the same navigation that marks
 * the new preset active, so the preset and the results agree the moment it is
 * saved. Reproduced here as the patch composition the hook performs.
 */
function verifySaveFromStagedPanel(): void {
  console.log("\n== Saving from the staged panel ==");

  const applied: RawSearchParams = { modes: "ONLINE" };

  // What the panel stages while it is open: the person ticks a category.
  const pendingPatch = writeFilterValue(competitionFilterSpecs.categories, [
    "ai",
  ]);

  // What the panel shows, and therefore what "these filters" has to mean.
  const viewParams = applyParamPatch(applied, pendingPatch);

  const captured = capturePresetFilters(specs, viewParams);

  report(
    "the captured preset holds the staged edit, not just the applied search",
    captured.categories === "ai" && captured.modes === "ONLINE",
    JSON.stringify(captured),
  );

  const saved = apply(applied, {
    ...pendingPatch,
    ...activatePresetPatch("custom", "saved-1"),
  });

  report(
    "saving applies the staged edit in the same navigation",
    readFilterValue(competitionFilterSpecs.categories, saved)?.[0] === "ai",
  );

  report(
    "and marks the new preset active",
    saved.preset === "custom:saved-1",
  );

  report(
    "so the saved preset and the resulting search agree exactly",
    JSON.stringify(captured) === JSON.stringify(capturePresetFilters(specs, saved)),
  );

  // Nothing staged: a marker-only write, which must not move the reader.
  const markerOnly = apply(
    { modes: "ONLINE", page: "2" },
    activatePresetPatch("custom", "saved-2"),
    { resetPage: false },
  );

  report(
    "saving with nothing staged leaves the page where it was",
    markerOnly.page === "2" && markerOnly.preset === "custom:saved-2",
  );
}

// =============================================================================
// Markers
// =============================================================================

function verifyMarkerCodec(): void {
  console.log("\n== The marker cannot be confused or forged ==");

  report(
    "a platform token round-trips",
    JSON.stringify(
      parsePresetToken(presetToken({ kind: "platform", id: "in-pune" })),
    ) === JSON.stringify({ kind: "platform", id: "in-pune" }),
  );

  report(
    "an id containing a colon survives intact",
    parsePresetToken("custom:a:b")?.id === "a:b",
  );

  const rejected = ["", ":", "custom:", ":abc", "platform", "other:x", "  "];

  report(
    "malformed tokens are rejected rather than guessed at",
    rejected.every((token) => parsePresetToken(token) === undefined),
  );

  report(
    "a platform id cannot impersonate a custom preset",
    resolveActivePreset(
      { preset: "custom:in-pune" },
      catalogOf(),
    ).kind === "none",
  );

  report(
    "a marker naming a preset that no longer exists resolves to none",
    resolveActivePreset({ preset: "custom:deleted-id" }, catalogOf()).kind ===
      "none",
  );

  report(
    "a hand-edited marker cannot crash resolution",
    resolveActivePreset({ preset: ["a", "b"] }, catalogOf()).kind === "none",
  );
}

// =============================================================================
// Capturing the current search
// =============================================================================

function verifyCapture(): void {
  console.log("\n== Saving captures filters, and only filters ==");

  const params: RawSearchParams = {
    categories: "ai",
    modes: "ONLINE",
    page: "3",
    limit: "50",
    sort: "oldest",
    preset: "platform:online-and-free",
    utm_source: "newsletter",
  };

  const captured = capturePresetFilters(specs, params);

  report(
    "filters are captured",
    captured.categories === "ai" && captured.modes === "ONLINE",
    JSON.stringify(captured),
  );

  report(
    "the page number is never part of a preset",
    captured.page === undefined && captured.limit === undefined,
  );

  report(
    "neither is the sort, nor the marker, nor an unrelated parameter",
    captured.sort === undefined &&
      captured.preset === undefined &&
      captured.utm_source === undefined,
  );

  report(
    "a value the filter layer would reject is dropped rather than stored",
    capturePresetFilters(specs, { modes: "NOT_A_MODE" }).modes === undefined,
  );

  report(
    "an empty search has nothing worth saving",
    !hasCapturableFilters(specs, {}) &&
      !hasCapturableFilters(specs, { page: "2", sort: "oldest" }),
  );

  report(
    "a filtered search does",
    hasCapturableFilters(specs, { modes: "ONLINE" }),
  );
}

function verifySanitization(): void {
  console.log("\n== Stored filters are never trusted verbatim ==");

  const hostile = {
    modes: "ONLINE",
    page: "9000",
    sort: "oldest",
    preset: "platform:in-pune",
    limit: "1000",
    somethingElse: "x",
  };

  const clean = sanitizePresetFilters(specs, hostile);

  report(
    "only registry-owned parameters survive",
    JSON.stringify(clean) === JSON.stringify({ modes: "ONLINE" }),
    JSON.stringify(clean),
  );

  const applied = apply(
    { page: "5" },
    applyPresetPatch(specs, "custom", { id: "hostile", filters: hostile }),
  );

  report(
    "so a tampered preset cannot set the page",
    applied.page === undefined,
  );

  report(
    "cannot mark a different preset active",
    applied.preset === "custom:hostile",
  );

  report(
    "and cannot smuggle in an unrelated parameter",
    applied.somethingElse === undefined && applied.limit === undefined,
  );
}

// =============================================================================
// Storage
// =============================================================================

const STORAGE_KEY = `kizunia:search-presets:${COMPETITION_PRESET_NAMESPACE}`;

function freshStore() {
  memory.clear();
  memory.failing = false;

  return createCustomPresetStore(COMPETITION_PRESET_NAMESPACE);
}

function verifyStorageLifecycle(): void {
  console.log("\n== Create, rename, delete, and reload ==");

  const store = freshStore();

  report("a new browser has no saved presets", store.getSnapshot().length === 0);

  const created = store.create({
    name: "  My AI Pune Competitions  ",
    filters: { categories: "ai", modes: "ONLINE" },
  });

  report("creating returns the saved preset", created !== undefined);

  report(
    "the name is trimmed and the id is generated, not the name",
    created?.name === "My AI Pune Competitions" &&
      created !== undefined &&
      created.id.length > 0 &&
      created.id !== created.name,
  );

  report(
    "created and updated timestamps are recorded",
    !Number.isNaN(Date.parse(created?.createdAt ?? "")) &&
      created?.createdAt === created?.updatedAt,
  );

  report("it appears in the snapshot", store.getSnapshot().length === 1);

  report(
    "an empty name is refused",
    store.create({ name: "   ", filters: { modes: "ONLINE" } }) === undefined,
  );

  report(
    "an over-long name is refused",
    store.create({
      name: "x".repeat(PRESET_NAME_MAX_LENGTH + 1),
      filters: { modes: "ONLINE" },
    }) === undefined,
  );

  report(
    "a preset with no filters is refused",
    store.create({ name: "Everything", filters: {} }) === undefined,
  );

  // Two presets may share a name: the name is a label, not an identity.
  const twin = store.create({
    name: "My AI Pune Competitions",
    filters: { modes: "OFFLINE" },
  });

  report(
    "two presets may share a name and remain distinct",
    twin !== undefined && twin.id !== created?.id,
  );

  const id = created?.id as string;

  const before = store.getSnapshot().find((preset) => preset.id === id);

  const renamed = store.rename(id, "Renamed");

  const after = store.getSnapshot().find((preset) => preset.id === id);

  report("renaming succeeds", renamed && after?.name === "Renamed");

  report(
    "renaming does not touch the stored filters",
    JSON.stringify(after?.filters) === JSON.stringify(before?.filters),
  );

  report(
    "renaming preserves createdAt and refreshes updatedAt",
    after?.createdAt === before?.createdAt &&
      Date.parse(after?.updatedAt ?? "") >= Date.parse(before?.updatedAt ?? ""),
  );

  report(
    "renaming to nothing is refused",
    !store.rename(id, "   ") &&
      store.getSnapshot().find((preset) => preset.id === id)?.name ===
        "Renamed",
  );

  // A reload is a new store over the same browser storage.
  const reloaded = createCustomPresetStore(COMPETITION_PRESET_NAMESPACE);

  report(
    "saved presets survive a reload",
    reloaded.getSnapshot().length === 2 &&
      reloaded.getSnapshot().some((preset) => preset.name === "Renamed"),
  );

  report(
    "the persisted payload is versioned",
    JSON.parse(memory.getItem(STORAGE_KEY) as string).schemaVersion ===
      CUSTOM_PRESET_SCHEMA_VERSION,
  );

  report("deleting succeeds", store.remove(id));

  report(
    "and the preset is gone from storage, not just from memory",
    createCustomPresetStore(COMPETITION_PRESET_NAMESPACE)
      .getSnapshot()
      .every((preset) => preset.id !== id),
  );

  report("deleting something that is not there reports failure", !store.remove(id));

  report(
    "the snapshot keeps its identity while nothing changes",
    store.getSnapshot() === store.getSnapshot(),
  );
}

function verifyPlatformBoundary(): void {
  console.log("\n== Platform presets are not the viewer's to edit ==");

  const store = freshStore();

  store.create({ name: "Mine", filters: { modes: "ONLINE" } });

  const platformId = presetById("in-pune").id;

  report(
    "a platform id cannot be renamed through the custom preset actions",
    !store.rename(platformId, "Not In Pune"),
  );

  report(
    "nor deleted through them",
    !store.remove(platformId),
  );

  report(
    "applying a platform preset writes nothing into the saved collection",
    (() => {
      apply({}, applyPresetPatch(specs, "platform", presetById("in-pune")));

      return store.getSnapshot().length === 1;
    })(),
  );

  report(
    "and the saved collection never holds a platform preset's id",
    store.getSnapshot().every((preset) => preset.id !== platformId),
  );

  // V1 has no reordering, and the absence is asserted rather than assumed:
  // the store's surface is create/rename/delete/read and nothing else.
  report(
    "the store exposes no reordering capability",
    !Object.keys(store).some((key) =>
      /^(reorder|move|swap|sort|setOrder)/i.test(key),
    ),
    Object.keys(store).join(", "),
  );
}

function verifyStorageSafety(): void {
  console.log("\n== Storage that cannot be trusted does not break the page ==");

  const corrupt: [string, string][] = [
    ["not JSON at all", "{{{"],
    ["a JSON scalar", '"nope"'],
    ["a bare array", "[1,2,3]"],
    ["no envelope", '{"presets":[]}'],
    ["a future schema version", '{"schemaVersion":99,"presets":[{"id":"a"}]}'],
    ["presets that are not an array", '{"schemaVersion":1,"presets":{}}'],
    [
      "rows missing required fields",
      '{"schemaVersion":1,"presets":[{"id":"a"},{"name":"b"}]}',
    ],
    [
      "a row with non-string filters",
      '{"schemaVersion":1,"presets":[{"id":"a","name":"n","filters":{"modes":5},"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}]}',
    ],
    [
      "a row with an unparseable date",
      '{"schemaVersion":1,"presets":[{"id":"a","name":"n","filters":{"modes":"ONLINE"},"createdAt":"never","updatedAt":"never"}]}',
    ],
  ];

  for (const [label, payload] of corrupt) {
    memory.clear();
    memory.seed(STORAGE_KEY, payload);

    let ok = false;

    try {
      ok = createCustomPresetStore(COMPETITION_PRESET_NAMESPACE).getSnapshot()
        .length === 0;
    } catch {
      ok = false;
    }

    report(`${label} degrades to no saved presets`, ok);
  }

  // One bad row must not cost the good ones sitting beside it.
  memory.clear();
  memory.seed(
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: CUSTOM_PRESET_SCHEMA_VERSION,
      presets: [
        { id: "broken" },
        {
          id: "good",
          name: "Good",
          filters: { modes: "ONLINE" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  );

  const salvaged = createCustomPresetStore(
    COMPETITION_PRESET_NAMESPACE,
  ).getSnapshot();

  report(
    "one corrupt row costs that row, not the whole collection",
    salvaged.length === 1 && salvaged[0].id === "good",
  );

  // Storage refused outright — private mode, enterprise policy, quota.
  memory.clear();
  memory.failing = true;

  let survived = true;
  let refused = false;

  try {
    const store = createCustomPresetStore(COMPETITION_PRESET_NAMESPACE);

    refused =
      store.getSnapshot().length === 0 &&
      store.create({ name: "x", filters: { modes: "ONLINE" } }) === undefined &&
      !store.rename("x", "y") &&
      !store.remove("x");
  } catch {
    survived = false;
  }

  memory.failing = false;

  report("unavailable storage never throws", survived);

  report("and every operation reports its failure honestly", refused);
}

function verifyStorageCap(): void {
  console.log("\n== The saved collection is bounded ==");

  const store = freshStore();

  for (let index = 0; index < MAX_CUSTOM_PRESETS; index += 1) {
    store.create({ name: `Preset ${index}`, filters: { modes: "ONLINE" } });
  }

  report(
    `${MAX_CUSTOM_PRESETS} presets can be saved`,
    store.getSnapshot().length === MAX_CUSTOM_PRESETS,
  );

  report(
    "the one past the cap is refused rather than silently dropped",
    store.create({ name: "One too many", filters: { modes: "ONLINE" } }) ===
      undefined,
  );

  report(
    "and nothing already saved was lost",
    store.getSnapshot().length === MAX_CUSTOM_PRESETS,
  );
}

// =============================================================================
// Acceptance scenarios
// =============================================================================

function verifyAcceptanceScenarios(): void {
  console.log("\n== Acceptance scenarios ==");

  // A — a preset replaces whatever was applied.
  const a = apply(
    { categories: "ai", placeId: "ChIJ_____MUMBAI", placeLabel: "Mumbai" },
    applyPresetPatch(specs, "platform", presetById("online-and-free")),
  );

  report(
    "A: filters are replaced, the preset is active, page 1",
    a.modes === "ONLINE" &&
      a.registrationFeeTypes === "FREE" &&
      a.categories === undefined &&
      a.placeId === undefined &&
      a.page === undefined &&
      a.preset === "platform:online-and-free",
    canonical(a),
  );

  // B — refinement adds to the preset.
  const b = apply(
    apply({}, applyPresetPatch(specs, "platform", presetById("online-and-free"))),
    writeFilterValue(competitionFilterSpecs.categories, ["ai"]),
  );

  report(
    "B: the manual filter joins the preset's, which stays active",
    b.modes === "ONLINE" &&
      b.registrationFeeTypes === "FREE" &&
      b.categories === "ai" &&
      resolveActivePreset(b, catalogOf()).kind === "platform",
    canonical(b),
  );

  // C — a second preset starts fresh.
  const c = apply(b, applyPresetPatch(specs, "platform", presetById("in-pune")));

  report(
    "C: only the new preset's filters remain",
    c.placeId === presetById("in-pune").filters.placeId &&
      c.modes === undefined &&
      c.registrationFeeTypes === undefined &&
      c.categories === undefined &&
      c.page === undefined &&
      c.preset === "platform:in-pune",
    canonical(c),
  );

  // D — a custom preset behaves exactly like a platform one.
  const store = freshStore();

  const myAi = store.create({
    name: "My AI",
    filters: { categories: "ai", modes: "ONLINE" },
  }) as CustomPreset;

  const d = apply(
    { placeId: "ChIJ_____MUMBAI", placeLabel: "Mumbai", page: "2" },
    applyPresetPatch(specs, "custom", myAi),
  );

  report(
    "D: the custom preset clears, applies, resets the page and marks itself",
    d.categories === "ai" &&
      d.modes === "ONLINE" &&
      d.placeId === undefined &&
      d.page === undefined &&
      d.preset === `custom:${myAi.id}`,
    canonical(d),
  );

  report(
    "D: and it resolves as the active custom preset",
    (() => {
      const active = resolveActivePreset(d, catalogOf(store.getSnapshot()));

      return active.kind === "custom" && active.preset.id === myAi.id;
    })(),
  );

  // E — clearing ends everything.
  const e = apply(
    apply(
      apply({}, applyPresetPatch(specs, "platform", presetById("online-and-free"))),
      writeFilterValue(competitionFilterSpecs.categories, ["ai"]),
    ),
    clearAllFiltersPatch(specs),
  );

  report(
    "E: no filters and no active preset",
    canonical(e) === "" &&
      resolveActivePreset(e, catalogOf()).kind === "none",
    canonical(e),
  );

  // F — deleting the active preset leaves the search alone.
  const refined = apply(
    apply({}, applyPresetPatch(specs, "custom", myAi)),
    writeFilterValue(competitionFilterSpecs.location, {
      center: {
        kind: "place",
        id: "ChIJARFGZy6_wjsRQ-Oenb9DjYI",
        label: "Pune",
      },
      includeOnline: false,
    }),
  );

  const onPage = { ...refined, page: "3" };

  store.remove(myAi.id);

  // What the hook does once storage reports the deletion: drop the marker,
  // touch nothing else, and stay on the page.
  const f = apply(onPage, deactivatePresetPatch(), { resetPage: false });

  report(
    "F: the current search is untouched by the deletion",
    f.categories === "ai" &&
      f.modes === "ONLINE" &&
      f.placeId === "ChIJARFGZy6_wjsRQ-Oenb9DjYI" &&
      f.page === "3",
    canonical(f),
  );

  report(
    "F: only the marker is gone",
    f.preset === undefined &&
      resolveActivePreset(f, catalogOf(store.getSnapshot())).kind === "none",
  );

  // Saving marks the just-saved preset active without moving the search.
  const saved = store.create({
    name: "Saved from here",
    filters: capturePresetFilters(specs, f),
  }) as CustomPreset;

  const marked = apply(f, activatePresetPatch("custom", saved.id), {
    resetPage: false,
  });

  report(
    "saving the current search marks it active without changing the search",
    sameSearch(
      { ...marked, preset: undefined },
      { ...f, preset: undefined },
    ) && marked.preset === `custom:${saved.id}`,
    canonical(marked),
  );
}

// =============================================================================
// The rest of search, unchanged
// =============================================================================

function verifyExistingBehaviourIntact(): void {
  console.log("\n== The existing search behaviour is untouched ==");

  report(
    "no filter owns the preset parameter",
    !allFilterParams(specs).includes("preset"),
  );

  const withMarker: RawSearchParams = {
    modes: "ONLINE",
    preset: "platform:online-and-free",
  };

  const withoutMarker: RawSearchParams = { modes: "ONLINE" };

  report(
    "the marker changes no filter value the engine will read",
    specs.every(
      (spec) =>
        JSON.stringify(readFilterValue(spec, withMarker)) ===
        JSON.stringify(readFilterValue(spec, withoutMarker)),
    ),
  );

  report(
    "a search with no preset is byte-identical to what it was before",
    canonical(apply({ modes: "ONLINE" }, {})) === "modes=ONLINE",
  );

  report(
    "Clear all still clears every filter parameter it owns",
    allFilterParams(specs).every(
      (param) => clearAllFiltersPatch(specs)[param] === undefined,
    ),
  );

  report(
    "and now names the marker as well",
    "preset" in clearAllFiltersPatch(specs),
  );
}

function main(): void {
  verifyPlatformCatalogue();
  verifyPlatformMappings();
  verifyAdminPlatformCatalogue();
  verifyAdminNamespaceIsolation();
  verifyApplyClearsAndMarks();
  verifyRefinementKeepsPreset();
  verifyPresetReplacement();
  verifyClearAllDeactivates();
  verifyClearAllResetsPagination();
  verifyAllFiltersCompleteness();
  verifyQuickAndPanelShareState();
  verifySaveFromStagedPanel();
  verifyMarkerCodec();
  verifyCapture();
  verifySanitization();
  verifyStorageLifecycle();
  verifyPlatformBoundary();
  verifyStorageSafety();
  verifyStorageCap();
  verifyAcceptanceScenarios();
  verifyExistingBehaviourIntact();

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
