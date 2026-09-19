# Search & Discovery

## Purpose

This directory specifies Kizunia's **search subsystem** — a shared,
type-safe, entity-agnostic foundation for search, filtering, sorting,
pagination and discovery, consumed by Competitions first and by Projects,
Blogs and future modules on the same primitives.

It is deliberately not scoped as "the competition filter feature." Search is
infrastructure. Three modules already need it, and the cost of *not* having
a shared foundation is already measurable in this codebase (see the drift
thesis below).

---

## Documents

| Doc | Contents |
| --- | --- |
| [01-current-state.md](01-current-state.md) | What exists today across Competitions and Projects, exactly. Includes a live authorization defect found during this analysis. |
| [02-core-architecture.md](02-core-architecture.md) | The shared search core: type-safe contracts, the single-registry principle, scope enforcement, composition engine. |
| [03-frontend-architecture.md](03-frontend-architecture.md) | URL-as-source-of-truth, reusable filter controls, apply-vs-instant, server/client boundary. |
| [04-module-adoption.md](04-module-adoption.md) | How Competitions, Projects and Blogs each adopt the core; what stays module-owned. |
| [05-implementation-plan.md](05-implementation-plan.md) | Phased delivery with concrete files. |
| [06-open-questions.md](06-open-questions.md) | Unresolved design areas — location/geo, full-text search, facets. Awaiting product input. |
| [07-implementation-design.md](07-implementation-design.md) | Phase 1 build spec: verified environment facts, the full edge-case catalogue, corrected contracts. **Supersedes 02 where they differ.** |
| [08-radius-search-research.md](08-radius-search-research.md) | **Research / proposal.** Radius (nearby) location search for Competitions: audit of the live location + search architecture, five geospatial approaches compared, recommended design, V1 scope and phased plan. Answers 06 §1. Not approved. |

---

## The drift thesis

The motivating argument for building this as shared infrastructure rather
than a per-module feature is not hypothetical. Two modules have already
implemented "search" independently, and they disagree on nearly everything:

| Concern | Competitions | Projects |
| --- | --- | --- |
| Where the query is built | dedicated `search/` module, static builder classes | private methods inline in the repository |
| `where` composition | `AND: []` array, one entry per filter group | spread of conditional object literals |
| Multi-value filters | CSV → array → Prisma `in` | single scalar → equality |
| Page size param | `limit` | `pageSize` |
| Sorting | one token enum (`start-date-asc`) | `sortBy` + `sortOrder` pair, dynamic key |
| Visibility scoping | separate public / management / admin where-builders | **a user-supplied filter** |
| Result shape | `SearchResult<T>` with full pagination metadata | bare `T[]`, no total |
| Naming | `Search` / `SearchInput` | `Query` / `QueryInput` / `QueryDto` |

Blogs would be a third dialect. Portfolios a fourth.

**The drift already produced a security defect.** Because Projects models
`visibility` as an ordinary user-controllable filter instead of a scope
concern, an unauthenticated caller can enumerate non-public projects. This
was verified live against the running app, not inferred — details and
reproduction in [01-current-state.md](01-current-state.md#d-live-defect--project-visibility-is-caller-controlled).

Competitions gets this right structurally: visibility is *not* a filter
there; it is imposed by `PublicCompetitionWhereBuilder`. That difference is
the entire argument for a shared core — **the correct pattern must be the
default and the easy one, enforced by types, not by remembering.**

---

## Product framing

Five related concepts that must never collapse into one:

| Concept | Question it answers | Lifetime |
| --- | --- | --- |
| **Search** | "What am I looking for right now?" | One request, URL-scoped |
| **Filters** | UI surface for building a Search | Same as Search |
| **Saved Search** | "What search do I want to reuse?" | Persisted, named, re-runnable |
| **Preferences** | "What do I generally care about?" | Persisted, ambient, influences defaults only |
| **Recommendations** | "What should Kizunia show me?" | Computed ranking; never silently overrides explicit filters |

Only Search and Filters are being built now. The other three are designed
*for* — the architecture must not block them — and are specified as seams,
not features. See
[02-core-architecture.md](02-core-architecture.md#designed-for-not-built-yet).

---

## Design principles

1. **One registry per entity, four outputs.** A filter is declared once and
   derives its Zod validation, its Prisma `where` fragment, its URL codec,
   and its UI metadata. No parallel lists to keep in sync.
2. **The URL is the canonical applied state.** Client state holds only
   pending, unapplied edits.
3. **Scope is not a filter.** Visibility/ownership predicates are imposed by
   the engine and are not expressible by the caller.
4. **No `any`.** Heterogeneous filter collections use existential type
   erasure, not escape hatches. Exactly one sanctioned cast exists in the
   core and it is documented.
5. **Additive, not a rewrite.** Competitions' backend semantics
   (AND-between-groups / OR-within-group) are correct and are preserved
   exactly; the core generalizes that behavior rather than replacing it.

## Status

Analysis and design complete; **no implementation started**. Approve these
documents before code begins.

Already merged as isolated cleanup on `feature/competition-search-foundation`:
removal of the dead, deprecated `competitions/schemas/search.schema.ts`.
