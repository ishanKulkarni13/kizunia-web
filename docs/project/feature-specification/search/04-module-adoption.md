# Module Adoption

How each module consumes the core, and what stays module-owned. The test of
the architecture is whether the third consumer needs anything new — see
§4.

---

## 1. Competitions — migration, not rewrite

Competitions already implements the target semantics correctly. Adoption is
a mechanical translation with **no intended behaviour change**, protected by
the behaviour-preservation test suite
([02, §11.3](02-core-architecture.md#11-testing-strategy)).

| Today | Becomes |
| --- | --- |
| `CompetitionSearchSchema` (hand-written) | derived from the registry |
| `CompetitionWhereBuilder.buildCompetition` | 8 × `enumMultiFilter` |
| `.buildCategories` / `.buildTechnologies` | 2 × `relationSlugMultiFilter` |
| `.buildEligibility` | `enumRelationMultiFilter` |
| `.buildSearch` | `multiFieldTextFilter(title, organizer)` |
| `.buildOrganizer` | `textContainsAnyFilter` |
| `.buildTeam` | 2 × `numberBoundFilter` |
| `.buildDates` | 3 × `dateRangeFilter` (each owning its From/To pair) |
| `.buildLocation` | `textContainsFilter` |
| `PublicCompetitionWhereBuilder` | `publicScope.guard` |
| `ManagementCompetitionWhereBuilder` | `managementScope.guard` |
| `AdminCompetitionWhereBuilder` | `adminScope.guard` (empty, with `requires` marker) |
| `CompetitionOrderByBuilder` switch | `SortRegistry` with mandatory tiebreaker |
| `CompetitionPaginationBuilder` | core pagination |
| `CompetitionSearchResult<T>` | promoted to core `SearchResult<T>` |

Module-owned and unchanged: DTOs, mappers, select shapes, the service and
repository layering, all authorization policy.

Net gains beyond consistency: URL-driven sort and limit actually take effect
(limitation 4), pagination preserves state (5), sorting becomes
deterministic (6), and `where` is built once per request instead of twice
(7).

---

## 2. Projects — adoption plus correctness

Projects gains the most, because it is furthest from the target.

### Corrections

- **`visibility` stops being a filter.** It moves into scope guards. This is
  the fix for the live defect in
  [01, §D](01-current-state.md#d-live-defect--project-visibility-is-caller-controlled).
  The public scope guards `visibility: "PUBLIC"`; a "my projects" scope
  guards membership; an admin scope requires a platform permission upstream.
- **The commented-out authorization check** in `service.ts` is resolved by
  construction — there is no unscoped entry point to leave unguarded.

### Upgrades

- `category` / `technology` / `status` become multi-value
  (`relationSlugMultiFilter`, `enumMultiFilter`) — a capability gain, since
  today only one value each is expressible.
- `findMany` returns `SearchResult<T>` with totals, so a paginated UI
  becomes possible (limitation 12).
- Query building moves out of the repository's private methods into a
  registry, making it unit-testable (limitation 14).

### Breaking parameter changes

Projects' API is live at `GET /api/v1/projects`, so these are real changes:

| Today | Becomes | Note |
| --- | --- | --- |
| `pageSize` | `limit` | cross-entity consistency |
| `sortBy` + `sortOrder` | `sort` (single token) | allowlisted, index-reviewed |
| `category` | `categories` | CSV multi-value |
| `technology` | `technologies` | CSV multi-value |
| `status` | `statuses` | CSV multi-value |
| `visibility` | *removed* | now a scope concern |

There is no public frontend consuming these yet
([01, §B](01-current-state.md#b-projects--a-second-incompatible-implementation)),
so the blast radius is small — but the endpoint is reachable, so the change
should be deliberate rather than silent. Accepting a deprecated alias for
one release is optional and probably unnecessary at this stage.

---

## 3. Blogs — the design's real test

Blogs has no model and no code, so it is the honest test of whether the core
generalises or merely accommodates two known cases. The domain
specification ([docs/architecture/domain/blog.md](../../../architecture/domain/blog.md))
already states its search requirements, so this is not speculation:

> Blogs should be searchable using structured metadata: Title, Summary,
> Author, Categories, Technologies. **Search should prioritize metadata
> rather than parsing the entire Markdown document.**

That constraint is significant: it means blog search needs **no full-text
engine** at launch. `multiFieldTextFilter(title, summary)` satisfies the
stated requirement exactly, and the FTS seam
([02, §12](02-core-architecture.md#12-designed-for-not-built-yet)) stays
unused until the product asks for body search.

### The projected blog registry

| Filter | Primitive | Already exists? |
| --- | --- | --- |
| text over `title` + `summary` | `multiFieldTextFilter` | ✅ (Competitions' `buildSearch`) |
| `categories` | `relationSlugMultiFilter` | ✅ |
| `technologies` | `relationSlugMultiFilter` | ✅ |
| `statuses` (publishing workflow) | `enumMultiFilter` | ✅ |
| `publishedAt` range | `dateRangeFilter` | ✅ |
| `authors` | `relationIdMultiFilter` | ⚠️ new primitive |

**Five of six primitives are reused unchanged.** The sixth — filtering by a
related entity's id rather than a slug — is generic, not blog-specific, and
Projects will want it too (filter by member). It is included in the core
from the start ([02, §4](02-core-architecture.md#4-filter-primitives))
precisely because this exercise surfaced it.

### What blogs validates about the design

Blogs' public scope needs **two** guard clauses, not one:

```ts
guard: () => [
  { visibility: "PUBLIC" },
  { status: "PUBLISHED" },   // review workflow — unpublished is never public
]
```

This is why `SearchScope.guard` returns an **array** of clauses rather than
a single one. Competitions alone would not have surfaced that requirement;
designing against the blog spec did. It also demonstrates the scope model
generalising beyond visibility to any non-negotiable predicate — here, an
editorial workflow state.

Blogs also has a single `author` relation where Competitions has free-text
`organizer` and Projects has `members`. Three different ownership shapes,
one `guard` mechanism — the scope abstraction holds.

---

## 4. Reuse scorecard

The practical justification for the shared core:

| Primitive | Competitions | Projects | Blogs |
| --- | --- | --- | --- |
| `multiFieldTextFilter` | ✅ | ✅ | ✅ |
| `enumMultiFilter` | ✅ ×8 | ✅ ×1 | ✅ ×1 |
| `relationSlugMultiFilter` | ✅ ×2 | ✅ ×2 | ✅ ×2 |
| `dateRangeFilter` | ✅ ×3 | ✅ | ✅ |
| `numberBoundFilter` | ✅ ×2 | — | — |
| `textContainsFilter` | ✅ | — | — |
| `textContainsAnyFilter` | ✅ | — | — |
| `enumRelationMultiFilter` | ✅ | — | — |
| `relationIdMultiFilter` | — | likely | ✅ |
| Scope guards | ✅ ×3 | ✅ ×3 | ✅ ×3 |
| `SearchResult<T>` | ✅ | ✅ | ✅ |
| Generic UI controls | ✅ | ✅ | ✅ |

Adding Blogs after the core exists should require: one registry file, one
scope definition, one sort registry, and **zero new components**. If that
turns out not to be true when Blogs is built, the abstraction was wrong and
should be revisited rather than worked around.

---

## 5. Portfolios and beyond

Portfolios has no listing surface today and no near-term requirement, so it
is out of scope. Should public portfolio discovery arrive, it would consume
the same primitives (text over name/headline, `relationSlugMultiFilter` over
technologies, scope guard on `PortfolioVisibility`). No core change is
anticipated — but the reuse scorecard above should be extended rather than
assumed.
