# Core Search Architecture

The shared, entity-agnostic search engine. Competitions, Projects, Blogs and
anything later are consumers of these primitives, not reimplementations of
them.

Code below is **design intent**, not committed code. It is written to be
type-correct against the real Prisma types in this repository so that
implementation is transcription rather than reinterpretation.

> **Superseded in parts.** Implementation investigation invalidated three
> elements of this document — the single-parameter `FilterDescriptor`
> contract (§3), the `RawSearchParams` shape, and the assumption that empty
> filter collections are neutral in Prisma. See
> [07-implementation-design.md §1](07-implementation-design.md#1-corrections-to-the-architecture-doc)
> for the corrections. The principles, boundary, scope model and testing
> strategy here remain current.

---

## 1. The boundary — what is generic, what stays module-owned

The single most important design decision. Getting this wrong produces
either a useless abstraction (too thin) or a straitjacket (too thick).

### Generic — belongs to the core

- Pagination input parsing, `skip`/`take` math, and the result envelope
- `AND`-of-groups composition strategy
- Filter *primitive kinds*: enum-multi, relation-slug-multi, relation-id-multi,
  text-contains, number-range, date-range, boolean
- URL encode/decode (the CSV convention)
- Sort registry mechanics, direction handling, mandatory tiebreaker
- Scope enforcement mechanics
- Schema derivation from the registry
- Frontend: URL-state hook, generic controls, active-chip derivation, reset

### Module-owned — never in the core

- Which fields exist, and their Prisma column names
- Domain enums (`CompetitionMode` vs `ProjectStatus`)
- The sort catalogue (`start-date-asc` is meaningless to a blog)
- Scope predicates (competition membership ≠ project membership ≠ blog authorship)
- Select shapes, DTOs, mappers
- Labels, grouping, and UX priority

The core knows *how* to compose a query. Only the module knows *what* it is
composing. The core never contains the word `Competition`.

### Location

```text
src/lib/search/            ← entity-agnostic core (server + shared types)
  types.ts                 ← contracts
  filters/                 ← primitive factories (enumMulti, textContains, …)
  compose.ts               ← AND composition, the one sanctioned cast
  scope.ts                 ← scope contracts + enforcement
  sort.ts                  ← sort registry + tiebreaker
  pagination.ts            ← parse + skip/take + envelope
  engine.ts                ← buildSearchQuery()
  schema.ts                ← deriveSchema() from a registry
  url.ts                   ← CSV codec, param read/write helpers (client-safe)

src/components/search/     ← generic client controls
src/modules/<entity>/search/  ← per-entity registry + scopes + sorts
```

`src/lib/` is the established home for cross-cutting infrastructure in this
repository (`lib/errors`, `lib/http`, `lib/validation`), so search belongs
there rather than in the empty `modules/common/`. Frontend generics go to
`src/components/search/` alongside `components/ui`.

---

## 2. The single-registry principle

A filter is declared **once**. Four artifacts are derived from that one
declaration:

```text
                    ┌──────────────────────┐
                    │  FilterDescriptor    │
                    │  (declared once)     │
                    └──────────┬───────────┘
                               │
         ┌─────────────┬───────┴───────┬──────────────┐
         ▼             ▼               ▼              ▼
   Zod schema    Prisma where     URL codec     UI metadata
   (validation)   fragment      (encode/decode)  (label, kind,
                                                  options, group)
```

This is what makes the system genuinely extensible: **adding a filter is one
registry entry**, and it simultaneously becomes validated, queryable,
shareable via URL, and rendered — with no opportunity for the four to drift
apart. It also satisfies the "do not duplicate backend validation logic"
requirement structurally: the descriptor *carries* its Zod fragment, and the
module's search schema is generated from the registry rather than
hand-maintained beside it.

---

## 3. Type-safe contracts

### The descriptor

```ts
// src/lib/search/types.ts
import type { z } from "zod";

export type FilterKind =
  | "enum-multi"
  | "relation-slug-multi"
  | "relation-id-multi"
  | "text"
  | "number-range"
  | "date-range"
  | "boolean";

export interface FilterUiMeta {
  readonly label: string;
  readonly group: "quick" | "advanced";
  /** Lower sorts earlier within its group. */
  readonly weight?: number;
  readonly options?: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * Declares one filter for one entity.
 *
 * @typeParam TWhere  the entity's Prisma where-input
 * @typeParam TValue  the decoded value this filter operates on
 */
export interface FilterDescriptor<TWhere, TValue> {
  readonly key: string;
  readonly kind: FilterKind;
  /** The single source of validation. Also performs URL decoding. */
  readonly schema: z.ZodType<TValue | undefined>;
  /** Back to a URL parameter value. `undefined` omits the param. */
  readonly encode: (value: TValue) => string | undefined;
  /** The Prisma fragment this filter contributes. */
  readonly toWhere: (value: TValue) => TWhere;
  readonly ui: FilterUiMeta;
}
```

Note `toWhere` returns the entity's own `TWhere`. When a module writes
`toWhere: (modes) => ({ mode: { in: modes } })` against
`Prisma.CompetitionWhereInput`, TypeScript verifies that `mode` is a real
column and that `in` accepts `CompetitionMode[]`. Full autocomplete, full
checking, zero casts at the call site.

### Heterogeneous collections without `any`

A registry holds filters of many different `TValue` types. Typing it as
`FilterDescriptor<TWhere, any>[]` would surrender type safety at exactly the
point it matters. Instead, erase `TValue` existentially by capturing it in a
closure:

```ts
/** A filter with its value type erased — safe in heterogeneous arrays. */
export interface BoundFilter<TWhere> {
  readonly key: string;
  readonly kind: FilterKind;
  readonly ui: FilterUiMeta;
  /** undefined = filter not supplied, contributes no clause. */
  readonly toWhereFromRaw: (raw: string | undefined) => TWhere | undefined;
  readonly normalize: (raw: string | undefined) => string | undefined;
  readonly schema: z.ZodType<unknown>;
}

export function bindFilter<TWhere, TValue>(
  descriptor: FilterDescriptor<TWhere, TValue>,
): BoundFilter<TWhere> {
  const decode = (raw: string | undefined): TValue | undefined => {
    const parsed = descriptor.schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };

  return {
    key: descriptor.key,
    kind: descriptor.kind,
    ui: descriptor.ui,
    schema: descriptor.schema,
    toWhereFromRaw: (raw) => {
      const value = decode(raw);
      return value === undefined ? undefined : descriptor.toWhere(value);
    },
    normalize: (raw) => {
      const value = decode(raw);
      return value === undefined ? undefined : descriptor.encode(value);
    },
  };
}
```

`TValue` never appears in `BoundFilter`, yet every operation on it remains
fully typed inside the closure. This is the standard encoding of an
existential type in TypeScript and it is the mechanism that lets the core be
generic **and** `any`-free.

### The one sanctioned cast

Prisma where-inputs all admit `AND?: Self | Self[]`, but TypeScript cannot
prove that an arbitrary `TWhere` is constructible from `{ AND: [...] }`. The
core therefore contains exactly one cast, isolated and documented:

```ts
// src/lib/search/compose.ts

/** Constraint satisfied by every Prisma where-input. */
export type AndComposable<Self> = { AND?: Self | Self[] };

/**
 * The only cast in the search core.
 *
 * Safe because `TWhere extends AndComposable<TWhere>` guarantees `AND` is a
 * valid member, and Prisma where-inputs have no required fields. Do not add
 * further casts; extend this primitive instead.
 */
export function composeAnd<TWhere extends AndComposable<TWhere>>(
  clauses: readonly TWhere[],
): TWhere {
  return { AND: [...clauses] } as TWhere;
}
```

---

## 4. Filter primitives

Typed factories so modules declare intent, not plumbing. Each reproduces the
exact semantics Competitions already uses.

```ts
// src/lib/search/filters/enum-multi.ts
export function enumMultiFilter<TWhere, TEnum extends string>(config: {
  key: string;
  values: readonly [TEnum, ...TEnum[]];
  toWhere: (values: TEnum[]) => TWhere;
  ui: FilterUiMeta;
  /** Uppercase incoming tokens before validation (Competitions' `modes`). */
  uppercase?: boolean;
}): FilterDescriptor<TWhere, TEnum[]>;
```

Declaration site, fully checked:

```ts
enumMultiFilter<Prisma.CompetitionWhereInput, CompetitionMode>({
  key: "modes",
  values: [CompetitionMode.ONLINE, CompetitionMode.OFFLINE, CompetitionMode.HYBRID],
  uppercase: true,
  toWhere: (modes) => ({ mode: { in: modes } }),
  ui: { label: "Mode", group: "quick", weight: 10 },
});
```

This emits `{ mode: { in: [...] } }` — byte-identical to today's
`buildCompetition`. The refactor is behaviour-preserving.

Other primitives, each mapping to a pattern already present in the codebase:

| Primitive | Emits | Replaces |
| --- | --- | --- |
| `enumMultiFilter` | `{ col: { in: [...] } }` | `buildCompetition` |
| `relationSlugMultiFilter` | `{ rel: { some: { x: { slug: { in: [...] } } } } }` | `buildCategories`, `buildTechnologies` |
| `enumRelationMultiFilter` | `{ rel: { some: { type: { in: [...] } } } }` | `buildEligibility` |
| `textContainsFilter` | `{ col: { contains, mode: "insensitive" } }` | `buildLocation` |
| `textContainsAnyFilter` | `{ OR: [...contains] }` | `buildOrganizer` |
| `multiFieldTextFilter` | `{ OR: [{a:{contains}},{b:{contains}}] }` | `buildSearch` |
| `numberBoundFilter` | `{ col: { gte \| lte } }` | `buildTeam` |
| `dateRangeFilter` | `{ col: { gte?, lte? } }` | `buildDates` |

`dateRangeFilter` is worth noting: today `startDateFrom`/`startDateTo` are
two independent schema fields hand-assembled into one clause. As a primitive
it is **one** descriptor owning both URL params, which removes the
possibility of one being handled and the other forgotten.

---

## 5. Scope — the defect-proofing mechanism

Directly addresses the Projects vulnerability
([01, §D](01-current-state.md#d-live-defect--project-visibility-is-caller-controlled)).

```ts
// src/lib/search/scope.ts
export interface SearchScope<TWhere, TContext> {
  readonly id: string;
  /**
   * Filter keys the caller may supply in this scope.
   * "all" permits every registered filter.
   * Anything not listed is ignored if supplied — never honoured.
   */
  readonly allowedFilters: ReadonlySet<string> | "all";
  /**
   * Non-negotiable predicates ANDed into every query in this scope.
   * Not expressible by the caller. This is where visibility and
   * ownership live.
   */
  readonly guard: (context: TContext) => readonly TWhere[];
}
```

Two invariants the engine enforces:

1. **Guards always apply.** A query cannot be built without a scope; there
   is no unscoped entry point.
2. **Guard-controlled columns are never filterable.** Any parameter outside
   `allowedFilters` is dropped before composition, so
   `?visibility=UNLISTED` cannot influence a public-scope query even if
   someone later adds `visibility` to a registry by mistake.

Competitions' three builders become three scopes with no behaviour change:

```ts
const publicScope: SearchScope<Prisma.CompetitionWhereInput, Ctx> = {
  id: "public",
  allowedFilters: "all",
  guard: () => [{ visibility: "PUBLIC" }],
};

const managementScope = {
  id: "management",
  allowedFilters: "all",
  guard: (ctx) => [{ members: { some: { userId: ctx.actorId } } }],
};

const adminScope = {
  id: "admin",
  allowedFilters: "all",
  guard: () => [],           // requires PlatformAction.VIEW_ALL_COMPETITIONS upstream
};
```

Admin scope carries a `requires` marker (see §9) so the missing-safeguard
risk noted in [01, §A](01-current-state.md) is closed rather than merely
documented.

---

## 6. Sorting

Standardise on Competitions' single-token model, not Projects'
`sortBy`+`sortOrder`. Reasons: one URL parameter instead of two; the set of
legal sorts is an explicit allowlist rather than a dynamic key; and each
sort can be reviewed against the table's indexes.

```ts
export interface SortOption<TOrderBy> {
  readonly key: string;                    // URL token, e.g. "start-date-asc"
  readonly label: string;
  readonly orderBy: readonly TOrderBy[];   // primary key(s), tiebreaker appended
}

export interface SortRegistry<TOrderBy> {
  readonly options: readonly SortOption<TOrderBy>[];
  readonly defaultKey: string;
  /** Appended to every sort. Guarantees deterministic pagination. */
  readonly tiebreaker: TOrderBy;
}
```

The engine appends `tiebreaker` to every resolved sort, fixing limitation 6.
`orderBy` becomes an array (Prisma supports this) rather than today's single
object.

Nullable sort columns (`startDate`, `registrationDeadline`) should declare
null placement explicitly rather than inheriting database defaults — a
competition with no start date should sort last, not first.

---

## 7. Pagination and the result envelope

One shape for every entity, fixing limitations 2 and 12:

```ts
export interface SearchResult<T> {
  readonly items: T[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
  };
}
```

Identical to Competitions' existing `CompetitionSearchResult<T>`, which is
simply promoted to the core. Projects adopts it and gains the totals it
currently lacks. The URL parameter is standardised as `limit` across all
entities; Projects' `pageSize` is renamed.

---

## 8. Schema derivation

The module never hand-writes a search schema. It is generated:

```ts
export function deriveSearchSchema<TWhere>(
  filters: readonly BoundFilter<TWhere>[],
  sorts: SortRegistry<unknown>,
  pagination: { defaultLimit: number; maxLimit: number },
): z.ZodType<ParsedSearchParams>;
```

One registry, one schema, guaranteed in sync. Adding a filter cannot leave
validation behind.

---

## 9. The engine

```ts
export interface SearchDefinition<TWhere, TOrderBy, TContext> {
  readonly entity: string;
  readonly filters: readonly BoundFilter<TWhere>[];
  readonly sorts: SortRegistry<TOrderBy>;
  readonly scopes: Readonly<Record<string, SearchScope<TWhere, TContext>>>;
  readonly pagination: { defaultLimit: number; maxLimit: number };
}

export interface SearchQuery<TWhere, TOrderBy> {
  readonly where: TWhere;
  readonly orderBy: readonly TOrderBy[];
  readonly skip: number;
  readonly take: number;
}

export function buildSearchQuery<
  TWhere extends AndComposable<TWhere>,
  TOrderBy,
  TContext,
>(args: {
  definition: SearchDefinition<TWhere, TOrderBy, TContext>;
  params: Readonly<Record<string, string | undefined>>;
  scope: string;
  context: TContext;
  /** Always ANDed first, e.g. `{ deletedAt: null }`. */
  baseClauses?: readonly TWhere[];
}): SearchQuery<TWhere, TOrderBy>;
```

Composition order, mirroring today's behaviour exactly:

```text
composeAnd([
  ...baseClauses,          // deletedAt: null
  ...filterClauses,        // one per supplied, scope-allowed filter
  ...scope.guard(context), // visibility / ownership — always last, always applied
])
```

Because `where` is built once and returned, the `findMany`/`count` pair can
share it instead of rebuilding independently, fixing limitation 7.

---

## 10. The client/server split

A real constraint worth designing around rather than discovering during
implementation: **`@/generated/prisma` must not reach the browser bundle.**
The registry as sketched holds both `toWhere` (server-only, references
Prisma types) and `ui` (needed client-side).

TypeScript *types* erase at build time and are harmless. The hazard is
runtime *values* — Prisma enum objects like `CompetitionMode` are real
runtime objects exported from the generated client, so importing them into a
client component risks pulling the client in.

Recommended split, to be validated against the actual bundle during Phase 1:

- `<entity>/search/definition.ts` — server-only: `toWhere`, scopes, guards.
  Marked `import "server-only"`.
- `<entity>/search/ui.ts` — client-safe: keys, kinds, labels, groups, option
  lists. Imports enum *values* from a client-safe barrel
  (`src/lib/enums/`) that mirrors the Prisma enums as `as const` objects,
  rather than from `@/generated/prisma`.
- `definition.ts` imports `ui.ts` (not the reverse), so labels still have a
  single source.

The mirrored-enum barrel must be kept honest by a type-level assertion that
fails to compile if a Prisma enum gains a member the mirror lacks — cheap
insurance against silent divergence.

---

## 11. Testing strategy

What makes this enterprise-grade rather than merely tidy. The core is pure
functions over data, so it is unusually testable:

1. **Codec round-trip** — for every registered filter,
   `encode(decode(raw)) === normalize(raw)`. Catches CSV/case-handling bugs.
2. **Where-fragment snapshots** — each descriptor's `toWhere` against known
   input. Catches accidental semantic change during refactors.
3. **Behaviour-preservation suite** — assert the new engine produces a
   `where` deep-equal to today's `CompetitionWhereBuilder` output across a
   matrix of filter combinations. This is what makes the Competitions
   migration provably safe rather than hopefully safe.
4. **Scope-leak test** — for every entity and every scope, assert that no
   `allowedFilters` key touches a column any guard constrains. *This test
   would have caught the Projects vulnerability.* It should be written
   before the Projects fix, as a regression test.
5. **Determinism test** — every sort option resolves to an `orderBy` ending
   in the tiebreaker.

---

## 12. Designed for, not built yet

Seams that must exist now so these are additive later, per the product
separation in the [README](README.md#product-framing):

- **Saved Searches.** A saved search is a named, stored URL parameter
  string. Because the registry already owns `encode`/`normalize`, a saved
  search needs no new serialization format and no schema change — persist
  `{ name, ownerId, entity, params }` and "run" it by navigating. The
  `normalize` function exists partly for this: canonicalising a param string
  before storage.
- **Preferences.** A separate persisted model, never merged into
  `SearchQuery`. The only sanctioned integration point: when a user lands
  with **zero** search parameters, preferences may seed the initial URL.
  Once any parameter is present, preferences must not participate.
- **Recommendations.** A separate service producing a ranking. It may
  reorder results; it may never contribute a `where` clause or alter one.
  Enforced by keeping it out of `buildSearchQuery` entirely — there is no
  parameter through which it could inject a predicate.
- **Facets.** Descriptors may later declare an optional `facet` hint,
  enabling a generic grouped-count query per filter. Deliberately deferred
  (see [06-open-questions.md](06-open-questions.md)).
- **Full-text search.** `multiFieldTextFilter` is the seam. Swapping
  `contains` for Postgres `tsvector` — or an external engine — changes one
  primitive, not every consumer.

---

## 13. What this explicitly does not change

- Competitions' AND/OR semantics — preserved exactly, and proven by test 3.
- The layered backend (controller → service → authorization → repository →
  Prisma). The engine is called *by* the repository/service layer; it does
  not bypass anything.
- Authorization policy, permission sets, or context resolvers.
- Prisma models. No migration is required for the core. (Location and
  organizer normalization are separate questions — see
  [06-open-questions.md](06-open-questions.md).)
- Server rendering. The engine is pure and runs server-side; nothing here
  pushes work to the client.
