# Current State of Search (verified 2026-08-30)

Paths are relative to `next/`. Everything below was verified against the
repository and, where noted, against the running application — not inferred
from documentation. Where docs and code disagreed, code wins.

---

## A. Competitions — the mature implementation

### Data flow

```
GET /competitions?...                    GET /admin/competitions?...
        │                                          │
        ▼                                          ▼
page.tsx (async Server Component)         page.tsx (async Server Component)
        │                                          │
        │                            PlatformAuthorizer.can(actor, VIEW_ALL_COMPETITIONS)
        ▼                                          ▼
CompetitionSearchSchema.parse(await searchParams)
        │                                          │
        ▼                                          ▼
CompetitionService.search(filters)        CompetitionService.searchAdmin(actor, filters)
        │                                          │
        ▼                                          ▼
CompetitionSearchBuilder.build()          CompetitionSearchBuilder.buildAdmin()
  → PublicCompetitionWhereBuilder           → AdminCompetitionWhereBuilder
  → CompetitionOrderByBuilder.build(sort)   (same)
  → CompetitionPaginationBuilder.build()    (same)
        │                                          │
        ▼                                          ▼
CompetitionRepository.findMany + count    .findManyAdmin + .countAdmin
        │                                          │
        ▼                                          ▼
competitionMapper.toCardDTOs              toManagementTableDTO
        │                                          │
        ▼                                          ▼
<CompetitionsCards />                     <AdminCompetitionsCards />
```

A third variant, `CompetitionService.searchManageable`, is fully implemented
backend-side but has **no page consumer**.

### Filter-combination semantics (`search/where.ts`)

`CompetitionWhereBuilder.build` accumulates `AND: Prisma.CompetitionWhereInput[]`,
pushing one entry per filter group. This yields the intended product
semantics precisely:

- **Between groups → AND.** `buildSearch`, `buildCompetition`,
  `buildOrganizer`, `buildCategories`, `buildTechnologies`,
  `buildEligibility`, `buildTeam`, `buildDates`, `buildLocation` each push
  their own entry into the same array.
- **Within a group → OR**, expressed three different ways depending on
  column shape:
  - Scalar enum columns (`mode`, `status`, `registrationPlatform`,
    `registrationType`, `registrationFeeType`, `organizerType`,
    `difficulty`, `certificateType`) use Prisma `{ in: [...] }`.
  - Free-text arrays (`organizers`) hand-roll
    `OR: values.map(v => ({ organizer: { contains: v, mode: "insensitive" } }))`
    because `in` cannot express `contains`.
  - Join tables (`categories`, `technologies`, `eligibilities`) use
    `some: { … slug: { in: [...] } }` — "has at least one match," so a
    competition tagged only `ai` still matches `categories=ai,web3`.
  - Free-text `search` is `OR` across `title` and `organizer`.
- `deletedAt: null` is always the first entry. `visibility` is deliberately
  **left out** of the shared base builder and imposed by the scope-specific
  builder instead.

**This semantic is correct and is preserved exactly by the proposed core.**

### Scope enforcement — the pattern worth generalizing

| Builder | Adds |
| --- | --- |
| `PublicCompetitionWhereBuilder` | `visibility: "PUBLIC"` |
| `ManagementCompetitionWhereBuilder` | `members: { some: { userId: actorId } }` |
| `AdminCompetitionWhereBuilder` | nothing — pass-through |

Critically, `visibility` is **not** a member of `CompetitionSearchSchema`. A
caller cannot ask for private competitions because the vocabulary to do so
does not exist. Scope is imposed, not requested. This is the right model.

`AdminCompetitionWhereBuilder` is a bare pass-through with no internal
safeguard — it is safe only because its single caller performs
`PlatformAuthorizer.can(..., VIEW_ALL_COMPETITIONS)` first. A second caller
added without that check would silently expose everything.

### Supported parameters (`search/schema.ts`)

| Param | Parsed type | Notes |
| --- | --- | --- |
| `search` | `string?` | matches `title` OR `organizer`, case-insensitive |
| `page` | `number` = 1 | |
| `limit` | `number` = 20, max 100 | |
| `sort` | `CompetitionSort` = `NEWEST` | |
| `modes` | `CompetitionMode[]?` | CSV, uppercased |
| `statuses` | `CompetitionStatus[]?` | CSV |
| `difficultyLevels` | `DifficultyLevel[]?` | CSV |
| `categories` / `technologies` | `string[]?` | CSV, lowercased slugs, join-table match |
| `registrationPlatforms` | `RegistrationPlatform[]?` | CSV |
| `registrationTypes` | `RegistrationType[]?` | CSV |
| `registrationFeeTypes` | `RegistrationFeeType[]?` | CSV |
| `organizerTypes` | `OrganizerType[]?` | CSV |
| `organizers` | `string[]?` | CSV, free-text `contains` OR |
| `eligibilities` | `EligibilityType[]?` | CSV, join-table match |
| `minTeamSize` / `maxTeamSize` | `number?` | two distinct columns, not one range |
| `startDateFrom` / `To` | `Date?` | |
| `endDateFrom` / `To` | `Date?` | |
| `registrationDeadlineFrom` / `To` | `Date?` | |
| `location` | `string?` | `contains`, case-insensitive |
| `certificateTypes` | `CertificateType[]?` | CSV |

`CompetitionSort`: `newest` (default), `oldest`, `start-date-asc`,
`start-date-desc`, `registration-deadline-asc`,
`registration-deadline-desc`, `alphabetical-asc`, `alphabetical-desc`. Each
maps to a **single-field** `orderBy` with no tiebreaker and no explicit null
placement.

### The frontend does not use any of it

Both page files parse the schema and then immediately discard the two fields
that matter most:

```ts
filters.sort = "newest";
filters.limit = 10;        // 30 on the admin page
filters.page = filters.page ?? 1;
```

Only `?page=` is read back, and pagination links are built as
`/competitions?page=N` — dropping every other parameter. There is **no
filter UI, no sort control, and no code anywhere that writes a filter
parameter**. `?search=2nd` works today only because the schema and backend
handle it; nothing in the UI can produce that URL.

So: a mature, correct filter backend with a zero-percent-built frontend.

---

## B. Projects — a second, incompatible implementation

Live and in use: `GET /api/v1/projects` → `ProjectController.findMany` →
`ProjectQuerySchema.parse` → `projectService.findMany` →
`ProjectRepository.findMany`.

Query construction is **inline private methods on the repository**
(`buildWhereClause`, `buildOrderByClause`, `buildPagination` at
`src/modules/projects/backend/repository.ts:498-568`), not a `search/`
module — despite `src/modules/projects/search/` existing and holding only
the schema and DTO.

Differences from Competitions:

- `where` is built by spreading conditional object literals
  (`...(query.status && { status: query.status })`), not an `AND` array.
- `category` / `technology` / `status` / `visibility` are **single scalars**,
  not arrays — no multi-select capability at all.
- Pagination param is `pageSize`, not `limit`.
- Sorting is `sortBy` + `sortOrder`, applied as a **dynamic key**:
  `{ [query.sortBy]: query.sortOrder }`. The allowlist is enforced only by
  the Zod enum (`createdAt | updatedAt | title`), and the resulting sorts are
  not guaranteed to be index-backed.
- `findMany` returns a bare `ProjectSummaryDto[]` — **no total, no
  pagination metadata**, so a paginated UI cannot render page counts.
- No scope builders exist.

---

## C. Blogs

No `Blog` Prisma model and no implementation exist. The module is empty
scaffolding. Any search there would be a third dialect unless the shared
core lands first — which is the cheapest possible moment to prevent drift.

---

## D. Live defect — project visibility is caller-controlled

**Severity: high. Unauthenticated data exposure.**

In Projects, `visibility` is an ordinary field of `ProjectQuerySchema`,
parsed from the caller's query string and applied verbatim to the `where`
clause:

```ts
// repository.ts — buildWhereClause
...(query.visibility && { visibility: query.visibility }),
```

The only authorization check on this path is **commented out**:

```ts
// service.ts:138
//  PlatformAuthorizer.can({actor}, PlatformAction.VIEW_PUBLIC_PROJECTS); //TODO: Implement this check in the future
```

and the controller resolves the actor with `SessionService.getOptionalActor`
— so no session is required.

### Verified reproduction

Against the running dev server, with no authentication:

```text
$ curl -s "http://localhost:3000/api/v1/projects?visibility=UNLISTED"
{"success":true,"data":[{"id":"cmsbcxzm10044vdqgedig6k6y","title":"CloudGuard",
 "slug":"cloudguard","shortDescription":"Automated cloud security scanner…",
 "visibility":"UNLISTED","status":"PUBLISHED",…}]}
```

The database currently holds 5 `PUBLIC` and 1 `UNLISTED` project and no
`PRIVATE` ones — so `?visibility=PRIVATE` returns `[]` today purely for lack
of data, not because anything blocks it. The same request will leak private
projects the moment any exist.

**Root cause is architectural, not a typo**: visibility was modelled as a
filter rather than as a scope. Competitions cannot express this bug because
its schema has no `visibility` field to supply. The shared core in
[02-core-architecture.md](02-core-architecture.md) makes the Competitions
model the only available one.

This should be fixed independently of the search work — it does not need to
wait for the core. See
[05-implementation-plan.md](05-implementation-plan.md#phase-0--correctness-fixes).

---

## E. Consolidated limitations

Numbered for reference elsewhere in this specification.

1. *Cross-cutting* — two incompatible search dialects, with a third (Blogs)
   pending.
2. *Cross-cutting* — no shared pagination, result envelope, or URL codec.
3. *Cross-cutting* — no URL-state convention anywhere in the codebase.
   `nuqs` is not a dependency; `useSearchParams` appears only in the two
   auth forms; `URLSearchParams` appears nowhere in `src/`.
4. *Competitions* — `sort` and `limit` are hardcoded in both pages, so URL
   values are ignored. A prerequisite blocker for any filter UI.
5. *Competitions* — pagination links drop all parameters except `page`.
6. *Competitions* — no sort tiebreaker or null placement, giving
   non-deterministic ordering across pages once real data and sorting
   coexist.
7. *Competitions* — `count` and `findMany` each rebuild the `where`
   independently (two full builder runs per request).
8. *Competitions* — no facet/aggregate counts, so "Online (12)" style
   option counts are not currently possible.
9. *Competitions* — the card renders 7 of 16 DTO fields, and
   `registrationDeadline` is fetched but its display block is commented
   out. Filtering by fields the card never shows will feel disconnected.
10. *Competitions* — `organizer` is denormalized free text with no
    `Organizer` model, so organizer filtering can only ever be a fuzzy
    `contains`, never a canonical picklist.
11. *Projects* — the visibility defect in section D.
12. *Projects* — no pagination metadata returned.
13. *Projects* — single-value-only category/technology/status filters.
14. *Projects* — query building embedded in the repository, untestable in
    isolation.
15. *Forward risk* — nothing structurally prevents a future contributor
    from merging user preferences or recommendation ranking into the same
    `where` path used by explicit search, violating the product rule that
    explicit filters are never silently overridden.
