# Phase 1 — Implementation Design & Edge Cases

Implementation-ready specification for the shared search core. Everything
here was validated against the running application and database, not
assumed. Where this document contradicts
[02-core-architecture.md](02-core-architecture.md), **this document wins** —
§1 lists the corrections.

---

## 1. Corrections to the architecture doc

Investigation invalidated three parts of the original design. Better to
find them now than mid-implementation.

### 1.1 A filter can own more than one URL parameter — the contract was wrong

`02` declared `decode: (raw: string | undefined)`, i.e. one parameter per
filter. But it *also* specified `dateRangeFilter` as "one descriptor owning
both `startDateFrom` and `startDateTo`". Those two statements are
incompatible.

**Correction:** a descriptor declares `keys: readonly string[]` and receives
a bag of all params it owns. Single-key filters are the degenerate case.

### 1.2 Params are not `Record<string, string | undefined>`

Verified against the running app: Next.js delivers repeated query
parameters as **arrays**.

```text
GET /competitions?modes=ONLINE&modes=HYBRID
→ Invalid input: expected string, received array   (page renders its error state)
```

The Phase 0 widening to `Record<string, string | undefined>` is therefore
still wrong. The correct shape is:

```ts
export type RawSearchParams = Record<string, string | string[] | undefined>;
```

### 1.3 Empty collections are not neutral in Prisma — guards are mandatory

Measured against the live database (23 public competitions):

| Clause | Rows matched | Meaning |
| --- | --- | --- |
| `{ AND: [] }` | 23 | matches everything — safe |
| `{ NOT: [] }` | 23 | matches everything — safe |
| `{ OR: [] }` | **0** | **matches nothing** |
| `{ mode: { in: [] } }` | **0** | **matches nothing** |

`?modes=` parses to `[]`. A primitive that naively emits `{ mode: { in: []
} }` silently returns **zero results** instead of "no filter applied". The
existing hand-written code is safe only because every branch is guarded by
`if (filters.x?.length)`. Any generic primitive **must** replicate that
guard, and it must be enforced structurally rather than by convention.

This is the single most dangerous edge case in the subsystem.

---

## 2. Verified environment facts

| Fact | Value | Consequence |
| --- | --- | --- |
| Zod | **4.4.3** | `z.enum()` accepts native enums; `z.nativeEnum` deprecated but present |
| Test runner | **none installed** | see §8 — parity is verified by a `tsx` script, no new dependency |
| Prisma | 6.14.0 | `orderBy` accepts arrays (already relied on by the Phase 0 tiebreaker) |
| Repeated params | arrive as `string[]` | §1.2 |
| Empty `in`/`OR` | match nothing | §1.3 |
| `contains` wildcards | **not escaped** | §4.C.6 |

### Indexes relevant to sorting (`prisma/schema.prisma`)

`Competition` has indexes on `status`, `visibility`, `deletedAt`,
`startDate`, `registrationDeadline`, `createdById`, `updatedById`.

**`createdAt` and `title` are not indexed** — yet `createdAt desc` is the
*default* sort (`CompetitionSort.NEWEST`). Every unfiltered listing page
currently performs an unindexed sort. Not urgent at 23 rows; it will matter,
and it is cheap to fix with a migration later. Recorded here rather than
acted on, because adding indexes is a schema change outside this phase.

---

## 3. The failure mode that drives the design

The current page is brittle to any unexpected URL. Verified live — each of
these renders the error state with a raw Zod JSON dump instead of results:

| URL | Current result |
| --- | --- |
| `?modes=ONLINE&modes=HYBRID` | error page (`received array`) |
| `?modes=BANANA` | error page (`Invalid option`) |
| `?modes=ONLINE,BANANA` | error page — one bad token kills the whole query |
| `?statuses=upcoming` | error page — only `modes` is case-normalised |
| `?page=0` | error page (`Too small`) |
| `?limit=1000` | error page (`Too big`) |
| `?startDateFrom=` | error page (invalid date) |

This matters more than it looks. Search URLs get **shared, bookmarked,
hand-edited, and outlive schema changes**. A saved search from six months
ago referencing a since-removed enum value must not produce a broken page.
And leaking raw validator internals to end users is its own smell.

### Policy: total-failure validation → graceful degradation

The core parses **per filter**, not per request. An unparseable filter
contributes no clause and is dropped from the canonical URL; it never
prevents the rest of the search from running.

| Situation | Behaviour |
| --- | --- |
| Unknown/invalid token in a multi-value filter | drop that token, keep the valid ones |
| All tokens invalid | filter treated as absent |
| Invalid scalar (date, number) | filter treated as absent |
| `page` / `limit` out of range | **clamped**, not rejected |
| Unknown parameter key | ignored |

Only a genuinely impossible request (unknown scope) throws.

**Trade-off, stated explicitly:** this hides typos. `?modes=ONLIN` silently
returns unfiltered results rather than telling the user they made a
mistake. That is the right default for a *discovery* surface — but the
active-filter chips (Phase 2) become the mechanism that makes it visible,
because a dropped filter simply has no chip. This is why the chips are
derived from decoded values and not from the raw URL.

---

## 4. Edge-case catalogue

Every case below has an explicit decision. `[G]` marks ones enforced by a
guard in the core rather than left to a filter author.

### A. URL and parsing

| # | Case | Decision |
| --- | --- | --- |
| A1 | `?modes=` (empty value) | Treat as absent. `[G]` empty array never reaches `toWhere` |
| A2 | `?modes=ONLINE&modes=HYBRID` (repeated) | Accept `string[]`; flatten and treat as multi-value |
| A3 | `?modes=BANANA` | Drop token; filter absent |
| A4 | `?modes=ONLINE,BANANA` | Keep `ONLINE` |
| A5 | `?statuses=upcoming` (case) | Uppercase-normalise **all** enum filters, not just `modes` |
| A6 | `?modes=ONLINE,ONLINE` | Dedupe before building the clause |
| A7 | 5 000 comma-separated values | Cap at `MAX_FILTER_VALUES = 50`; excess dropped `[G]` |
| A8 | Unknown key `?foo=bar` | Ignored. `clearAll` only removes registry-known keys, so unknown keys survive a reset — acceptable and documented |
| A9 | Filter key collides with `page`/`limit`/`sort` | Registry construction **throws** |
| A10 | Two filters declare the same key | Registry construction **throws** |
| A11 | Surrounding whitespace | Trimmed (existing behaviour, preserved) |
| A12 | A value legitimately containing a comma — e.g. organizer `"Acme, Inc"` | **Known limitation.** CSV encoding cannot represent it; it splits into two tokens. Affects only free-text multi filters (`organizers`). Recorded in §9 |

### B. Numbers and dates

| # | Case | Decision |
| --- | --- | --- |
| B1 | `page=0`, `page=-3` | Clamp to 1 |
| B2 | `page=abc`, `page=2.5` | Default to 1 |
| B3 | `page=1e999` / overflow | Clamp to `MAX_PAGE` |
| B4 | `limit=1000` | Clamp to 100 |
| B5 | `limit=0` | Clamp to 1 |
| B6 | `page` beyond `totalPages` | Return empty items with honest metadata; do **not** redirect or clamp to the last page — a redirect would fight the back button |
| B7 | Deep pagination (`OFFSET 20000`) | Accept for now; cursor pagination noted as future work in §9 |
| B8 | `startDateFrom=notadate` / `=''` | Filter absent |
| B9 | `startDateFrom > startDateTo` | Left as-is → empty result. Logically honest; the UI should prevent it. Not silently swapped, which would surprise |
| B10 | Date has no timezone (`2026-01-01`) | Parsed as **UTC midnight**. For IST users "from 1 Jan" is off by 5h30m. Preserved as-is; flagged in §9 as needing a product decision |
| B11 | `minTeamSize > maxTeamSize` | Empty result, as above |

### C. Prisma query composition

| # | Case | Decision |
| --- | --- | --- |
| C1 | `{ in: [] }` matches nothing | `[G]` core drops empty-array filters before `toWhere` |
| C2 | `{ OR: [] }` matches nothing | `[G]` same guard; `orFilter` primitive additionally refuses to emit an empty `OR` |
| C3 | `{ AND: [] }` matches everything | Safe; used as the neutral element |
| C4 | Nested `AND` from scope wrapping | Flattened to a single level. Semantically identical (verified: nested `AND` → 23 rows, same as flat) |
| C5 | Rows with `NULL` in a filtered column | Never match an `in` filter. Correct, but means a competition with `mode = null` is invisible to any mode filter. Documented, not changed |
| C6 | `%` and `_` in free-text search | **Confirmed unescaped.** `contains: "ET%26"` matched *"ETHGlobal New Delhi 2026"* — `%` acted as a wildcard. The text primitive must escape `\`, `%`, `_`, with a parity test proving it. Not a SQL-injection risk (Prisma parameterises); a correctness bug |
| C7 | Very long free-text input | Cap at 200 chars |

### D. Scope and authorization

| # | Case | Decision |
| --- | --- | --- |
| D1 | Unknown scope id | **Throw.** Fail closed — never silently fall back to unscoped |
| D2 | Management scope with `actorId == null` | **Throw.** `members.some.userId: null` would be a silent leak |
| D3 | Admin scope has an empty guard | Permitted, but the scope must set `requiresPlatformAction`, making the upstream requirement explicit and greppable |
| D4 | A registry filter targets a guarded column (e.g. `visibility`) | Registry/scope validation **throws** at construction. This is the mechanised form of the Projects defect |
| D5 | Guard vs. user-filter precedence | All clauses are `AND`-composed, so a user filter can only ever *narrow*, never widen. No primitive emits `NOT`/`OR` at top level, so a guard cannot be escaped |
| D6 | Banned actor | Unchanged — handled upstream by `PlatformPolicy` |

### E. Sorting

| # | Case | Decision |
| --- | --- | --- |
| E1 | Unknown sort token | Fall back to default (do not throw) |
| E2 | Primary sort is already `id` | Dedupe so the tiebreaker isn't repeated |
| E3 | `NULL`s in `startDate` / `registrationDeadline` | Needs an explicit choice per sort. **Proposal:** nulls last for ascending "soonest" sorts. Requires Prisma `nulls` support — verify during implementation; if unsupported, document rather than hack |
| E4 | Default sort is unindexed (`createdAt`) | Flagged in §2; schema change out of scope |

### F. Results and pagination

| # | Case | Decision |
| --- | --- | --- |
| F1 | `total = 0` | `totalPages = 0`, both `hasNextPage`/`hasPreviousPage` false. Verified correct |
| F2 | `count` and `findMany` run in parallel | A concurrent insert can make `total` disagree with `items` by one. Accepted; not worth a transaction |
| F3 | `where` rebuilt twice per request | Fixed — built once and shared by both queries |

---

## 5. Corrected contracts

```ts
// src/lib/search/types.ts

/** Next.js delivers repeated query params as arrays. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Only the parameters one filter owns. */
export type FilterParams = Record<string, string | string[] | undefined>;

export type FilterKind =
  | "enum-multi"
  | "relation-slug-multi"
  | "relation-id-multi"
  | "text"
  | "number-bound"
  | "date-range"
  | "boolean";

export interface FilterUiMeta {
  readonly label: string;
  readonly group: "quick" | "advanced";
  readonly weight?: number;
  readonly options?: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * @typeParam TWhere  the entity's Prisma where-input
 * @typeParam TValue  this filter's decoded value
 */
export interface FilterDescriptor<TWhere, TValue> {
  readonly key: string;
  /** Every URL parameter this filter owns. Usually `[key]`; date ranges own two. */
  readonly keys: readonly string[];
  readonly kind: FilterKind;
  /** Never throws — returns undefined when the filter is absent or unusable. */
  readonly decode: (params: FilterParams) => TValue | undefined;
  /** Canonical URL form. Omit a key by returning undefined for it. */
  readonly encode: (value: TValue) => Record<string, string | undefined>;
  /** Only ever called with a decoded, non-empty value. */
  readonly toWhere: (value: TValue) => TWhere;
  readonly ui: FilterUiMeta;
}

/** Value-type erased — safe inside heterogeneous registries. */
export interface BoundFilter<TWhere> {
  readonly key: string;
  readonly keys: readonly string[];
  readonly kind: FilterKind;
  readonly ui: FilterUiMeta;
  readonly toWhereFromParams: (params: RawSearchParams) => TWhere | undefined;
  readonly normalize: (params: RawSearchParams) => Record<string, string | undefined>;
  readonly isActive: (params: RawSearchParams) => boolean;
}
```

`bindFilter` performs the existential erasure exactly as in `02`, and adds
the mandatory emptiness guard from §1.3 — `toWhere` is unreachable for an
empty value, so no filter author can reintroduce C1/C2.

---

## 6. Primitive specifications

Each primitive states its guards. All of them share: trim → flatten arrays →
split CSV → drop blanks → dedupe → cap at 50 → **if empty, return
`undefined`**.

| Primitive | Emits | Guards beyond the shared set |
| --- | --- | --- |
| `enumMultiFilter` | `{ col: { in: v } }` | uppercase-normalise; drop values outside the enum |
| `relationSlugMultiFilter` | `{ rel: { some: { x: { slug: { in: v } } } } }` | lowercase-normalise |
| `enumRelationMultiFilter` | `{ rel: { some: { type: { in: v } } } }` | as enum |
| `relationIdMultiFilter` | `{ rel: { some: { xId: { in: v } } } }` | ids kept verbatim |
| `textContainsFilter` | `{ col: { contains, mode: "insensitive" } }` | escape `\ % _`; cap 200 chars |
| `textContainsAnyFilter` | `{ OR: [...] }` | never emits an empty `OR` |
| `multiFieldTextFilter` | `{ OR: [{a},{b}] }` | same escaping; fields fixed at declaration |
| `numberBoundFilter` | `{ col: { gte \| lte } }` | integer, positive, finite |
| `dateRangeFilter` | `{ col: { gte?, lte? } }` | owns two keys; emits only if ≥1 bound valid |

---

## 7. Behaviour preservation

The migration's safety argument rests on proving the new engine produces
**deep-equal `where`/`orderBy` output** to the current
`CompetitionWhereBuilder` across a matrix of inputs.

Deliberate exceptions — cases where output *must* differ because the current
behaviour is a defect:

1. Inputs that currently **throw** (A2–A5, B1–B5, B8) now degrade
   gracefully. Parity is asserted only over inputs the old builder accepts.
2. Free-text values containing `%` or `_` now escape them (C6).
3. `AND` nesting is flattened (C4) — verified equivalent, compared
   semantically rather than structurally.

Everything else must match exactly.

---

## 8. Testing approach — no new dependency

The repository has **no test runner**. Rather than adding one mid-refactor,
parity is proven by a script run through `tsx`, which is already a
devDependency:

```text
pnpm exec tsx scripts/verify-search-parity.ts
```

It enumerates a matrix of filter combinations, runs both the legacy builder
and the new engine, deep-compares the resulting `where`/`orderBy`, and
additionally asserts the invariants that cannot regress:

- no filter ever emits an empty `in` or `OR` (C1/C2)
- every scope's `allowedFilters` is disjoint from its guarded columns (D4)
- every sort resolves to an `orderBy` ending in the tiebreaker (E2)
- decode→encode→decode is stable for every filter (canonical URLs)

Adopting Vitest properly is worth doing and is recommended, but it is a
tooling decision for the team rather than something to slip into this
change. The script is written so its cases port directly to `describe`/`it`
when a runner is adopted.

---

## 8.5 Corrections made during implementation

Two further departures from the design, discovered while writing the code
in `src/lib/search/`. Recorded here for the same reason §1 exists: better
to admit a design was wrong than to let the docs and code quietly diverge.

**No Zod schema derivation.** §8 of `02-core-architecture.md` proposed
`deriveSearchSchema` — generating a Zod schema from the registry. It turned
out unnecessary: each `FilterDescriptor.decode` already validates and
normalises directly from `RawSearchParams`, never throws, and *is* the
"graceful degradation" policy from §3. Interposing Zod would mean
validating twice, in two different failure styles (throwing vs.
degrading), for no benefit. `schema.ts` was dropped from the plan.

**Scope-guard collision detection is a naming convention, not static
analysis.** §5 (`02`) implied the engine could inspect a scope's `guard`
output to detect which Prisma columns it constrains, and reject a filter
that touches the same column. That is not generally possible — `guard`
takes an opaque context and its return shape can't be inspected without
calling it, which is unsafe to do speculatively at registry-definition
time. The actual mechanism: `SearchScope.guardedKeys: readonly string[]`
is a list of filter *keys* (not columns) a scope owner declares as
guarded, and `defineSearch` rejects a registry where a filter shares one of
those keys. This only works because a module author names things
consistently (a `visibility` guard and a hypothetical `visibility` filter
share the word) — it is a lint, not a proof. Documented as a real,
acknowledged limit of the mechanism rather than overclaiming.

---

## 8.6 Defects found in post-implementation review

A deliberate review pass over the Phase 0 + Phase 1 work, reading the new
code against what it replaces rather than trusting the green test run.
Recorded because several were found by *reading*, not by the tests — which
is itself the finding.

### Fixed

1. **`location` filter silently dropped `mode: "insensitive"`.** The legacy
   builder matched location case-insensitively; the new registry did not.
   The parity suite passed anyway, because its only location case
   (`"Delhi"`) matched the fixture's exact casing. Fixed, and the suite
   gained case-varied cases for every case-insensitive filter — verified to
   genuinely fail against the reintroduced bug before being accepted.
2. **`PlatformAuthorizer.can(..., VIEW_PUBLIC_PROJECTS)`, enabled in Phase 0,
   was a live regression.** `VIEW_PUBLIC_PROJECTS` was granted only to
   `USER`. Enabling the check therefore 403'd `ADMIN` and `SUPER_ADMIN` on
   `GET /api/v1/projects`, and threw a `TypeError` (500) for `MODERATOR`,
   which had no permission-set entry at all. Fixed by introducing an
   explicit `BASELINE` capability list every role spreads in — the
   evaluator does a flat lookup with no inheritance, so elevating a user
   would otherwise *remove* baseline abilities.
3. **`enumRelationMultiFilter` mislabelled its `kind`** as
   `relation-slug-multi`. `kind` selects the UI control, so eligibility —
   a short, fixed enum list — would have rendered as a searchable async
   relation picker in Phase 2. Now correctly `enum-multi`.
4. **`defineSearch` only validated `filter.key`, not owned parameters.**
   A range filter owns *derived* keys (`startDate` → `startDateFrom`/`To`),
   so two filters could fight over the same URL parameter with distinct
   keys, and a reserved parameter could be claimed via a derived key. Now
   validates every owned parameter; the six validation cases are asserted
   in the parity suite.
5. Redundant `kind` override in `multiFieldTextFilter`, and a `definition.ts`
   docstring claiming *structural* parity when the suite deliberately
   compares row ids (the engine flattens `AND` where the legacy scope
   builders nest it).

### Hardened (pre-existing, made newly reachable)

6. **`AuthorizationEvaluator.permission` threw on an unknown role** rather
   than denying — `permissionSet[role]` being `undefined` reached
   `.has()`. Pre-existing and affecting every action, but Phase 0's change
   put it on a public endpoint. Now fails closed.

### Found, deliberately not fixed

7. **`CREATE_PROJECT` is granted to no role**, yet `ProjectService.create`
   requires it — so `POST /api/v1/projects` currently denies everyone.
   Pre-existing and unrelated to search. Not fixed here because "who may
   create a project" is a product decision, not a mechanical one.
8. **`MODERATOR`'s real capabilities are undefined.** It now carries only
   the baseline so that permission checks resolve instead of throwing; its
   actual moderation powers need a product decision.

---

## 9. Open items surfaced by this analysis

Recorded rather than decided — several need product input.

1. **Team-size filter semantics are probably wrong.** `minTeamSize={gte:X}`
   filters on the *competition's own* minimum. A user filtering "team of 4"
   almost certainly means *"a competition that accepts a team of 4"* —
   `minTeamSize <= 4 AND (maxTeamSize >= 4 OR maxTeamSize IS NULL)`. Current
   behaviour is preserved for parity; changing it is a product decision.
2. **Date timezone** (B10) — UTC vs. user-local interpretation.
3. **Comma-containing free-text values** (A12) — affects `organizers`;
   relates to the organizer-normalisation question in
   [06-open-questions.md](06-open-questions.md#4-organizer-normalization).
4. **`createdAt` / `title` are unindexed** yet used for the default and
   alphabetical sorts (§2).
5. **Cursor pagination** for deep paging (B7).
6. **Nulls ordering** support in Prisma for E3.
7. **Adopting Vitest** (§8).
