/**
 * Standing regression suite for the Competition search engine
 * (`src/lib/search` + `competitionSearchDefinition`), which is now the
 * production implementation behind `/competitions`, `/admin/competitions`,
 * and the `/api/v1/competitions*` routes — the legacy hand-written
 * `CompetitionWhereBuilder` pipeline this replaced has been deleted.
 *
 * Before deletion, this script instead ran the legacy pipeline and the new
 * engine side by side against the real database and diffed row-id
 * sequences (65/65 passed — see
 * docs/project/feature-specification/search/07-implementation-design.md §7
 * and the git history of this file for that comparison). With no legacy
 * implementation left to compare against, this script now asserts the
 * engine's own behavioural invariants directly against the database instead.
 *
 * There is no test runner in this repository yet (see 07 §8), so this
 * remains a standalone script rather than a `describe`/`it` suite. Run with:
 *
 *   pnpm exec tsx scripts/verify-search-parity.ts
 *
 * Invariants asserted:
 *   - text filters match case-insensitively (the exact defect a prior
 *     version of this suite could not catch, because its only case came
 *     from a fixture whose casing happened to match)
 *   - no filter ever reaches Prisma as an empty `in`/`OR` (both match 0 rows)
 *   - scope guards cannot be bypassed by a same-named filter
 *   - defineSearch() rejects malformed registries (6 cases)
 *   - every resolved sort ends in the tiebreaker; unknown sorts degrade
 *   - free-text filters escape LIKE wildcards, verified against the DB
 *   - normalize() is idempotent (canonical URLs are stable)
 *   - inputs that used to 400 the legacy schema now degrade gracefully
 */

import { PrismaClient } from "../src/generated/prisma";
import {
  competitionSearchDefinition,
  type CompetitionSearchContext,
} from "../src/modules/competitions/search/definition";
import { buildSearchQuery, defineSearch } from "../src/lib/search/engine";
import { bindFilter } from "../src/lib/search/bind";
import { defineScope } from "../src/lib/search/scope";
import { defineSortRegistry } from "../src/lib/search/sort";
import { dateRangeFilter } from "../src/lib/search/filters/range";
import { textFilter } from "../src/lib/search/filters/text";
import type { RawSearchParams } from "../src/lib/search/types";
import { filterParams } from "../src/lib/search/spec";
import type { DateRangeSpec, TextSpec, TeamSizeValue } from "../src/lib/search/spec";
import { writeFilterValue, readFilterValue } from "../src/lib/search/spec-values";
import { applyParamPatch, isSameSearch } from "../src/lib/search/params";
import {
  COMPETITION_FILTER_SPECS,
  competitionFilterSpecs,
} from "../src/modules/competitions/search/ui";
import { buildLocationClause } from "../src/modules/competitions/search/location-clause";
import {
  buildCompetitionQuery,
  planCompetitionSearch,
} from "../src/modules/competitions/search/plan";
import { resolvableFiltersForScope } from "../src/lib/search/engine";
import {
  clearAllFiltersPatch,
  describeAllChips,
} from "../src/lib/search/spec-values";
import { pageHref } from "../src/lib/search/params";

const prisma = new PrismaClient();

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

async function runEngine(
  raw: RawSearchParams,
  scope: string = "public",
  context: CompetitionSearchContext = {},
) {
  const query = buildSearchQuery({
    definition: competitionSearchDefinition,
    params: raw,
    scope,
    context,
    baseClauses: [{ deletedAt: null }],
  });

  const rows = await prisma.competition.findMany({
    where: query.where,
    orderBy: query.orderBy,
    skip: query.skip,
    take: query.take,
    select: { id: true },
  });

  return rows.map((r) => r.id);
}

// =============================================================================
// Case-insensitivity — the exact class of bug a naive parity check missed
// =============================================================================

async function verifyCaseInsensitivity(): Promise<void> {
  console.log("\n== Invariant: text filters match case-insensitively ==");

  // This block used to exercise a `location` text filter through a parameter
  // named `location`. That filter was replaced by a `place` spec owning
  // `placeId`, `placeLabel` and `includeOnline`, so nothing claims `location`
  // any more — and the check quietly became vacuous. All three runs returned
  // the same *unfiltered* list, which satisfied the assertion and reported
  // green for a property nothing was testing.
  //
  // What replaces it is the invariant that made the old check meaningless, now
  // asserted directly: a parameter no filter owns must change nothing. That
  // holds regardless of which filters exist, so a future rename cannot turn
  // this into a no-op the way it did last time.
  const unowned = "location";

  report(
    `"${unowned}" is genuinely unowned by any filter`,
    COMPETITION_FILTER_SPECS.every(
      (spec) => !filterParams(spec).includes(unowned),
    ),
  );

  const [withUnowned, unfiltered] = await Promise.all([
    runEngine({ [unowned]: "Pune" }),
    runEngine({}),
  ]);

  report(
    "an unowned parameter does not filter, and cannot fake a passing check",
    JSON.stringify(withUnowned) === JSON.stringify(unfiltered),
    `${withUnowned.length} vs ${unfiltered.length} rows`,
  );

  const org = await prisma.competition.findFirst({
    where: { deletedAt: null, visibility: "PUBLIC", organizer: { not: null } },
    select: { organizer: true },
  });

  if (!org?.organizer) {
    report("search/organizer case-insensitivity (needs fixture data)", false, "no public competition has an organizer");
    return;
  }

  const [searchLower, searchUpper] = await Promise.all([
    runEngine({ search: org.organizer.toLowerCase() }),
    runEngine({ search: org.organizer.toUpperCase() }),
  ]);

  report(
    `free-text search matches regardless of case (fixture: ${JSON.stringify(org.organizer)})`,
    searchLower.length > 0 && JSON.stringify(searchLower) === JSON.stringify(searchUpper),
    `lower=${searchLower.length} upper=${searchUpper.length} rows`,
  );

  const [orgLower, orgUpper] = await Promise.all([
    runEngine({ organizers: org.organizer.toLowerCase() }),
    runEngine({ organizers: org.organizer.toUpperCase() }),
  ]);

  report(
    `organizers filter matches regardless of case (fixture: ${JSON.stringify(org.organizer)})`,
    orgLower.length > 0 && JSON.stringify(orgLower) === JSON.stringify(orgUpper),
    `lower=${orgLower.length} upper=${orgUpper.length} rows`,
  );
}

// =============================================================================
// Inputs that used to 400 the legacy Zod schema — must now degrade gracefully
// =============================================================================

async function verifyGracefulDegradation(): Promise<void> {
  console.log("\n== Invariant: malformed input degrades instead of failing the request ==");

  const cases: Array<{ name: string; raw: RawSearchParams }> = [
    { name: "invalid enum value", raw: { modes: "BANANA" } },
    { name: "repeated param (array)", raw: { modes: ["ONLINE", "HYBRID"] } },
    { name: "out-of-range page", raw: { page: "0" } },
    { name: "out-of-range limit", raw: { limit: "1000" } },
    { name: "garbage date", raw: { startDateFrom: "not-a-date" } },
    { name: "mixed valid/invalid enum tokens", raw: { modes: "ONLINE,BANANA" } },
  ];

  for (const testCase of cases) {
    let threw = false;
    let ids: string[] = [];

    try {
      ids = await runEngine(testCase.raw);
    } catch {
      threw = true;
    }

    report(
      testCase.name,
      !threw,
      threw ? "engine threw instead of degrading" : `returned ${ids.length} rows`,
    );
  }
}

// =============================================================================
// No filter ever reaches Prisma as an empty `in`/`OR`
// =============================================================================

function containsEmptyInOrOr(value: unknown, path = "where"): string | null {
  if (value === null || typeof value !== "object") return null;

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "in" || key === "OR") && Array.isArray(val) && val.length === 0) {
      return `${path}.${key}`;
    }

    if (val !== null && typeof val === "object") {
      const nested = containsEmptyInOrOr(val, `${path}.${key}`);
      if (nested) return nested;
    }
  }

  return null;
}

async function verifyNoEmptyInOrOr(): Promise<void> {
  console.log("\n== Invariant: no filter ever emits empty `in`/`OR` ==");

  const emptyValueCases: RawSearchParams[] = [
    { modes: "" },
    { categories: "" },
    { technologies: "" },
    { organizers: "" },
    { eligibilities: "" },
    { statuses: "," },
  ];

  for (const raw of emptyValueCases) {
    const query = buildSearchQuery({
      definition: competitionSearchDefinition,
      params: raw,
      scope: "public",
      context: {},
      baseClauses: [{ deletedAt: null }],
    });

    const offender = containsEmptyInOrOr(query.where);

    report(
      `params=${JSON.stringify(raw)}`,
      offender === null,
      offender ? `found empty collection at ${offender}` : undefined,
    );
  }
}

async function verifyScopeGuardEnforcement(): Promise<void> {
  console.log("\n== Invariant: scope guards cannot be bypassed by a filter ==");

  const filterKeys = new Set(
    competitionSearchDefinition.filters.map((f) => f.key),
  );

  report(
    '"visibility" is not a registered filter key',
    !filterKeys.has("visibility"),
  );

  let threw = false;
  try {
    buildSearchQuery({
      definition: competitionSearchDefinition,
      params: {},
      scope: "does-not-exist",
      context: {},
    });
  } catch {
    threw = true;
  }
  report("unknown scope id throws", threw);

  let managementThrew = false;
  try {
    buildSearchQuery({
      definition: competitionSearchDefinition,
      params: {},
      scope: "management",
      context: {},
    });
  } catch {
    managementThrew = true;
  }
  report("management scope with no actorId throws", managementThrew);

  // Discovery and access are separate concerns: public search must include
  // PUBLIC competitions only. UNLISTED, PRIVATE, and ARCHIVED competitions
  // remain directly governed by VIEW authorization, but never appear here.
  const publicRows = await prisma.competition.findMany({
    where: buildSearchQuery({
      definition: competitionSearchDefinition,
      params: {},
      scope: "public",
      context: {},
      baseClauses: [{ deletedAt: null }],
    }).where,
    select: { visibility: true },
  });

  report(
    "public discovery excludes UNLISTED, PRIVATE, and ARCHIVED",
    publicRows.every((r) => r.visibility === "PUBLIC"),
    `visibilities seen: ${JSON.stringify([...new Set(publicRows.map((r) => r.visibility))])}`,
  );
}

async function verifyDefinitionValidation(): Promise<void> {
  console.log("\n== Invariant: defineSearch() rejects malformed registries ==");

  type W = { AND?: W | W[]; visibility?: unknown };

  // Minimal specs for the validator cases. Built here rather than imported so
  // a change to the Competition registry cannot silently alter what these
  // assertions are testing.
  const textSpec = (key: string): TextSpec => ({
    kind: "text",
    key,
    label: key,
    group: "quick",
    weight: 0,
  });

  const dateSpec = (key: string): DateRangeSpec => ({
    kind: "date-range",
    key,
    label: key,
    group: "advanced",
    weight: 0,
  });

  const sorts = defineSortRegistry<{ id: "asc" }>({
    options: [{ key: "newest", label: "N", orderBy: [{ id: "asc" as const }] }],
    defaultKey: "newest",
    tiebreaker: { id: "asc" },
  });

  const openScopes = {
    public: defineScope<W, object>({
      id: "public",
      allowedFilters: "all",
      guard: () => [],
    }),
  };

  const rejects = (label: string, build: () => unknown) => {
    let threw = false;
    try {
      build();
    } catch {
      threw = true;
    }
    report(label, threw, "expected defineSearch to throw");
  };

  rejects("filter claiming a reserved parameter", () =>
    defineSearch<W, { id: "asc" }, object>({
      entity: "T",
      sorts,
      scopes: openScopes,
      filters: [
        bindFilter(textFilter<W>({ spec: textSpec("page"), toWhere: () => ({}) })),
      ],
    }),
  );

  rejects("two filters claiming the same URL parameter", () =>
    defineSearch<W, { id: "asc" }, object>({
      entity: "T",
      sorts,
      scopes: openScopes,
      // dateRangeFilter("startDate") owns startDateFrom/startDateTo, so this
      // collides on a *derived* parameter while the two keys differ — the
      // case a key-only check would miss.
      filters: [
        bindFilter(dateRangeFilter<W>({ spec: dateSpec("startDate"), toWhere: () => ({}) })),
        bindFilter(
          textFilter<W>({ spec: textSpec("startDateFrom"), toWhere: () => ({}) }),
        ),
      ],
    }),
  );

  rejects("duplicate filter key", () =>
    defineSearch<W, { id: "asc" }, object>({
      entity: "T",
      sorts,
      scopes: openScopes,
      filters: [
        bindFilter(textFilter<W>({ spec: textSpec("a"), toWhere: () => ({}) })),
        bindFilter(textFilter<W>({ spec: textSpec("a"), toWhere: () => ({}) })),
      ],
    }),
  );

  rejects("filter colliding with a scope's guardedKeys", () =>
    defineSearch<W, { id: "asc" }, object>({
      entity: "T",
      sorts,
      scopes: {
        public: defineScope<W, object>({
          id: "public",
          allowedFilters: "all",
          guardedKeys: ["visibility"],
          guard: () => [{ visibility: "PUBLIC" }],
        }),
      },
      filters: [
        bindFilter(
          textFilter<W>({ spec: textSpec("visibility"), toWhere: () => ({}) }),
        ),
      ],
    }),
  );

  rejects("registry with no scopes", () =>
    defineSearch<W, { id: "asc" }, object>({
      entity: "T",
      sorts,
      scopes: {},
      filters: [],
    }),
  );

  let accepted = true;
  try {
    defineSearch<W, { id: "asc" }, object>({
      entity: "T",
      sorts,
      scopes: openScopes,
      filters: [
        bindFilter(dateRangeFilter<W>({ spec: dateSpec("startDate"), toWhere: () => ({}) })),
        bindFilter(textFilter<W>({ spec: textSpec("place"), toWhere: () => ({}) })),
      ],
    });
  } catch {
    accepted = false;
  }
  report("a valid registry is accepted", accepted);
}

async function verifySortDeterminism(): Promise<void> {
  console.log("\n== Invariant: every sort resolves with the tiebreaker ==");

  for (const option of competitionSearchDefinition.sorts.options) {
    const query = buildSearchQuery({
      definition: competitionSearchDefinition,
      params: { sort: option.key },
      scope: "public",
      context: {},
    });

    const last = query.orderBy[query.orderBy.length - 1];

    report(
      `sort "${option.key}" ends in tiebreaker`,
      JSON.stringify(last) === JSON.stringify({ id: "asc" }),
      `got ${JSON.stringify(last)}`,
    );
  }

  const unknownQuery = buildSearchQuery({
    definition: competitionSearchDefinition,
    params: { sort: "not-a-real-sort" },
    scope: "public",
    context: {},
  });

  report(
    "unknown sort token falls back to default instead of throwing",
    unknownQuery.orderBy.length > 0,
  );
}

async function verifyWildcardEscaping(): Promise<void> {
  console.log("\n== Invariant: free-text filters escape LIKE wildcards ==");

  const withPercent = buildSearchQuery({
    definition: competitionSearchDefinition,
    params: { search: "50%" },
    scope: "public",
    context: {},
  });

  const clause = JSON.stringify(withPercent.where);

  report(
    '"50%" is escaped to "50\\%" before reaching Prisma',
    clause.includes("50\\\\%"),
    clause,
  );

  // Behavioural check against the database, not just the clause string.
  // Prisma does NOT escape LIKE wildcards itself: an unescaped `%` inside a
  // `contains` acts as a wildcard, so "<head>%<tail>" would match a title
  // that merely starts and ends that way. Escaped, it must match nothing,
  // because no title contains a literal "%".
  const sample = await prisma.competition.findFirst({
    where: { deletedAt: null, visibility: "PUBLIC" },
    select: { title: true },
  });

  if (!sample) {
    report("wildcard behaviour (needs >=1 public competition)", false, "no fixture data");
    return;
  }

  const probe = `${sample.title.slice(0, 3)}%${sample.title.slice(-3)}`;

  const unescapedMatches = await prisma.competition.count({
    where: {
      deletedAt: null,
      visibility: "PUBLIC",
      title: { contains: probe, mode: "insensitive" },
    },
  });

  const throughEngine = buildSearchQuery({
    definition: competitionSearchDefinition,
    params: { search: probe },
    scope: "public",
    context: {},
    baseClauses: [{ deletedAt: null }],
  });

  const escapedMatches = await prisma.competition.count({
    where: throughEngine.where,
  });

  report(
    `raw Prisma treats "%" in ${JSON.stringify(probe)} as a wildcard`,
    unescapedMatches > 0,
    `matched ${unescapedMatches} — if 0, this assertion no longer proves anything`,
  );

  report(
    "engine escapes it so it matches literally (0 rows)",
    escapedMatches === 0,
    `matched ${escapedMatches}`,
  );

  const plain = buildSearchQuery({
    definition: competitionSearchDefinition,
    params: { search: sample.title },
    scope: "public",
    context: {},
    baseClauses: [{ deletedAt: null }],
  });

  report(
    "escaping does not break a normal search",
    (await prisma.competition.count({ where: plain.where })) > 0,
  );
}

async function verifyCodecRoundTrip(): Promise<void> {
  console.log("\n== Invariant: normalize() is idempotent on already-canonical params ==");

  const canonicalCases: RawSearchParams[] = [
    { modes: "HYBRID,ONLINE" },
    { categories: "ai,web3" },
    { search: "ETHGlobal" },
    { teamSizeMin: "4" },
    { entryFormat: "TEAM", teamPolicy: "SOLO_OR_TEAM" },
    { entryFormat: "EITHER", teamSizeMin: "2", teamSizeMax: "4" },
    { startDateFrom: new Date("2026-01-01").toISOString() },
  ];

  for (const raw of canonicalCases) {
    const once = normalizeAll(raw);
    const twice = normalizeAll(once);

    report(
      `normalize(normalize(${JSON.stringify(raw)})) === normalize(${JSON.stringify(raw)})`,
      JSON.stringify(once) === JSON.stringify(twice),
      `first=${JSON.stringify(once)} second=${JSON.stringify(twice)}`,
    );
  }
}

/**
 * Canonicalises a parameter bag through the spec layer.
 *
 * Reads each filter's value and writes it straight back, which is exactly the
 * round trip a control performs. Idempotence here is what guarantees a shared
 * URL, a saved search and a freshly built one all serialise identically.
 */
function normalizeAll(raw: RawSearchParams): Record<string, string> {
  let patch: Record<string, string | undefined> = {};

  for (const spec of COMPETITION_FILTER_SPECS) {
    const value = readFilterValue(spec, raw);

    patch = { ...patch, ...writeFilterValue(spec, value) };
  }

  return applyParamPatch(raw, patch);
}


// =============================================================================
// Invariants introduced by the spec / resolvable-filter architecture
// =============================================================================

/**
 * The highest-risk regression in the whole subsystem.
 *
 * An ordinary filter that decodes to nothing is dropped by the engine. If
 * location were an ordinary filter, a real place with no competitions would
 * therefore return *every* competition on the platform. Registering it as a
 * resolvable filter makes its clause a base clause, which cannot be dropped.
 */
async function verifyResolvedLocationNeverWidens(): Promise<void> {
  console.log(
    "\n== Invariant: a location matching nothing returns nothing, not everything ==",
  );

  const clause = buildLocationClause({
    searchAreaIds: [],
    includeOnline: false,
  });

  report(
    "zero matched areas yields an unsatisfiable clause",
    JSON.stringify(clause) === JSON.stringify({ id: { in: [] } }),
    `got ${JSON.stringify(clause)}`,
  );

  const total = await prisma.competition.count({
    where: { deletedAt: null, visibility: "PUBLIC" },
  });

  const matched = await prisma.competition.count({
    where: { AND: [{ deletedAt: null }, clause, { visibility: "PUBLIC" }] },
  });

  report(
    "against the real database it matches 0 rows",
    matched === 0,
    `matched=${matched} of ${total}`,
  );

  const withOnline = buildLocationClause({
    searchAreaIds: [],
    includeOnline: true,
  });

  const onlineOnly = await prisma.competition.count({
    where: { AND: [{ deletedAt: null }, withOnline, { visibility: "PUBLIC" }] },
  });

  const actualOnline = await prisma.competition.count({
    where: { deletedAt: null, visibility: "PUBLIC", mode: "ONLINE" },
  });

  report(
    "with includeOnline it matches exactly the online competitions",
    onlineOnly === actualOnline,
    `clause=${onlineOnly} direct=${actualOnline}`,
  );
}

/**
 * Rows and totals are built from one plan, so they cannot diverge.
 *
 * Before planning existed, `findMany` and `count` each built their own query
 * from raw parameters — two independent resolutions that could straddle a
 * cache expiry and disagree.
 */
async function verifyPlanSymmetry(): Promise<void> {
  console.log("\n== Invariant: rows and totals are built from one plan ==");

  const cases: RawSearchParams[] = [
    {},
    { modes: "ONLINE" },
    { search: "hack", categories: "ai", sort: "start-date-asc" },
    { page: "3", limit: "5" },
  ];

  for (const params of cases) {
    const plan = await planCompetitionSearch({ scope: "public", params });

    const a = buildCompetitionQuery(plan);
    const b = buildCompetitionQuery(plan);

    report(
      `identical where for ${JSON.stringify(params)}`,
      JSON.stringify(a.where) === JSON.stringify(b.where),
    );
  }

  // Location is registered rather than wired into one service method, so no
  // scope can quietly skip it — the defect this replaces.
  for (const scope of ["public", "management", "admin"] as const) {
    const resolvable = resolvableFiltersForScope(
      competitionSearchDefinition,
      scope,
    );

    report(
      `scope "${scope}" sees the location resolvable filter`,
      resolvable.some((filter) => filter.key === "location"),
    );
  }
}

/** Removing a chip removes exactly that value and nothing else. */
function verifyChipRemoval(): void {
  console.log("\n== Invariant: a chip removes only its own value ==");

  const params: RawSearchParams = {
    modes: "ONLINE,HYBRID",
    categories: "ai,web3",
    search: "hack",
  };

  const chips = describeAllChips(COMPETITION_FILTER_SPECS, params);

  report("one chip per value", chips.length === 5, `got ${chips.length}`);

  const onlineChip = chips.find((chip) => chip.id === "modes:ONLINE");

  if (!onlineChip) {
    report("an Online chip exists", false);
    return;
  }

  const after = applyParamPatch(params, onlineChip.remove);

  report(
    "removing Online leaves Hybrid",
    after.modes === "HYBRID",
    `modes=${after.modes}`,
  );

  report(
    "removing Online leaves the other filters untouched",
    after.categories === "ai,web3" && after.search === "hack",
    JSON.stringify(after),
  );
}

/** Clear all removes every registered parameter and nothing else. */
function verifyClearAll(): void {
  console.log("\n== Invariant: Clear all clears filters, not the URL ==");

  const params: RawSearchParams = {
    modes: "ONLINE",
    placeId: "abc",
    placeLabel: "Pune",
    includeOnline: "true",
    startDateFrom: "2026-01-01",
    utm_source: "newsletter",
    sort: "start-date-asc",
  };

  const cleared = applyParamPatch(
    params,
    clearAllFiltersPatch(COMPETITION_FILTER_SPECS),
  );

  for (const key of [
    "modes",
    "placeId",
    "placeLabel",
    "includeOnline",
    "startDateFrom",
  ]) {
    report(`"${key}" is cleared`, cleared[key] === undefined);
  }

  report("an unrelated parameter survives", cleared.utm_source === "newsletter");

  // Sort is engine-owned, not filter-owned, so Clear all leaves it: a person
  // clearing filters has said nothing about how they want results ordered.
  report("sort survives", cleared.sort === "start-date-asc");
}

/**
 * Paging preserves the search.
 *
 * Guards the original defect: a link written as `?page=2` that discarded every
 * filter the person had applied.
 */
function verifyPaginationPreservesSearch(): void {
  console.log("\n== Invariant: paging keeps every filter ==");

  const params: RawSearchParams = {
    modes: "ONLINE",
    categories: "ai",
    placeId: "abc",
    sort: "start-date-asc",
  };

  const href = pageHref("/competitions", params, 3);

  const query = new URLSearchParams(href.split("?")[1] ?? "");

  report("page is set", query.get("page") === "3", href);

  for (const [key, value] of Object.entries(params)) {
    report(`"${key}" survives`, query.get(key) === value, href);
  }

  const first = pageHref("/competitions", params, 1);

  report(
    "page 1 omits the parameter, so one view has one URL",
    !first.includes("page="),
    first,
  );

  report(
    "paging does not change which search it is",
    isSameSearch(params, Object.fromEntries(query.entries())),
  );
}


/**
 * Team-size semantics, checked against the real table.
 *
 * Team size is one consolidated filter now: `teamSizeMin`/`teamSizeMax`
 * express exact and ranged intents, and a lone `teamSizeMax` expresses "at
 * most" (see `TeamSizeSpec`) — there is no "at least", since an open-ended
 * lower bound has no competition maximum that could honestly be said to
 * contain it. `teamPolicy` separately asks what the *competition* allows
 * about solo entry. `teamSizeMatches` below is an independent re-derivation
 * of `buildTeamSizeClause`'s containment logic in plain TypeScript, run
 * against the live table — the point is to catch the clause and the intended
 * semantics drifting apart, which comparing the clause against itself could
 * never do.
 */
function teamSizeMatches(
  competition: { minTeamSize: number | null; maxTeamSize: number | null },
  filter: { min?: number; max?: number; policy?: "SOLO_ONLY" | "SOLO_OR_TEAM" },
): boolean {
  // The competition's own range must fully contain every size the requester
  // might bring — not merely share a size with it. `min` absent means the
  // team could be as small as 1 (the "at most" case), so the competition's
  // floor is checked against that even when it is the implicit default.
  if (filter.max !== undefined) {
    const effectiveMin = filter.min ?? 1;

    const lowFits =
      competition.minTeamSize === null ||
      competition.minTeamSize <= effectiveMin;

    if (!lowFits) return false;

    const highFits =
      competition.maxTeamSize === null ||
      competition.maxTeamSize >= filter.max;

    if (!highFits) return false;
  }

  if (filter.policy === "SOLO_ONLY") {
    if (!(competition.maxTeamSize !== null && competition.maxTeamSize <= 1)) {
      return false;
    }
  }

  if (filter.policy === "SOLO_OR_TEAM") {
    const allowsSolo =
      competition.minTeamSize === null || competition.minTeamSize <= 1;

    const allowsTeam =
      competition.maxTeamSize === null || competition.maxTeamSize > 1;

    if (!allowsSolo || !allowsTeam) return false;
  }

  return true;
}

function teamSizeParams(filter: {
  min?: number;
  max?: number;
  policy?: "SOLO_ONLY" | "SOLO_OR_TEAM";
}): RawSearchParams {
  const params: RawSearchParams = { limit: "100" };

  if (filter.min !== undefined) params.teamSizeMin = String(filter.min);
  if (filter.max !== undefined) params.teamSizeMax = String(filter.max);
  if (filter.policy) params.teamPolicy = filter.policy;

  return params;
}

async function verifyTeamSizeSemantics(): Promise<void> {
  console.log(
    "\n== Invariant: team size answers 'can we enter', not 'what are the limits' ==",
  );

  const all = await prisma.competition.findMany({
    where: { deletedAt: null, visibility: "PUBLIC" },
    select: { id: true, minTeamSize: true, maxTeamSize: true },
  });

  if (all.length === 0 || all.length > 100) {
    report(
      "team-size semantics (needs a comparable dataset)",
      false,
      `${all.length} public competitions; expected 1..100`,
    );
    return;
  }

  const sorted = (ids: string[]) => JSON.stringify([...ids].sort());

  const cases: { label: string; filter: Parameters<typeof teamSizeMatches>[1] }[] = [
    { label: "exact 1 (solo)", filter: { min: 1, max: 1 } },
    { label: "exact 5", filter: { min: 5, max: 5 } },
    { label: "range 1–3 (containment, not overlap)", filter: { min: 1, max: 3 } },
    { label: "range 3–5", filter: { min: 3, max: 5 } },
    { label: "at most 4", filter: { max: 4 } },
    { label: "policy: solo only", filter: { policy: "SOLO_ONLY" } },
    { label: "policy: solo & team", filter: { policy: "SOLO_OR_TEAM" } },
    {
      label: "combined: range 2–4 and solo-or-team",
      filter: { min: 2, max: 4, policy: "SOLO_OR_TEAM" },
    },
  ];

  for (const { label, filter } of cases) {
    const expected = all
      .filter((c) => teamSizeMatches(c, filter))
      .map((c) => c.id);

    const actual = await runEngine(teamSizeParams(filter));

    report(
      `${label} matches exactly the competitions the predicate expects (${expected.length} rows)`,
      sorted(actual) === sorted(expected),
      `engine=${actual.length} expected=${expected.length}`,
    );
  }

  // The one-click "Just me (solo)" shortcut in the control and the policy
  // toggle's "Solo only" answer different questions — bringing exactly one
  // person is not the same as requiring a competition to be solo-only — and
  // must not silently coincide on this dataset by accident.
  const soloSize = all.filter((c) => teamSizeMatches(c, { min: 1, max: 1 }));
  const soloOnlyPolicy = all.filter((c) =>
    teamSizeMatches(c, { policy: "SOLO_ONLY" }),
  );

  report(
    "a team of exactly 1 and a solo-only competition are different questions",
    soloSize.length >= soloOnlyPolicy.length &&
      soloOnlyPolicy.every((c) => soloSize.some((s) => s.id === c.id)),
    `solo-size=${soloSize.length} solo-only-policy=${soloOnlyPolicy.length}`,
  );

  // A competition that declared no bounds has not refused anyone. Reading a
  // missing value as a refusal would hide exactly the most permissive entries.
  const unbounded = all.filter(
    (c) => c.minTeamSize === null && c.maxTeamSize === null,
  );

  if (unbounded.length > 0) {
    const matched = await runEngine(teamSizeParams({ min: 7, max: 7 }));

    report(
      `competitions with no declared bounds are not excluded (${unbounded.length} such rows)`,
      unbounded.every((c) => matched.includes(c.id)),
    );
  }

  // "At least" is gone — not merely unreachable from the control, but
  // genuinely unfiltered when a stale bookmark or hand-edited URL supplies
  // a lone `teamSizeMin`. It must not fall back to the old overlap check.
  const staleAtLeast = await runEngine({ teamSizeMin: "3", limit: "100" });
  const unfilteredForAtLeast = await runEngine({ limit: "100" });

  report(
    "a lone teamSizeMin (the old 'at least') applies no size filter",
    sorted(staleAtLeast) === sorted(unfilteredForAtLeast),
    `stale=${staleAtLeast.length} unfiltered=${unfilteredForAtLeast.length}`,
  );

  // The old four-filter URL contract must be gone, not merely unused — a
  // stray bookmark from before this pass should not silently start filtering
  // by a parameter nothing owns any more.
  const stale = await runEngine({
    minTeamSize: "50",
    maxTeamSize: "1",
    allowsSolo: "true",
    limit: "100",
  });
  const unfilteredIds = await runEngine({ limit: "100" });

  report(
    "the retired minTeamSize/maxTeamSize/allowsSolo/teamSize=N parameters are no longer owned",
    sorted(stale) === sorted(unfilteredIds),
    `stale=${stale.length} unfiltered=${unfilteredIds.length}`,
  );
}

/**
 * Entry format ("Solo" / "Team" / "Either") coordinates `min`/`max`/`policy`
 * without adding a Prisma clause of its own — see the doc comment on
 * `TeamEntryFormat` in `spec.ts`. What has to hold instead is that
 * `readTeamSize` (`spec-values.ts`), which both the control and the query
 * builder decode through, never lets a contradictory combination survive:
 * Solo with a team size, Team with a strictly-solo competition format, or
 * any team size above one paired with "Solo only".
 *
 * These are pure decode-time checks — no database needed — since
 * `entryFormat` never reaches a query, only the `min`/`max`/`policy` it
 * leaves behind does.
 */
function verifyEntryFormatCoordination(): void {
  console.log(
    "\n== Invariant: entry format never leaves a contradictory team-size/policy combination ==",
  );

  const decode = (raw: RawSearchParams): TeamSizeValue | undefined =>
    readFilterValue(competitionFilterSpecs.teamSize, raw);

  // Field-by-field rather than `JSON.stringify` equality: the two objects'
  // keys are declared in a different order (the fixtures below read most
  // naturally as entryFormat/policy/min/max; `readTeamSize` returns
  // min/max/policy/entryFormat), and `JSON.stringify` is key-order-sensitive.
  const same = (
    a: TeamSizeValue | undefined,
    b: TeamSizeValue | undefined,
  ): boolean => {
    if (a === undefined || b === undefined) return a === b;

    return (
      a.min === b.min &&
      a.max === b.max &&
      a.policy === b.policy &&
      a.entryFormat === b.entryFormat
    );
  };

  const cases: {
    label: string;
    params: RawSearchParams;
    expected: TeamSizeValue | undefined;
  }[] = [
    {
      label: "Solo + Solo only",
      params: { entryFormat: "SOLO", teamPolicy: "SOLO_ONLY" },
      expected: { entryFormat: "SOLO", policy: "SOLO_ONLY", min: undefined, max: undefined },
    },
    {
      label: "Solo + Solo & team",
      params: { entryFormat: "SOLO", teamPolicy: "SOLO_OR_TEAM" },
      expected: { entryFormat: "SOLO", policy: "SOLO_OR_TEAM", min: undefined, max: undefined },
    },
    {
      label: "Solo + team size => the size is cleared, entry format survives",
      params: { entryFormat: "SOLO", teamSizeMin: "3", teamSizeMax: "7" },
      expected: { entryFormat: "SOLO", policy: undefined, min: undefined, max: undefined },
    },
    {
      label: "Team + Solo & team",
      params: { entryFormat: "TEAM", teamPolicy: "SOLO_OR_TEAM" },
      expected: { entryFormat: "TEAM", policy: "SOLO_OR_TEAM", min: undefined, max: undefined },
    },
    {
      label: "Team + Solo only => forced to Solo & team",
      params: { entryFormat: "TEAM", teamPolicy: "SOLO_ONLY" },
      expected: { entryFormat: "TEAM", policy: "SOLO_OR_TEAM", min: undefined, max: undefined },
    },
    {
      label: "Team + Solo & team + Exact",
      params: {
        entryFormat: "TEAM",
        teamPolicy: "SOLO_OR_TEAM",
        teamSizeMin: "3",
        teamSizeMax: "3",
      },
      expected: { entryFormat: "TEAM", policy: "SOLO_OR_TEAM", min: 3, max: 3 },
    },
    {
      label: "Team + Solo & team + Range",
      params: {
        entryFormat: "TEAM",
        teamPolicy: "SOLO_OR_TEAM",
        teamSizeMin: "2",
        teamSizeMax: "4",
      },
      expected: { entryFormat: "TEAM", policy: "SOLO_OR_TEAM", min: 2, max: 4 },
    },
    {
      label: "Team + Solo & team + At most",
      params: { entryFormat: "TEAM", teamPolicy: "SOLO_OR_TEAM", teamSizeMax: "4" },
      expected: { entryFormat: "TEAM", policy: "SOLO_OR_TEAM", min: undefined, max: 4 },
    },
    {
      label: "Either + Solo only + no team size",
      params: { entryFormat: "EITHER", teamPolicy: "SOLO_ONLY" },
      expected: { entryFormat: "EITHER", policy: "SOLO_ONLY", min: undefined, max: undefined },
    },
    {
      label: "Either + Solo & team + no team size",
      params: { entryFormat: "EITHER", teamPolicy: "SOLO_OR_TEAM" },
      expected: { entryFormat: "EITHER", policy: "SOLO_OR_TEAM", min: undefined, max: undefined },
    },
    {
      label: "Either + Solo & team + Range 2-4",
      params: {
        entryFormat: "EITHER",
        teamPolicy: "SOLO_OR_TEAM",
        teamSizeMin: "2",
        teamSizeMax: "4",
      },
      expected: { entryFormat: "EITHER", policy: "SOLO_OR_TEAM", min: 2, max: 4 },
    },
    {
      label: "Either + Solo only + Range 2-4 => Solo only is dropped, the range survives",
      params: {
        entryFormat: "EITHER",
        teamPolicy: "SOLO_ONLY",
        teamSizeMin: "2",
        teamSizeMax: "4",
      },
      expected: { entryFormat: "EITHER", policy: undefined, min: 2, max: 4 },
    },
    {
      label: "no entry format + Solo only + Range 2-4 => still contradictory, still dropped",
      params: { teamPolicy: "SOLO_ONLY", teamSizeMin: "2", teamSizeMax: "4" },
      expected: { entryFormat: undefined, policy: undefined, min: 2, max: 4 },
    },
    {
      label: "no entry format + Solo only + Exact 1 => not contradictory, both survive",
      params: { teamPolicy: "SOLO_ONLY", teamSizeMin: "1", teamSizeMax: "1" },
      expected: { entryFormat: undefined, policy: "SOLO_ONLY", min: 1, max: 1 },
    },
  ];

  for (const { label, params, expected } of cases) {
    const actual = decode(params);

    report(
      label,
      same(actual, expected),
      `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
  }
}

/**
 * A radius-free URL must build exactly the query it built before radius search
 * existed.
 *
 * Asserted rather than assumed, because the change that would break it is not
 * an obvious one: `buildLocationClause` now composes an array of arms, and the
 * natural way to write that wraps a lone arm in a one-element `OR`. Prisma
 * treats `{ OR: [x] }` and `x` as equivalent, so every test would still pass and
 * every existing bookmark, shared link and preset would still work — but the
 * generated SQL would change shape for every location search on the platform,
 * and nothing would have flagged it.
 *
 * The clauses below are the literal output from before radius was added.
 */
async function verifyRadiusFreeQueriesAreUnchanged(): Promise<void> {
  const areaOnly = buildLocationClause({
    searchAreaIds: ["area-a", "area-b"],
    includeOnline: false,
  });

  report(
    "radius-free: a resolved place still builds the bare search-area clause",
    JSON.stringify(areaOnly) ===
      JSON.stringify({
        locations: {
          some: {
            location: {
              searchAreas: {
                some: { searchAreaId: { in: ["area-a", "area-b"] } },
              },
            },
          },
        },
      }),
    JSON.stringify(areaOnly),
  );

  const withOnline = buildLocationClause({
    searchAreaIds: ["area-a"],
    includeOnline: true,
  });

  report(
    "radius-free: includeOnline still builds the same two-armed OR",
    JSON.stringify(withOnline) ===
      JSON.stringify({
        OR: [
          {
            locations: {
              some: {
                location: {
                  searchAreas: { some: { searchAreaId: { in: ["area-a"] } } },
                },
              },
            },
          },
          { mode: "ONLINE" },
        ],
      }),
    JSON.stringify(withOnline),
  );

  const nothing = buildLocationClause({
    searchAreaIds: [],
    includeOnline: false,
  });

  report(
    "radius-free: a place matching no area is still MATCHES_NOTHING",
    JSON.stringify(nothing) === JSON.stringify({ id: { in: [] } }),
    JSON.stringify(nothing),
  );

  const onlineOnly = buildLocationClause({
    searchAreaIds: [],
    includeOnline: true,
  });

  report(
    "radius-free: no areas + includeOnline still yields online-only, not everything",
    JSON.stringify(onlineOnly) ===
      JSON.stringify({ OR: [{ id: { in: [] } }, { mode: "ONLINE" }] }),
    JSON.stringify(onlineOnly),
  );

  // End to end: a URL naming no location parameters must not acquire any
  // location restriction now that three more parameters are owned by the spec.
  for (const params of [
    {},
    { search: "ai" },
    { modes: "ONLINE", page: "2" },
    // A radius with nothing to centre it on, and a half-set device centre:
    // both must leave the query exactly as if they were absent.
    { radius: "25" },
    { lat: "18.52" },
    { lng: "73.85", radius: "50" },
  ] as RawSearchParams[]) {
    const plan = await planCompetitionSearch({ scope: "public", params });

    const serialized = JSON.stringify(buildCompetitionQuery(plan).where);

    report(
      `no location clause for ${JSON.stringify(params)}`,
      !serialized.includes("searchAreas") &&
        !serialized.includes("latitude") &&
        !serialized.includes("locations"),
      serialized,
    );
  }
}

async function main(): Promise<void> {
  await verifyCaseInsensitivity();
  await verifyGracefulDegradation();
  await verifyNoEmptyInOrOr();
  await verifyScopeGuardEnforcement();
  await verifyDefinitionValidation();
  await verifySortDeterminism();
  await verifyWildcardEscaping();
  await verifyCodecRoundTrip();
  await verifyResolvedLocationNeverWidens();
  await verifyPlanSymmetry();
  verifyChipRemoval();
  verifyClearAll();
  verifyPaginationPreservesSearch();
  await verifyTeamSizeSemantics();
  verifyEntryFormatCoordination();
  await verifyRadiusFreeQueriesAreUnchanged();

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  await prisma.$disconnect();

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
