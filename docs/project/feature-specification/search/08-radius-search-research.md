# Radius / Nearby Location Search — Research & Design Proposal

> **Status:** SUPERSEDED IN PART — IMPLEMENTED 2026-09-05. This document remains
> accurate as *research*: its reading of the codebase, its database findings, and
> its analysis of the options all held up when the feature was built. But three
> of its recommendations were overridden by product decision before
> implementation. **Read the Amendment below before treating any recommendation
> here as current.**

---

## Amendment — what was actually built (2026-09-05)

Three deliberate departures from this document's recommendations, decided by
product review rather than discovered during implementation:

| # | This document recommended | What shipped | Why |
| --- | --- | --- | --- |
| 1 | **Union** semantics (§12.3): "recorded in Pune, *or* within 25 km of it" | **Replace.** With a radius set, matching is by distance alone and the SearchArea arm is dropped. | "Within 25 km" is a question about geography. Answering it partly by stored identity would return a competition tagged "Pune District" from 90 km away with nothing on the page to explain it. The accepted cost is that a location with no coordinates cannot match a radius search at all — which is why `scripts/report-location-coverage.ts` exists. |
| 2 | **Defer** browser geolocation (§8), and implement it later as reverse-geocode → place id | **Built now, with bare coordinates.** `lat`/`lng` in the URL, never reverse geocoded, never persisted as a `Location`. | Device position is an ephemeral search input, not a place. Turning it into one would add a billed provider capability, a second cache, and a second way places enter the system — the "second system" this document rightly warns against. |
| 3 | `findIdsWithinRadius` returning the ids **inside** the circle, capped by `MAX_RADIUS_LOCATION_IDS` with a warning on truncation (§10, §21) | **`findLocationIdsOutsideRadius`** — the ids to *exclude* — paired with a Prisma bounding box. **No cap anywhere.** | The inside-list is authoritative: anything missing from it is a competition that silently vanishes, so capping it produces a quietly incomplete search. Inverting it makes completeness *structural* — the box is a strict superset, so an incomplete exclusion list can only over-include a near-boundary result, never lose a valid one. It is also ~3.7× smaller (the corner region is ~21% of box hits against ~79% inside). |

Two further notes:

- **Finding 1 of §1 was right and is now fixed in the code.** `PlaceRadiusConfig`'s
  original comment claimed radius "changes the resolution result, not the clause
  shape". It does change the clause. That comment has been rewritten in
  `src/lib/search/spec.ts` to say so.
- **No Postgres extension was adopted, and §9's analysis of why is unchanged —
  but its framing was incomplete.** An extension would not have removed the
  intermediate materialisation anyway: the materialisation is forced by Prisma
  having no raw-SQL escape inside `where`, not by the absence of a spatial index.
  `cube`/`earthdistance` would make the lookup indexed; it would still have to
  hand ids back to TypeScript.

Ceiling shipped at **200 km**, steps `[5, 10, 25, 50, 100, 200]`. Distance
sorting was **not** built (§17's reasoning stands).

---

> **Original status:** RESEARCH / PROPOSAL. Nothing here is approved, and no
> implementation code has been written.
>
> **Scope:** Competitions only.
>
> **Supersedes:** nothing. Answers the question deferred in
> [06-open-questions.md](06-open-questions.md) §1 ("Location and geography —
> awaiting product input. A separate discussion is planned."). This document
> *is* that discussion, conducted against the code as it exists on
> `feat/competition-search-ui` at commit `9b50367`.
>
> **Referenced by:** [../../../architecture/domain/location.md](../../../architecture/domain/location.md)
> (§ Status → "Radius / near me — not built").
>
> **Date:** 2026-09-03

Every claim is labelled:

| Label | Meaning |
| --- | --- |
| **FACT** | Confirmed by reading the code, the schema, or querying the database. A file path and symbol is always given. |
| **OBSERVATION** | Inferred from the architecture or the data. Reasonable, but not directly asserted anywhere. |
| **RECOMMENDATION** | The author's proposal. Not agreed. |
| **OPEN DECISION** | Requires product or architecture input before implementation can start. |

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Current architecture](#2-current-architecture)
3. [The current location system, end to end](#3-the-current-location-system-end-to-end)
4. [The current search contract](#4-the-current-search-contract)
5. [Existing data model](#5-existing-data-model)
6. [Existing location resolution](#6-existing-location-resolution)
7. [Problem definition](#7-problem-definition)
8. [Product interpretations of "radius search"](#8-product-interpretations-of-radius-search)
9. [Database and geospatial analysis](#9-database-and-geospatial-analysis)
10. [Prisma analysis](#10-prisma-analysis)
11. [Architecture options and comparison](#11-architecture-options-and-comparison)
12. [Recommended architecture](#12-recommended-architecture)
13. [Performance analysis](#13-performance-analysis)
14. [URL and search-state analysis](#14-url-and-search-state-analysis)
15. [Filter interaction analysis](#15-filter-interaction-analysis)
16. [Online / offline / hybrid](#16-online--offline--hybrid)
17. [Sorting by distance](#17-sorting-by-distance)
18. [Pagination](#18-pagination)
19. [Preset interaction](#19-preset-interaction)
20. [UX analysis](#20-ux-analysis)
21. [Security and abuse](#21-security-and-abuse)
22. [Caching](#22-caching)
23. [Data quality and migration](#23-data-quality-and-migration)
24. [Backward compatibility](#24-backward-compatibility)
25. [Edge cases](#25-edge-cases)
26. [Testing strategy](#26-testing-strategy)
27. [V1 scope](#27-v1-scope)
28. [Implementation plan](#28-implementation-plan)
29. [File-level impact analysis](#29-file-level-impact-analysis)
30. [Architectural boundaries](#30-architectural-boundaries)
31. [Risks](#31-risks)
32. [Open decisions](#32-open-decisions)
33. [Future evolution path](#33-future-evolution-path)

---

## 1. Executive summary

Kizunia already has a complete, well-factored geographic discovery system. It
matches competitions to places by **entity identity**, not by distance:
`SearchArea` rows are places, `LocationSearchArea` rows are provider-verified
containment links materialised at ingestion, and the public location filter is a
single indexed join over those links.

**FACT.** Radius search was anticipated. Three separate seams exist in the code
for it and none is speculative dead weight:

| Seam | File | What it already does |
| --- | --- | --- |
| `PlaceRadiusConfig` | `src/lib/search/spec.ts:292-320` | A reserved spec type documenting that radius belongs to the place filter, never to a filter of its own. |
| `filterParams(spec)` | `src/lib/search/spec.ts:531-556` | Already branches on `spec.radius` and adds `radius.radiusParam` to the filter's owned URL parameters. Clear-all, chips, presets and duplicate-parameter validation therefore already know about radius the moment the field is set. |
| Resolvable filters | `src/lib/search/resolve.ts` | An async, failure-aware pre-query lookup stage whose clause is applied as a *base* clause. Radius needs exactly this and it already exists, built and verified, for the place filter. |

**The five findings that actually shape the design:**

1. **The reserved design note is wrong in one specific way, and that is the
   single most important finding in this document.** `PlaceRadiusConfig`'s
   comment states radius "changes the resolution result, not the clause shape:
   the resolver would return a wider set of search-area ids, and `toWhere` would
   be untouched." That cannot work. A 25 km circle does not correspond to any
   set of stored `SearchArea` rows, and **65 % of stored `SearchArea` rows have
   no coordinates at all** (17 of 26 — see §23). Radius must resolve to
   *`Location` ids*, and `toWhere` therefore *does* change. See §12.

2. **Radius must live inside the place filter's single clause, not beside it.**
   If radius were an independent base clause ANDed with the place clause, the
   existing `includeOnline` toggle would break: `(area OR online) AND (inRadius)`
   silently excludes the online competitions the user explicitly asked for,
   because online competitions have no coordinates. This is a real, non-obvious
   correctness trap and it is the strongest structural argument for the design
   the reserved config already points at. See §15.

3. **Anchor coordinates are already fetched and then thrown away.** The Google
   identity field mask (`google.provider.ts:48-56`) includes `"location"`, and
   `PlaceIdentityDetails` carries `latitude` / `longitude`.
   `PlaceMatchService.resolve` reads neither, and the `place_resolution` cache
   table has no columns for them. Radius V1 needs **two nullable columns and one
   migration** — no new provider call, no new billing, no new provider
   capability. See §6, §23.

4. **PostGIS is not an option on the current development database.**
   `pg_available_extensions` on the live dev database (PostgreSQL 18.4, Windows)
   lists `cube`, `earthdistance`, `btree_gist` and `pg_trgm` — **and not
   `postgis`**. Adopting PostGIS would make `prisma migrate` fail on every
   developer machine. See §9.

5. **Scale makes this a non-problem today and for years.** 33 competitions,
   5 of which have any location; 5 `Location` rows; 26 `SearchArea` rows. The
   entire geographic dataset fits in a few kilobytes. Any correct approach is
   fast; the choice should therefore be made on *correctness, testability and
   migration cost*, not on throughput. See §13.

**RECOMMENDATION.** Implement radius as **Architecture B — a bounding-box +
Haversine `$queryRaw` over `location`, resolving to `Location` ids, consumed by
the existing `competitionLocationFilter` as one widened clause.** It adds one
raw SQL function, two nullable cache columns, no new table, no extension, no
dependency, and no second search system. The migration path to `cube` /
`earthdistance` (Architecture C) is a pure index-and-query change behind the
same function signature.

**V1 is deliberately small:** anchor + radius stepper in the existing Location
popover, km only, server-side validated, URL-persisted, union semantics with the
existing area match. **No distance sort, no map, no browser geolocation, no
"near me".** Each is analysed and each is deferred for a stated reason.

---

## 2. Current architecture

**FACT.** Repository layout:

```text
/                                   repository root
├── docs/                           architecture + product docs  ← this file
└── next/                           the Next.js application
    ├── prisma/schema.prisma        1446 lines, PostgreSQL
    ├── prisma/migrations/          10 migrations, latest 20260903053431
    ├── scripts/verify-*.ts         5 standalone regression suites (no test runner)
    └── src/
        ├── app/                    App Router pages + /api/v1 routes
        ├── lib/search/             the entity-agnostic search core (9243 lines)
        └── modules/
            ├── competitions/       search/, backend/, schemas/, types/
            └── locations/          providers/, services/, repository/, utils/
```

**FACT.** Layering, verified by following `/competitions` end to end:

```text
page.tsx (Server Component)
  → CompetitionService.search(params)
      → planCompetitionSearch(...)        resolves async filters ONCE
          → resolveBaseClauses(...)
              → competitionLocationFilter.resolveClause(params)
                  → PlaceMatchService.resolve({ placeId })
      → CompetitionRepository.findMany(plan) ┐ both call buildCompetitionQuery(plan)
      → CompetitionRepository.count(plan)    ┘ so `where` is byte-identical
          → buildSearchQuery(...)          PURE, SYNCHRONOUS
              → composeAnd([base, filters, scope.guard])
```

**FACT.** `buildSearchQuery` is documented as, and is, pure and synchronous
(`engine.ts:16-28`). A filter cannot touch the database or a network from inside
`toWhere`. This constraint is the reason `resolve.ts` exists and is the single
most load-bearing architectural fact for radius search.

**FACT.** There is no test runner. Verification is by standalone `tsx` scripts —
`verify-search-invariants.ts` (1024 lines), `verify-competition-presets.ts`
(1403), `verify-place-resolution.ts` (619), `verify-location-identity.ts` (556),
`verify-admin-competitions.ts` (551). Documented as a deliberate choice in
[07-implementation-design.md §8](07-implementation-design.md).

---

## 3. The current location system, end to end

This is the trace the brief asked for. Every arrow is a real call.

### 3.1 User selects a location

**FACT.** `src/lib/search/react/controls/place-control.tsx`. The control types
into `spec.suggestEndpoint`, debounced 1000 ms, minimum 2 characters, with
out-of-order response discarding via a `requestId` ref.

**FACT.** `spec.suggestEndpoint` for Competitions is
**`/api/v1/places/autocomplete`** (`search/ui.ts:209`) — i.e. **Google Places**,
not Kizunia's own rows.

> **FACT — documentation drift.** `docs/architecture/domain/location.md`
> § "Two place-search surfaces" states that public filtering uses
> `/api/v1/search-areas` (internal rows, free, never calls Google). That route
> and its controller (`backend/search-area.controller.ts`,
> `repository/search-area.repository.ts::search`) **do exist**, but the
> Competition place filter does not point at them. The public filter currently
> calls the billed Google endpoint. This is a live divergence between the
> location design doc and the shipped filter, independent of radius search, and
> is worth raising on its own. It matters here because §21's abuse surface and
> §22's caching analysis both hinge on which endpoint is live.

On selection the control calls
`onChange({ id: providerPlaceId, label: primaryText, includeOnline })`.

### 3.2 How it is represented and serialised

**FACT.** `writeFilterValue` (`spec-values.ts:326-337`) writes exactly three
parameters, and `filterParams` declares the filter owns exactly those three:

```text
?placeId=ChIJARFGZy6_wjsRQ-Oenb9DjYI   ← the ONLY parameter that affects matching
&placeLabel=Pune                        ← presentation only, never reaches a query
&includeOnline=true                     ← written only when true
```

**FACT.** `applyParamPatch` (`params.ts:142-175`) sorts keys, collapses repeats
to comma form, treats `undefined` as removal, and optionally resets `page`.
Every link, chip, control and preset goes through it.

### 3.3 How the server receives it

**FACT.** Two entry points, one code path:

- Page: `CompetitionsPage` awaits `searchParams` and passes the raw object to
  `CompetitionService.search`.
- API: `CompetitionController.search` does
  `Object.fromEntries(request.nextUrl.searchParams.entries())`.

Both reach `planCompetitionSearch({ scope: "public", params })`.

### 3.4 How it is resolved

**FACT.** `competitionLocationFilter`
(`src/modules/competitions/search/location-filter.ts`) is a
`BoundResolvableFilter`. `resolveClause` reads the value with `readFilterValue`;
absent `placeId` → `{ status: "ABSENT" }` and no clause. Present →
`PlaceMatchService.resolve({ placeId })` (§6), which returns `searchAreaIds`.

**FACT.** Three outcomes are kept strictly distinct (`resolve.ts:42-53`):
`ABSENT` / `CLAUSE` (possibly matching nothing) / `FAILED`. A `FAILED`
resolution throws `LOCATION_RESOLUTION_FAILED` from `planCompetitionSearch` and
the page renders `SearchFailure`, *not* an empty list. "We could not find out"
is never rendered as "there is nothing there."

### 3.5 How the database queries it

**FACT.** `buildLocationClause`
(`src/modules/competitions/search/location-clause.ts`):

```ts
// searchAreas resolved to at least one id
{ locations: { some: { location: { searchAreas: { some: { searchAreaId: { in: ids } } } } } } }

// resolved to zero ids
{ id: { in: [] } }          // MATCHES_NOTHING — deliberate, load-bearing

// includeOnline
{ OR: [ <above>, { mode: "ONLINE" } ] }
```

**FACT.** The clause is passed as a **base clause**, which `composeAnd` applies
unconditionally. This exists specifically so that the engine's "an empty value
means an absent filter" rule cannot silently drop a resolved-to-nothing location
and turn "this town has nothing" into "here is every competition on the
platform" (`resolve.ts:22-40`).

### 3.6 How competitions are matched

**FACT.** Matching is by `SearchArea` id and never by text. Containment is
materialised at ingestion into `LocationSearchArea` rows, so a parent search
reaches its children because the children each point at the parent. Expansion is
downward-only; the query never traverses a hierarchy.

**FACT.** `relation` (`EXACT` / `WITHIN`) is stored but the filter ignores it —
both match.

**OBSERVATION — answering the brief's Part 2 questions directly:**

| Question | Answer, from code |
| --- | --- |
| What does the Location filter store? | A **provider place id** (`placeId`) plus a display label and a boolean. Never a name, city, country, coordinate, or internal database id. |
| Exact-match or hierarchical? | Neither, exactly. It is **identity-set matching**: the selected place resolves to 1–2 `identityKey`s, those map to `SearchArea` rows, and any location linked to any of them matches. The hierarchy was flattened at ingestion. |
| Selecting "Pune"? | Resolves to `google:place:{puneId}` **and** the contextual key `component:locality:pune:maharashtra:india`. Matches every location that recorded a link to either. |
| A neighbourhood? | Matches only locations explicitly linked to that neighbourhood. Never widens upward. |
| A state / country? | Same mechanism. Works only because ingestion wrote an `ADDRESS_COMPONENT`-sourced link for that state/country on each location. |

### 3.7 How results are returned, and pagination

**FACT.** `CompetitionRepository.findMany(plan)` and `.count(plan)` each call
`buildCompetitionQuery(plan)`. Because the plan carries already-resolved base
clauses, the two `where` clauses are byte-identical by construction — the
invariant is enforced by the type, not by convention (`plan.ts:1-31`).

**FACT.** Pagination is **offset-based**: `parsePagination` → `toSkipTake` →
`{ skip: (page-1)*limit, take: limit }`. Defaults 20, max 100, page clamped to
100 000. Out-of-range values are clamped, never rejected. Sorting always appends
a mandatory `{ id: "asc" }` tiebreaker.

---

## 4. The current search contract

**FACT.** Reserved parameters (`params.ts:54-84`): `page`, `limit`, `sort`,
`preset`. `defineSearch` throws `InvalidSearchDefinitionError` if any filter
claims one, and also if two filters claim the same parameter.

**FACT.** Filter kinds (`spec.ts:51-61`): `enum-multi | relation-multi | text |
text-any | number-bound | date-range | boolean | place | team-size`.

**FACT.** 18 registered Competition filters — 17 ordinary + `location`
(resolvable). 8 sorts, default `newest`, tiebreaker `{ id: "asc" }`. Three
scopes: `public` (guards `visibility: PUBLIC`), `management` (guards
membership), `admin` (no guard, requires `VIEW_ALL_COMPETITIONS`).

**FACT.** One decoder. `readFilterValue` in `spec-values.ts` is client-safe and
is the *sole* decoder; a `FilterDescriptor` adds only `toWhere`
(`types.ts:8-25`). This is why a new filter parameter cannot be interpreted
differently by the control and the query.

**FACT.** `clearAllFiltersPatch(specs)` iterates `filterParams(spec)` for every
spec and maps each to `undefined`, plus clears `page` and `preset`. **Because
`filterParams` already returns `radius.radiusParam` when `spec.radius` is set,
Clear all, active chips, preset capture and preset sanitisation all become
radius-aware with zero edits.**

### How radius fits without creating a second search system

**FACT + RECOMMENDATION.** The shape is fixed by three existing constraints and
there is genuinely only one design that satisfies all three:

1. `buildSearchQuery` is pure and synchronous → radius cannot compute anything
   at query-build time → it must be a **resolvable** filter.
2. `defineSearch` forbids two filters owning one parameter, and a radius with no
   centre is meaningless → radius cannot be its own registry entry → it must be
   a **modifier on the existing `location` filter**, exactly as
   `PlaceRadiusConfig` already says.
3. `includeOnline` ORs into the location clause → a separately-ANDed radius
   clause would contradict it → radius must be folded into **one** clause built
   by `buildLocationClause`.

The result is: **one new resolver output field, one widened clause builder, one
raw SQL helper.** No new filter, no new registry, no new query path, no second
pipeline.

---

## 5. Existing data model

**FACT.** `prisma/schema.prisma`. There is **no** `Competition.location` string
column (06-open-questions describes a state that no longer exists). Competition
location is a relation:

```text
Competition ─< CompetitionLocation >─ Location ─< LocationSearchArea >─ SearchArea
```

**`Competition`** (line 579) — geographically relevant fields only:

| Field | Type | Notes |
| --- | --- | --- |
| `mode` | `CompetitionMode?` | `ONLINE \| OFFLINE \| HYBRID`, **nullable** |
| `visibility` | `CompetitionVisibility` | `PUBLIC \| UNLISTED \| PRIVATE \| ARCHIVED`, default `PRIVATE` |
| `deletedAt` | `DateTime?` | soft delete |
| `locations` | `CompetitionLocation[]` | zero is valid and means "unknown", **not** "online" |

Indexes: `status`, `visibility`, `deletedAt`, `startDate`,
`registrationDeadline`, `createdById`, `updatedById`. **No index on
`createdAt`, which is the default sort** (a pre-existing issue recorded in
[07 §2](07-implementation-design.md), not introduced by radius).

**`Location`** (line 811) — competition-owned, never shared:

| Field | Type |
| --- | --- |
| `displayName` | `String` (only required field) |
| `precision` | `LocationPrecision` = `UNKNOWN \| COUNTRY \| STATE \| CITY \| VENUE` |
| `country` / `countryCode` / `state` / `stateCode` / `city` / `postalCode` | `String?` |
| **`latitude`** | **`Decimal? @db.Decimal(9,6)`** |
| **`longitude`** | **`Decimal? @db.Decimal(9,6)`** |
| `timezone` | `String?` — **nothing populates it** |
| `provider` | `LocationProvider` = `MANUAL \| GOOGLE` |
| `providerLocationId` | `String?` |

Indexes: `countryCode`, `city`, `state`, `(provider, providerLocationId)`.
**No index on `(latitude, longitude)`.**

> **FACT.** The schema comment on the coordinate pair reads: *"Decimal rather
> than Float so stored coordinates round-trip exactly. 6 decimal places is
> roughly 0.11 m at the equator."* The precision needed for radius search is
> already there and was chosen deliberately.

**`SearchArea`** (line 867) — globally shared, deduplicated by `identityKey`:
`displayName`, `providerKind`, `contextLabel`, `provider`, `providerLocationId`,
`identityKey @unique`, **`latitude` / `longitude` `Decimal?(9,6)`**.

**`LocationSearchArea`** (line 913) — `@@id([locationId, searchAreaId])`,
`relation`, `source`, index on `searchAreaId`.

**`CompetitionLocation`** (line 938) — its own `id` (a competition may use one
place twice), `label`, `venueName`, `address`, per-stop `startDate` / `endDate`,
`order`. **Carries no coordinates of its own** — geography lives entirely on
`Location`.

**`PlaceResolution`** (line 1403) — the resolution cache, keyed by `placeId`:
`status (RESOLVED|NOT_FOUND)`, `identityKeys String[]`, `displayName`,
`contextLabel`, `extractionVersion`, `resolvedAt`. **No coordinate columns.**

**`RateLimit`** (line 1435) — `key` (`{scope}:{identifier}:{windowStart}`),
`count`, `expiresAt`. Postgres-backed so limiting holds across instances.

**Answering the brief's Part 2 checklist against the real schema:**

| Concept the brief asked about | Exists? | Where |
| --- | --- | --- |
| location label | ✅ | `Location.displayName`, `CompetitionLocation.label` |
| address | ✅ | `CompetitionLocation.address` |
| city / state / country | ✅ | `Location.city` / `.state` / `.country` (+ codes) |
| **latitude / longitude** | ✅ | `Location`, `SearchArea` — both `Decimal?(9,6)` |
| place id | ✅ | `Location.providerLocationId`, `SearchArea.providerLocationId` |
| place provider | ✅ | `LocationProvider { MANUAL, GOOGLE }` |
| location type | ✅ | `LocationPrecision`, plus `SearchArea.providerKind` (verbatim provider string) |
| online / offline / hybrid | ✅ | `Competition.mode`, **nullable** |
| venue | ✅ | `CompetitionLocation.venueName` |
| timezone | ⚠️ column exists, never written |

---

## 6. Existing location resolution

**FACT.** `PlaceMatchService.resolve`
(`src/modules/locations/services/place-match.service.ts`) — 518 lines, and the
most defensive module in the codebase. In order:

1. **Validate** `PlaceIdSchema`. Invalid → `PLACE_NOT_FOUND`, no I/O, not cached
   ("caching it would let a caller fill the table with junk keys").
2. **Coalesce** in-flight identical lookups through a module-level `Map`, so
   concurrent identical searches make one provider call.
3. **Read cache** `place_resolution`. TTL **30 days** for `RESOLVED`, **24
   hours** for `NOT_FOUND`. A row whose `extractionVersion ≠ EXTRACTION_VERSION`
   (= 3) is treated as a miss. A cache *read failure* degrades to a miss, never
   an error.
4. **Spend budget** — a *global*, not per-caller, limiter: `places:resolve`,
   120 cold lookups / 60 s, consumed **only on a cache miss**. Deliberately
   global because resolution is reachable from an anonymous server render of
   `/competitions?placeId=…`, which never passes through the autocomplete
   route's limiter.
5. **Provider** `resolveIdentity` (not `resolveForIngestion` — no containment
   fan-out) with a 4 s `AbortController` deadline.
6. **Extract** `extractSelectedPlaceIdentities(details)` → 1–2 identity keys,
   describing *only the selected place*, never its ancestors.
7. **Look up**
   `prisma.searchArea.findMany({ where: { identityKey: { in: keys } } })` →
   `searchAreaIds`. An empty result is a **success**.
8. **Write cache** best-effort; a write failure logs and returns the answer
   anyway.

**FACT — failure taxonomy.** `PlaceResolutionFailure` =
`PROVIDER_UNAVAILABLE | PROVIDER_TIMEOUT | PROVIDER_RATE_LIMITED |
PLACE_NOT_FOUND | MALFORMED_RESPONSE | STORAGE_UNAVAILABLE`. Transient failures
may fall back to a **stale** cached entry; permanent/semantic ones may not.
`PLACE_NOT_FOUND` is additionally persisted as a negative cache row.

### 6.1 The coordinate gap — the pivotal finding

**FACT.** `PlaceIdentityDetails` (`types/place.ts:92-107`) declares
`latitude: number | null` and `longitude: number | null`.

**FACT.** `IDENTITY_FIELD_MASK` (`google.provider.ts:48-56`) is
`id,displayName,formattedAddress,location,types,addressComponents` — the
`location` field group **is already requested and already billed**, and
`google.provider.ts:437-439` already maps it onto the return value.

**FACT.** `PlaceMatchService` never reads those two fields. `PlaceResolution`
(the return type) has no coordinate fields. The `place_resolution` table has no
coordinate columns. **The anchor coordinate is fetched, paid for, and discarded
on every single location search.**

**OBSERVATION.** This is the cheapest possible starting position for radius
search. Getting the anchor requires:

- 2 nullable `Decimal(9,6)` columns on `place_resolution`,
- 3 lines in `writeCache`, 2 in `toResolved`, 2 in the `PlaceResolution` type,
- **zero** new provider calls, **zero** new billed field groups, **zero** new
  provider-interface methods.

**FACT — identity round-trip.** `verify-location-identity.ts` (556 lines) exists
solely to assert that the key ingestion *writes* equals the key search *looks
up*, because they derive from two different Google responses and are joined on
exact string equality. Its header describes the failure mode precisely: "the
location filter produces `MATCHES_NOTHING`, and the page renders a completely
plausible 'no competitions match these filters'. The failure is silent,
correct-looking, and total." Radius search must not weaken this — see §12, where
the recommended union semantics make a radius miss *additive* rather than
*subtractive*, precisely so it cannot reintroduce a silent-empty failure.

---

## 7. Problem definition

**Today.** A user selects Pune. They see competitions whose `Location` recorded
a link to the Pune `SearchArea` — nothing more, nothing less.

**Not expressible today.**

- A competition in Pimpri-Chinchwad (a distinct `SearchArea`) is invisible to a
  Pune search, even though it is 18 km away.
- A competition in Lonavala (64 km) is invisible even to someone who would
  happily travel there.
- Discovery completeness is bounded by whatever containment evidence Google
  happened to return at ingestion. `docs/architecture/domain/location.md`
  explicitly accepts this: *"'Correct but incomplete' beats 'incorrect
  geographic expansion'."*

**FACT.** The architecture reserved proximity for radius search on purpose.
`extract-search-areas.ts:176-180` discards `NEAR` and `OUTSKIRTS` containment
relations, and `types/place.ts:47` says why: *"`NEAR ≠ WITHIN` — proximity
belongs to radius search."*

**So radius search is the sanctioned mechanism for the one thing the identity
model deliberately refuses to do: geographic proximity.**

---

## 8. Product interpretations of "radius search"

| Option | Meaning | Anchor source | Verdict |
| --- | --- | --- | --- |
| **A** | Within X km of a *selected place* | Google autocomplete, already live | **RECOMMENDED for V1** |
| **B** | Near the user's *current device location* | `navigator.geolocation` | Deferred — see below |
| **C** | Within X km of a *searched* place (neighbourhood etc.) | Same as A | **Already covered by A** |
| **D** | Within X km of a *map-selected point* | A map component | Out of scope |
| **E** | Anchor + radius as one composite value | — | **This is what A actually is** |

**FACT.** A and C are not distinct in this codebase. `PlaceSpec` carries a bare
provider place id with no granularity attached; "Pune" and "Kothrud" enter the
system through the identical path and differ only in what Google returns. So a
single implementation covers both. **The brief's Option E is the accurate
description of the recommendation:** anchor (existing) + radius (new) as one
composite filter value, which is precisely what `PlaceRadiusConfig` reserved.

**RECOMMENDATION — Option B ("near me") is deferred, and not for vague
reasons:**

1. **It bypasses the whole identity system.** A device coordinate has no
   `placeId`, no `identityKey`, no label. Supporting it means `PlaceValue.id`
   becomes optional, `readPlace`'s guard (`no id → no filter`, which today stops
   a stray `includeOnline=true` becoming a silent "online only" filter) must be
   rewritten, and `MATCHES_NOTHING` semantics have to be re-derived for an
   anchor that cannot fail to resolve. That is a change to the *contract*, not
   an addition to it.
2. **It puts raw user-controlled coordinates in the URL**, which is exactly the
   input class §21 wants to avoid trusting.
3. **It cannot be chipped or shared meaningfully.** `placeLabel` is what makes a
   chip and a shared link readable; "18.5204, 73.8567" is neither.
4. It requires a permission prompt, an HTTPS-only API, a denial path, an
   accuracy-unknown path and a "we could not locate you" path — four UI states
   for a feature nobody has asked for yet.

**"Near me" should be reconsidered only after radius-from-a-place ships and is
used.** At that point the honest implementation is *reverse-geocode the device
position to a place id server-side, then run the existing radius search* — which
preserves every invariant above and reuses everything built in V1.

---

## 9. Database and geospatial analysis

### 9.1 What the database actually is

**FACT**, from a live read-only probe of the configured `DATABASE_URL`:

| Fact | Value |
| --- | --- |
| Engine | **PostgreSQL 18.4** (x86_64-windows), local, port 5433 |
| Prisma provider | `postgresql` (`migrations/migration_lock.toml`) |
| Production target | **Neon** (`ep-round-lake-….aws.neon.tech`) — present in `.env` but **commented out** |
| Prisma / client | 6.14.0 |
| Raw SQL in `src/` | **none** — zero `$queryRaw` / `$executeRaw` call sites outside generated code |

**FACT — available extensions** (`pg_available_extensions`, dev database):

| Extension | Available | Installed |
| --- | --- | --- |
| `cube` | ✅ 1.5 | ❌ |
| `earthdistance` | ✅ 1.2 | ❌ |
| `btree_gist` | ✅ 1.8 | ❌ |
| `pg_trgm` | ✅ 1.6 | ❌ |
| **`postgis`** | **❌ not listed** | — |

**This is decisive.** A migration containing `CREATE EXTENSION postgis` would
fail on `prisma migrate dev` on the development machine this repository is
developed on. Adopting PostGIS is not a schema decision; it is a
developer-environment decision that would need Docker or a PostGIS-enabled local
build first.

**OPEN DECISION.** Neon *does* support PostGIS, `cube` and `earthdistance`. But
production is currently commented out, so the deployed target could not be
verified in this pass. Before any extension-based approach, confirm the
production database and its extension allowlist.

### 9.2 Approach 1 — application-level Haversine

Load every candidate `Location` (id, lat, lng) into Node, compute distance, keep
the ids inside the radius.

- **Correctness:** total. Haversine on a sphere is ±0.5 % versus WGS-84 — far
  inside any meaningful radius bucket.
- **Performance:** one `SELECT id, latitude, longitude FROM location WHERE
  latitude IS NOT NULL` plus an O(n) loop. At 5 rows: free. At 100 k rows:
  ~4 MB transferred and ~10 ms of CPU **per request**, which is when it stops
  being acceptable.
- **Index usage:** none possible. Always a sequential scan.
- **Pagination / sorting:** unaffected — this only produces an id set for the
  existing Prisma query.
- **Complexity:** lowest of all options. ~30 lines, no SQL, no migration.
- **Testability:** excellent — a pure function over an array.

### 9.3 Approach 2 — bounding box prefilter + Haversine

```sql
-- Δlat = r / 111.045
-- Δlng = r / (111.045 * cos(radians(lat)))     ← guard cos → 0 near the poles
WHERE latitude  BETWEEN $latMin AND $latMax
  AND longitude BETWEEN $lngMin AND $lngMax
  AND 6371 * acos( LEAST(1, GREATEST(-1,
        sin(radians($lat)) * sin(radians(latitude)) +
        cos(radians($lat)) * cos(radians(latitude)) *
        cos(radians(longitude) - radians($lng))
      ))) <= $radiusKm
```

- **Correctness:** identical to Approach 1. The box is a strict superset of the
  circle, so it can only over-fetch, never under-fetch. `LEAST/GREATEST`
  clamping is required — floating-point drift can push the `acos` argument past
  ±1 and produce `NaN` for a point identical to the anchor.
- **Index usage:** a composite btree on `(latitude, longitude)` serves the
  latitude range and gives a cheap in-index filter on longitude. Not as good as
  a spatial index, considerably better than a seq scan.
- **Data transfer:** only matching ids cross the wire, not the whole table.
- **Complexity:** ~50 lines, one `Prisma.sql` template, one index migration.
- **Portability:** plain ANSI-ish SQL + standard math functions. Runs on any
  Postgres, no extension.
- **Does the prefilter actually help?** At 5 rows, no — measurably nothing helps
  or hurts. At ≥10 k location rows it converts a full scan into an index range
  scan. **OBSERVATION:** the honest reason to write it now is *not* performance,
  it is that adding the index later is free while rewriting the query later is
  not.

### 9.4 Approach 3 — native geospatial (`cube` + `earthdistance`)

```sql
CREATE EXTENSION cube;
CREATE EXTENSION earthdistance;
CREATE INDEX location_earth_idx ON location
  USING gist (ll_to_earth(latitude::float8, longitude::float8));

SELECT id FROM location
WHERE earth_box(ll_to_earth($lat, $lng), $meters) @> ll_to_earth(latitude::float8, longitude::float8)
  AND earth_distance(ll_to_earth($lat, $lng), ll_to_earth(latitude::float8, longitude::float8)) <= $meters;
```

- **Available:** yes on this dev database (uninstalled but present); yes on Neon.
- **Correctness:** spherical, same accuracy class as Haversine.
- **Performance:** true GiST index. The right answer at ≥100 k rows.
- **Costs:** two extensions in a migration; a **functional GiST index that
  Prisma's schema language cannot express**, so it lives only in migration SQL
  and will not survive a `prisma db push` or a schema-first regeneration — a
  real operational footgun that must be documented in the schema as a comment.
  `Decimal(9,6)` must be cast to `float8` at every call site.
- **`earth_box` is a *box*, not a circle** — the `earth_distance` predicate is
  mandatory, not optional.

### 9.5 Approach 4 — PostGIS

`geography(Point, 4326)` + `ST_DWithin` + GiST. The most capable and most
standard option: true geodesic distance, polygon containment, `ST_Distance`
ordering, `KNN <->` operators.

**Rejected for V1 on one hard fact:** not available on the development database
(§9.1). Secondary costs: Prisma has no native `geography` type
(`Unsupported("geography(Point,4326)")` is excluded from the generated client
entirely, so *every* read and write of that column becomes raw SQL), and PostGIS
is a large operational dependency for a dataset of 5 rows.

### 9.6 Approach 5 — geohash / S2 prefix column

Store a geohash string, prefix-match to get candidates, refine with Haversine.
Index-friendly on a plain btree and portable. **Rejected:** it introduces a
second coordinate encoding that must be kept in sync with `latitude`/`longitude`
on every write (a real drift risk in a codebase whose central design principle
is "declare it once"), it has notorious cell-boundary edge cases needing
neighbour expansion, and it buys nothing over Approach 3 which is already
available.

---

## 10. Prisma analysis

**FACT.** Prisma 6.14.0 cannot express any of the following in a typed query:
`sin`/`cos`/`acos`/`radians`, `earth_box`, `ST_DWithin`, an `orderBy` on a
computed expression, or a GiST index on a function.

**FACT.** Prisma *can* express, and already does everywhere in this codebase:

- `Decimal(9,6)` columns (`Location.latitude`) — returned as `Prisma.Decimal`;
- range comparisons on those columns (`{ latitude: { gte, lte } }`);
- `{ locations: { some: { locationId: { in: ids } } } }`;
- `@@index([latitude, longitude])` (a plain composite btree).

**Therefore a naive bounding box is expressible in pure Prisma** — but a
bounding box alone is a *square*, and shipping a square while calling it a
radius would be a correctness lie of up to 41 % in area. The exact distance test
is unavoidable, and it is the *only* thing that needs raw SQL.

### Exactly where raw SQL is required, and why

**RECOMMENDATION.** Precisely one function:

```ts
// src/modules/locations/repository/location.repository.ts
static async findIdsWithinRadius(params: {
  latitude: number; longitude: number; radiusKm: number; limit: number;
}): Promise<string[]>
```

Everything else stays typed Prisma:

| Concern | Layer | Typed? |
| --- | --- | --- |
| Parse & validate `radius` | `spec-values.ts` (`readPlace`) | ✅ |
| Anchor coordinates | `PlaceMatchService` → `place_resolution` | ✅ Prisma |
| **Candidate location ids** | `LocationRepository.findIdsWithinRadius` | ❌ **`$queryRaw` — the only escape** |
| Competition clause | `buildLocationClause` | ✅ Prisma `where` |
| Sort / skip / take / count | `buildSearchQuery` + repository | ✅ Prisma |

**Type safety.** `$queryRaw` returns `unknown`. The function narrows to
`{ id: string }[]` at its boundary and returns `string[]`; nothing outside it
sees an untyped value. This is the same containment discipline `readFilterValue`
uses for its single sanctioned cast.

**Injection.** `Prisma.sql` tagged templates parameterise every interpolation.
Combined with server-side numeric validation (§21) the query takes **only
`float8` and `int` bind parameters** — there is no string interpolation anywhere
in it. `$queryRawUnsafe` must not be used.

**Migrations.** The recommended V1 needs two ordinary Prisma migrations:

1. `place_resolution` + two nullable `Decimal(9,6)` columns;
2. `@@index([latitude, longitude])` on `location`.

Both are expressible in `schema.prisma` and generated by `prisma migrate dev`.
No hand-written migration SQL, no extension, no `Unsupported` type. **This is
the main reason Architecture B is recommended over C for V1** — C's functional
GiST index cannot be expressed in the schema and therefore permanently diverges
the schema file from the database.

**Testing.** `findIdsWithinRadius` is a repository method against the real
database, matching how `verify-search-invariants.ts` and
`verify-admin-competitions.ts` already work. The distance maths itself should
*also* exist as a pure TypeScript function so boundary behaviour can be asserted
without a database, and the two should be cross-checked against each other on a
fixture set (§26).

---

## 11. Architecture options and comparison

All five options share the same **anchor** mechanism (`place_resolution` gains
coordinates) and the same **consumption** point (`buildLocationClause`). They
differ only in how candidate `Location` ids are found.

### Architecture A — in-process Haversine

1. Fetch all `(id, latitude, longitude)` where coordinates are non-null.
2. Filter in Node with a pure `haversineKm` function.
3. Return ids.

**Schema:** anchor columns only. **Migrations:** 1. **Indexes:** none.
**Prisma:** 100 % typed, zero raw SQL. **Complexity:** lowest.
**Testing:** trivially pure. **Scale ceiling:** ~10 k locations.
**Pros:** simplest possible thing that is *correct*; no SQL to review; the
distance function is directly unit-testable. **Cons:** unbounded memory and
transfer growth; a full table read on every radius search; no index will ever
help it.

### Architecture B — bounding box + Haversine in SQL *(recommended)*

1. Compute the bounding box in TypeScript from anchor + radius.
2. One `$queryRaw` with the box predicate + exact Haversine + `LIMIT`.
3. Return ids.

**Schema:** anchor columns + `@@index([latitude, longitude])`. **Migrations:**
2. **Prisma:** one contained raw function; everything else typed.
**Complexity:** low. **Testing:** pure box maths + pure Haversine + one DB
integration suite. **Scale ceiling:** comfortably ~1 M locations.
**Pros:** correct, indexed, portable, no extension, expressible entirely through
`prisma migrate`, and the exact query C would replace — so C becomes a swap
behind an unchanged signature. **Cons:** raw SQL exists where none did before;
the box's longitude term needs a pole guard and an antimeridian branch.

### Architecture C — `cube` + `earthdistance` + GiST

`earth_box(...) @> ll_to_earth(...)` plus `earth_distance(...) <= r`, backed by
a functional GiST index.

**Schema:** anchor columns; index and extensions **only in migration SQL**.
**Migrations:** 2, one hand-edited. **Prisma:** one raw function; the index is
invisible to `schema.prisma`. **Complexity:** medium.
**Scale ceiling:** ~10 M+. **Pros:** genuinely indexed spatial search; available
on both dev and Neon; still no PostGIS. **Cons:** extension privileges required;
a database object the schema file does not describe (drift risk on `db push` /
reset); `Decimal → float8` casts everywhere; buys nothing at Kizunia's scale.

### Architecture D — PostGIS

**Rejected.** Not available on the development database (§9.1). Prisma cannot
represent `geography` in the generated client. Large operational surface for a
5-row table.

### Architecture E — geohash prefix column

**Rejected.** Introduces a derived column that must be maintained on every
write, plus neighbour-cell handling, for no advantage over C.

### Comparison

| | **A** in-process | **B** box+Haversine SQL | **C** earthdistance | **D** PostGIS | **E** geohash |
| --- | --- | --- | --- | --- | --- |
| Available on dev DB | ✅ | ✅ | ✅ (uninstalled) | ❌ **no** | ✅ |
| New extension | none | none | 2 | 1 (large) | none |
| Prisma migrations only | ✅ | ✅ | ❌ hand SQL | ❌ | ✅ |
| Raw SQL surface | none | 1 function | 1 function | pervasive | 1 function |
| Index used | ✗ | btree (partial) | **GiST** | **GiST** | btree |
| Correctness | exact | exact | exact | exact (geodesic) | exact after refine |
| Schema/DB drift risk | none | none | **index invisible to schema** | high | derived-column drift |
| Distance sort later | in Node only | needs `$queryRaw` sort | native | native | needs refine |
| Testability | ★★★ | ★★★ | ★★ | ★★ | ★★ |
| Ops complexity | ★ | ★ | ★★ | ★★★★ | ★★★ |
| OK at 1 M rows | ✗ | ✅ | ✅✅ | ✅✅ | ✅ |
| Effort | 1 day | 2 days | 3 days | 1 week+ | 3 days |

---

## 12. Recommended architecture

**RECOMMENDATION: Architecture B, radius folded into the existing
`competitionLocationFilter`.**

### 12.1 The data flow

```text
?placeId=…&placeLabel=Pune&radius=25&includeOnline=true
        │
        ▼  readFilterValue → readPlace()          [spec-values.ts, CLIENT-SAFE]
   PlaceValue { id, label?, includeOnline, radiusKm? }
        │                                          radiusKm validated against
        │                                          spec.radius.{maxKm, steps}
        ▼  competitionLocationFilter.resolve()     [location-filter.ts]
   PlaceMatchService.resolve({ placeId })
        │  ├── searchAreaIds:  string[]            (unchanged, today's behaviour)
        │  └── anchor:         { lat, lng } | null (NEW — from place_resolution)
        │
        ▼  when radiusKm && anchor
   LocationRepository.findIdsWithinRadius({ …anchor, radiusKm, limit })
        │  bounding box + Haversine, ONE $queryRaw
        ▼
   ResolvedPlace { searchAreaIds, radiusLocationIds? }
        │
        ▼  buildLocationClause()                   [location-clause.ts]
   { OR: [ areaClause, radiusClause?, onlineClause? ] }   ← ONE base clause
        │
        ▼  buildSearchQuery()  PURE                [engine.ts]
   composeAnd([ deletedAt:null, <this>, …17 filters, scope.guard ])
        │
        ▼  findMany(plan) + count(plan)            identical `where` by construction
```

### 12.2 The clause

```ts
// buildLocationClause, extended. Shape today is the shape tomorrow.
const arms: CompetitionWhere[] = [];

if (searchAreaIds.length > 0) {
  arms.push({ locations: { some: { location: {
    searchAreas: { some: { searchAreaId: { in: [...searchAreaIds] } } } } } } });
}

if (radiusLocationIds !== undefined && radiusLocationIds.length > 0) {
  arms.push({ locations: { some: { locationId: { in: [...radiusLocationIds] } } } });
}

if (includeOnline) {
  arms.push({ mode: CompetitionMode.ONLINE });
}

// MATCHES_NOTHING is preserved: no arm means an explicit empty result,
// never an absent restriction. This is the line that must not regress.
return arms.length === 0 ? MATCHES_NOTHING
     : arms.length === 1 ? arms[0]
     : { OR: arms };
```

### 12.3 Why union (`OR`) rather than replacement or intersection

**RECOMMENDATION, and the most consequential product call in this document.**

Three candidate semantics for "Pune + 25 km":

| Semantics | Consequence |
| --- | --- |
| **Replace** the area clause with the radius clause | A competition tagged Pune whose `Location` has null coordinates **disappears** when the user *widens* the search. Adding a radius would remove results. Unacceptable. |
| **Intersect** (`AND`) | "In Pune AND within 25 km of Pune" — strictly narrower than today, which is the opposite of what a radius control visibly promises. |
| **Union** (`OR`) — *recommended* | "Recorded in Pune, **or** within 25 km of Pune's centre." Widening the radius can only ever add results. |

Union is right for four independent reasons:

1. **It matches the mental model.** A "+25 km" stepper next to a selected place
   reads as "and a bit further out", not "re-interpret my place selection".
2. **It is monotonic.** radius 0/absent ⊆ 10 km ⊆ 25 km ⊆ 50 km. A user dragging
   the stepper up never watches results vanish — the single most confusing
   possible behaviour for this control.
3. **It is backward-compatible by construction.** Absent `radius` produces
   *byte-identical* output to today. Present `radius` is purely additive. No
   existing URL, bookmark, preset or shared link can change meaning.
4. **It is robust to the coordinate gap (§23).** 17 of 26 `SearchArea` rows and
   every manually-entered `Location` have no coordinates. Under replacement
   semantics those competitions become invisible; under union they keep matching
   through the identity path exactly as they do now. **Union makes a coordinate
   gap a missed *widening*, never a lost result** — the same "correct but
   incomplete beats incorrect" principle the location architecture already
   states.

**OPEN DECISION.** Union is a genuine product choice. Someone may argue that
"within 25 km of Pune" should *exclude* a competition tagged "Pune District"
that sits 90 km away. That is a defensible position, and it argues for
replacement semantics plus a coordinate backfill. This document recommends union
for V1 and flags the alternative rather than hiding it.

### 12.4 Why this is not a second search system

| Property | Preserved? |
| --- | --- |
| `buildSearchQuery` stays pure and synchronous | ✅ all lookups happen in `planCompetitionSearch` |
| One plan → row query and count query | ✅ radius resolves once, inside the plan |
| Registry-driven chips / Clear all / presets | ✅ `filterParams` already returns `radiusParam` |
| Scope enforcement (`public` / `management` / `admin`) | ✅ resolvable filters are scope-filtered by `resolvableFiltersForScope` |
| Prisma-typed sorting, pagination, counting | ✅ untouched |
| Provider-failure honesty (`FAILED ≠ empty`) | ✅ same three-outcome protocol |
| No new registry entry, route, service or pipeline | ✅ |

**One new file** (`radius.ts`, pure maths), **one new repository method**, **four
edited files**. That is the whole surface.

### 12.5 What we give up

- Distance ordering is not available (needs parameterised sorts — §17).
- The radius scan is not GiST-indexed (irrelevant below ~100 k locations — §13).
- Radius quality is bounded by anchor-coordinate availability; a place whose
  provider record has no `location` silently contributes no radius arm, and the
  UI must say so rather than pretend.

---

## 13. Performance analysis

**FACT — measured, live dev database, 2026-09-03:**

| Table | Rows |
| --- | --- |
| `competition` | **33** |
| `competition_location` | **5** |
| `location` | **5** |
| `search_area` | **26** |
| `location_search_area` | **41** |
| `place_resolution` | **8** |

**FACT.** Competitions by `mode`: `ONLINE` 12, `OFFLINE` 8, `HYBRID` 7,
**`null` 6**. Competitions with ≥1 location: **5** — so **28 of 33 competitions
have no location at all**, including all 6 with a null `mode`.

**OBSERVATION.** `location` grows at roughly one row per competition-venue. Even
at 100 000 competitions with 1.5 venues each, `location` is ~150 000 rows —
smaller than most single-table workloads Postgres is asked to do without
thinking about it.

### Cost of one radius search, by scale (Architecture B)

| `location` rows | Bounding-box scan | Verdict |
| --- | --- | --- |
| 5 (today) | seq scan, <1 ms | irrelevant |
| 1 000 | seq scan, ~1 ms | irrelevant |
| 10 000 | index range scan, ~2 ms | fine |
| 100 000 | index range scan, ~5–15 ms | fine |
| 1 000 000 | index range scan; box selectivity decides; 10–60 ms | **switch to Architecture C** |

Architecture A by contrast degrades from "free" to "transfers 4 MB per request"
somewhere around 100 k rows, with no index available to help.

### The real performance risks are elsewhere

**OBSERVATION.** Three costs dominate a radius search long before the distance
maths does:

1. **The cold provider lookup.** `PlaceMatchService` allows a 4 s provider
   deadline. A cache miss costs ~200–800 ms. **The distance query is two orders
   of magnitude cheaper than the anchor resolution it depends on.**
2. **`{ locationId: { in: [...] } }` with a very large id list.** A 200 km radius
   over a dense future dataset could return tens of thousands of ids, and Prisma
   will inline every one of them into the SQL. **This must be capped** — see §21.
3. **The pre-existing missing `createdAt` index.** The default sort
   (`CompetitionSort.NEWEST` → `createdAt desc`) is unindexed
   ([07 §2](07-implementation-design.md)). Radius does not cause this, but a
   radius search returning a large candidate set will surface it sooner.

**RECOMMENDATION.** Add `@@index([latitude, longitude])` on `location` in V1
even though it is unnecessary at 5 rows. It is free to add now and requires a
migration on a large table later.

---

## 14. URL and search-state analysis

**RECOMMENDATION — the contract:**

```text
?placeId=ChIJ…&placeLabel=Pune&radius=25
```

| Decision | Recommendation | Why |
| --- | --- | --- |
| Parameter name | **`radius`** | `PlaceRadiusConfig.radiusParam` already exists to name it; `radius` is short, guessable, and not reserved. Rejected `radiusKm` (leaks the unit into the contract, blocking a future `unit=mi` without a rename) and `within` (vague). |
| Unit | **km, implicit** | No suffix in the value. `radius=25km` would need a parser and a canonicalisation rule for `25 km` / `25KM` / `25`. A future miles option belongs in a *separate* display preference, never in this value. |
| Type | **Positive integer** | `normalizeInteger` already exists and already rejects `NaN`, `Infinity`, `1e999`, negatives, zero and non-integers. Decimals are meaningless for a distance bucket a user picks from a stepper. |
| Absent | **No radius arm.** Identical to today. | Backward compatibility is structural, not a special case. |
| Default | **None written.** | `spec.radius.defaultKm` may seed the *control*, but the parameter is only written once the user changes it — the same "one URL per view" rule that makes `page=1` and the default sort unwritten (`pagePatch`, `sortPatch`). |
| Invalid (`abc`, `-5`, `0`, `2.5`, `NaN`, `Infinity`) | **Dropped → behaves as absent.** | Matches the whole codebase's policy: "an out-of-range value in a shared or hand-edited URL should degrade to a sane default, not produce an error page" (`pagination.ts:1-6`). |
| Above `maxKm` | **Clamp to `maxKm`.** | Same reasoning as `parsePagination`'s clamps. Clamping is preferred to dropping because dropping silently *narrows* the search the user asked to widen. |
| Off-step (`radius=37`) | **Accept if within `[1, maxKm]`.** | Steps are a UI affordance, not a contract. Rejecting them would make hand-edited URLs and a future slider inconsistent. |
| `radius` without `placeId` | **Ignored entirely.** | `readPlace` returns `undefined` when `idParam` is missing (`spec-values.ts:94-101`), so the whole filter — radius included — is absent. This already works, for the same reason a stray `includeOnline=true` cannot become a silent "online only" filter. **No new code is needed to get this right.** |
| Repeated `?radius=10&radius=25` | First wins | `normalizeScalar` behaviour, consistent with every other scalar. |
| Sharing / back / forward / refresh | Free | The URL is the applied state; `useSearchParamsState` pushes history entries for discrete changes. |

**RECOMMENDATION — the spec value:**

```ts
const location: PlaceSpec = {
  …,
  radius: {
    radiusParam: "radius",
    defaultKm: 25,
    maxKm: 200,
    steps: [5, 10, 25, 50, 100, 200],
  },
};
```

**OPEN DECISION — `maxKm`.** 200 km is proposed as "a day trip in India, and a
bounding box that stays selective". 500 km would make "anywhere in Maharashtra"
expressible as a radius, which is arguably the identity filter's job. This
number should be a product call, not an engineering default.

---

## 15. Filter interaction analysis

**FACT.** `composeAnd` ANDs base clauses, filter clauses and the scope guard.
Every filter is therefore already AND-composed with every other.

**RECOMMENDATION.** Radius is **AND** with all other filters, and **OR** only
*within* the location clause. "Within 25 km of Pune, AND AI/ML, AND free entry"
is the obvious reading and requires no new composition rule.

| Filter | Parameter(s) | Interaction with radius | Notes |
| --- | --- | --- | --- |
| `search` | `search` | AND | title/organizer `contains` |
| `categories` | `categories` | AND | |
| `technologies` | `technologies` | AND | |
| `modes` | `modes` | AND | **⚠ see below** |
| **`location`** | `placeId`,`placeLabel`,`includeOnline`,**`radius`** | **same filter, ORed arms** | one clause |
| `statuses` | `statuses` | AND | |
| `registrationFeeTypes` | `registrationFeeTypes` | AND | |
| `difficultyLevels` | `difficultyLevels` | AND | |
| `eligibilities` | `eligibilities` | AND | |
| `registrationTypes` | `registrationTypes` | AND | |
| `registrationPlatforms` | `registrationPlatforms` | AND | |
| `organizerTypes` / `organizers` | … | AND | |
| `certificateTypes` | `certificateTypes` | AND | |
| `teamSize` | `minTeamSize`,`maxTeamSize`,`teamSizePolicy` | AND | |
| `registrationDeadline` / `startDate` / `endDate` | `<key>From`,`<key>To` | AND | |
| `recordState` (admin only) | `recordState` | AND | never in public specs |
| Sorting | `sort` | orthogonal | no distance sort in V1 |
| Pagination | `page`,`limit` | orthogonal | reset on filter change |
| Presets | `preset` | provenance marker only | §19 |

### The `includeOnline` trap — why radius cannot be a separate clause

**FACT + OBSERVATION.** This is the finding that fixes the architecture.

Suppose radius were an independent resolvable filter contributing its own base
clause. With `placeId=Pune&includeOnline=true&radius=25`:

```text
composeAnd([
  { OR: [ puneAreas, { mode: ONLINE } ] },                      ← place filter
  { locations: { some: { locationId: { in: nearPune } } } },    ← radius filter
])
```

An `ONLINE` competition has **no `CompetitionLocation` rows at all**, so it
fails the second clause unconditionally. **`includeOnline=true` would silently
do nothing whenever a radius is set.** The user asked for online results and the
page would quietly withhold them — with no chip, no message, and no way to tell
from the URL that anything was wrong.

Folding radius into one clause with ORed arms makes this unrepresentable. It is
also, independently, exactly what `PlaceRadiusConfig`'s comment already
prescribes ("radius is a property of the *selected place* … it can never be an
independent registry entry"). **Two separate lines of reasoning converge on the
same design, which is the strongest evidence available that it is right.**

### A second, subtler trap: `some` does not co-refer

**OBSERVATION.** Even inside one clause, `{ locations: { some: A } }` OR
`{ locations: { some: B } }` (and equally, if they were ANDed) does **not**
require A and B to be satisfied by the *same* `CompetitionLocation` row. A
multi-city competition with a Pune qualifier and a Chennai final satisfies both
arms via different rows.

Under the recommended **union** semantics this is harmless — the competition
matches, which is correct, since it genuinely has a Pune stop. Under
**intersection** semantics it would be a real bug ("in Pune AND within 25 km of
Pune" satisfied by two different cities). One more reason union is the safer V1.

---

## 16. Online / offline / hybrid

**FACT.** `Competition.mode` is `ONLINE | OFFLINE | HYBRID` and is **nullable**.
6 of 33 rows are `null`.

**FACT.** `mode` and `locations` are independent. The schema comment on
`Competition.locations` says so explicitly: *"Zero locations is valid — it means
no location is known yet, not that the competition is online. Participation mode
lives on `mode`."* Nothing in the code derives one from the other.

**RECOMMENDATION — behaviour under an active radius:**

| Competition | Has coordinates? | Matches radius arm? | Result |
| --- | --- | --- | --- |
| `OFFLINE`, location within radius | ✅ | ✅ | **included** |
| `HYBRID`, venue within radius | ✅ | ✅ | **included** — a physical venue is a physical venue regardless of the online option |
| `HYBRID`, venue outside radius | ✅ | ❌ | excluded, unless `includeOnline=true`… |
| `ONLINE`, no locations | — | ❌ | **excluded unless `includeOnline=true`**, exactly as today |
| Any mode, location with **null coordinates** | ❌ | ❌ | **still matches via the area arm** — this is what union semantics buys |
| `mode = null`, has a location in radius | ✅ | ✅ | **included** — matching is by geography, not by mode |
| `mode = null`, no locations | — | ❌ | excluded. Correct: nothing is known about where it is. |

**RECOMMENDATION — do not auto-exclude `HYBRID`, and do not auto-include
`ONLINE`.** Both would be the location filter deciding on the user's behalf,
which `location-clause.ts:62-66` explicitly rejects as a design principle:
*"Including them is an explicit user choice rather than something the location
filter decides on their behalf."* Radius does not change who gets to decide.

**OPEN DECISION.** Should `includeOnline` widen to
`{ mode: { in: [ONLINE, HYBRID] } }`? Today it is `ONLINE` only, so a hybrid
competition 300 km away is invisible to a Pune search even with online results
included — arguably wrong, since a hybrid event *is* attendable online. **This is
a pre-existing question, not one radius introduces**, but radius makes it more
visible and it should be settled at the same time.

---

## 17. Sorting by distance

**FACT.** `SortRegistry` (`sort.ts:314-328`) holds a **static**
`readonly orderBy: readonly TOrderBy[]` per option. There is no mechanism to
parameterise a sort by a request value, and
[06-open-questions §1](06-open-questions.md) already identifies this:
*"Distance as a sort option … would be the first sort whose `orderBy` depends on
a *parameter* rather than being static. `SortRegistry` would need to admit
parameterised sorts."*

**FACT.** Even with a parameterised registry,
`Prisma.CompetitionOrderByWithRelationInput` cannot express an expression-based
ordering. Distance sort requires the *row* query to be raw SQL, not just the
candidate-id lookup.

**FACT.** A competition can have many locations. "Distance to a competition" is
therefore `MIN(distance over its locations)` — an aggregate, adding a second
layer Prisma cannot express.

**RECOMMENDATION: not in V1.** The full cost is: parameterised `SortRegistry` +
a raw-SQL row query path + a per-competition distance aggregate + a
`page`-stable tiebreaker on a float + a `distance` sort token in the URL that is
meaningless without a `placeId` (a new class of parameter interdependence the
engine has never had). That is a larger change than radius filtering itself.

**RECOMMENDATION for V1 instead:** keep the existing sorts. Distance is a
*filter* in V1, not a ranking. If ordering matters before the full solution is
built, an **in-page annotation** ("18 km away") computed in the mapper from
already-loaded `Location` coordinates is nearly free and delivers most of the
user value without touching the query at all.

**OPEN DECISION.** Is "nearest first" a launch requirement? If yes, V1 grows by
roughly a week and the recommendation in §12 should be revisited in favour of
Architecture C, whose `earth_distance` ordering is index-assisted.

---

## 18. Pagination

**FACT.** Offset pagination. `page` is reset by
`applyParamPatch({ resetPage: true })`, which every filter control passes.

**RECOMMENDATION — the query order is already correct and unchanged:**

```text
1. resolve anchor        (async, once per request, in planCompetitionSearch)
2. resolve radius ids    (async, once per request, capped)
3. compose WHERE         (pure)
4. ORDER BY + tiebreaker (Prisma)
5. OFFSET / LIMIT        (Prisma)
6. COUNT(*)              (Prisma, same WHERE, from the same plan)
```

**Stability.** Because V1 has no distance sort, ordering stays fully
deterministic — every sort ends in `{ id: "asc" }`. Radius introduces **no**
pagination instability.

**FACT — one caveat.** Steps 1–2 run once per request, and rows/count are built
from one plan. But two *sequential* requests (page 1, then page 2) each resolve
independently. If a 30-day cache entry expires between them, or a `SearchArea`
is ingested between them, page 2 could reflect a slightly different candidate
set. This is **already true today** for `searchAreaIds` and is inherent to
offset pagination over live data; radius does not make it worse.

**RECOMMENDATION.** Changing `radius` must reset `page` — which it does
automatically, because the control writes through
`apply(..., { resetPage: true })` like every other filter. No new code.

---

## 19. Preset interaction

**FACT.** Presets are a pure URL mechanism (`src/lib/search/presets.ts`):
`applyPresetPatch` = `clearAllFiltersPatch(specs)` +
`sanitizePresetFilters(specs, filters)` + set `preset` + clear `page`.
`capturePresetFilters` reads every spec through `readFilterValue` and re-writes
through `writeFilterValue`.

**FACT.** All four of those functions iterate `filterParams(spec)`, which
**already returns `radius.radiusParam` when `spec.radius` is set**. Therefore:

| Scenario | Behaviour | Code change needed |
| --- | --- | --- |
| Save "Pune within 25 km" as a custom preset | `capturePresetFilters` → `{ placeId, placeLabel, radius: "25" }` | **none** |
| Apply that preset | `applyPresetPatch` clears everything, writes all three | **none** |
| Apply "In Pune" (no radius), then set radius 25 | Preset marker survives — refinement keeps it active by design | **none** |
| Apply another preset while radius is set | `clearAllFiltersPatch` removes `radius` because `filterParams` names it | **none** |
| Clear all filters | `radius` removed with everything else | **none** |
| A hand-edited `localStorage` preset containing `{"radius":"99999"}` | `sanitizePresetFilters` keeps it (it *is* an owned parameter), then `readPlace` clamps it to `maxKm` at decode time | **none — but this is exactly why clamping must live in the decoder, not the control** |

**RECOMMENDATION.** Do **not** add a radius to the `in-pune` platform preset.
"In Pune" currently means the identity match, and changing it would silently
alter results for every existing `?preset=platform:in-pune` link. If a
radius-flavoured preset is wanted, add a **fourth** preset ("Around Pune",
`placeId` + `radius=25`) — `COMPETITION_PLATFORM_PRESETS` is a plain list and
adding an entry changes nothing else.

**OPEN DECISION.** Should "In Pune" eventually mean "within a radius of Pune"?
That is a product question about what the preset promises, and it should not be
resolved as a side effect of shipping radius.

---

## 20. UX analysis

**FACT — the established structure**, from
`src/modules/competitions/components/discovery/competition-filters.tsx` and
`src/modules/competitions/search/layout.ts`:

- **Quick bar** = shortcuts. Six filters, pinned in decision order: `search`,
  `categories`, `modes`, **`location`**, `statuses`, `registrationFeeTypes`.
  Deliberately not everything — "a quick bar that contains everything is not a
  quick bar".
- **All filters** sheet = `layout.visible`, i.e. every filter *including* the
  quick ones, plus the preset panel.
- **Clear all** is always on screen, disabled when nothing is applied.
- **Active chips** iterate every registered spec, not the resolved layout.
- Quick-bar changes apply instantly; sheet changes are staged.

**FACT.** `competition-filters.tsx` contains **no per-filter branching** and its
own header states adding a filter must not require editing it. **A radius
control that required a change to this file would be an architectural
regression.**

**RECOMMENDATION — put radius inside `PlaceControl`, below the selected place,
above the "Including online" switch:**

```text
┌─ Location ──────────────────────────────┐
│  📍 Pune                            ✕   │
│                                         │
│  Search radius                          │
│  ( Exact ) ( 5 ) ( 10 ) (•25•) ( 50 )   │  ← segmented, only when a place is set
│  ( 100 ) ( 200 )              km        │
│  Also shows competitions near Pune.     │
│  ─────────────────────────────────────  │
│  Including online              [ off ]  │
└─────────────────────────────────────────┘
```

Why this placement:

1. **It is where the value lives.** `PlaceValue` gains `radiusKm`; one control
   owns one value. A separate "Radius" entry in the quick bar or the sheet would
   be a control with no meaning half the time, and `defineSearch` would reject a
   second filter claiming the same parameter anyway.
2. **It reuses the existing hidden-until-relevant pattern.** `PlaceControl`
   already renders the `includeOnline` switch only once a place is selected
   (`{value && <>…</>}`). Radius follows the identical rule — impossible to set
   a radius with no centre, enforced by the UI *and* by the decoder.
3. **`layout.ts` needs no change.** Location is already pinned 4th in the quick
   bar and already appears in the sheet.
4. **Mobile.** The sheet renders the same `PlaceControl`; a segmented control
   wraps to two rows and needs no separate mobile design.
5. **`competition-filters.tsx` is untouched.** Requirement met.

**RECOMMENDATION — chips.** `describeFilterChips`'s `place` branch
(`spec-values.ts:613-638`) already emits a separately-removable chip per
sub-value. Radius should follow `includeOnline`'s precedent exactly:

```text
[ Pune  ✕ ]  [ Within 25 km  ✕ ]  [ Including online  ✕ ]
```

Removing the radius chip patches `{ radius: undefined }` and leaves the place —
the same reasoning as *"a user narrowing to 'Pune only' should not have to clear
the place and re-pick it."*

**RECOMMENDATION — honesty when the anchor has no coordinates.** If the resolved
place carries no `lat/lng`, the radius arm contributes nothing. Silently
returning the un-widened result would be the same class of error the codebase
avoids everywhere else. Render an inline note: *"We don't have coordinates for
this place, so the radius isn't being applied."*

---

## 21. Security and abuse

**FACT.** `/competitions` and `GET /api/v1/competitions` are **public and
unauthenticated**. Anything reachable from them is reachable by anyone.

**FACT.** Existing defences: `PlaceIdSchema` validation before any I/O; a global
`places:resolve` budget of 120 cold lookups/60 s; a per-IP
`places:autocomplete` limit of 30/60 s; `MAX_FILTER_VALUES = 50`;
`MAX_TEXT_LENGTH = 200`; `escapeLikeWildcards`; page clamped to 100 000; limit
clamped to 100.

**RECOMMENDATION — validation placement. Server-side is mandatory; client-side
is convenience only:**

| Input | Where validated | Behaviour |
| --- | --- | --- |
| `radius` non-numeric / `NaN` / `Infinity` / `1e999` | **`readPlace`** in `spec-values.ts` (runs on both server and client, but the *server* run is the one that governs) | dropped → radius absent |
| `radius <= 0`, negative, non-integer | `readPlace` via `normalizeInteger` (already rejects all of these) | dropped |
| `radius > maxKm` | `readPlace` | **clamped** to `maxKm` |
| Anchor latitude ∉ [-90, 90], longitude ∉ [-180, 180] | `LocationRepository.findIdsWithinRadius` guard | return `[]` |
| Anchor `NaN` | same guard | return `[]` |
| SQL injection | `Prisma.sql` tagged template; every value a bind parameter; **`$queryRawUnsafe` forbidden** | impossible |
| Result-set explosion | `LIMIT` inside the SQL **and** a `MAX_RADIUS_LOCATION_IDS` cap before building `{ in: [...] }` | bounded |
| Expensive repeated queries | Reuses the existing `places:resolve` budget — the *anchor* is the expensive half, and it is already bounded | no new limiter needed for V1 |

**Two design rules that matter more than the table:**

1. **Validation belongs in `readFilterValue`, not in the control.** The control
   is one of several writers (presets from `localStorage`, hand-edited URLs,
   shared links, the API). Putting the clamp in the sole decoder makes it
   unbypassable — which is the same argument `types.ts:8-25` makes for having
   one decoder at all.
2. **The id cap must fail *visibly*.** If `findIdsWithinRadius` hits its cap, the
   result is a silently truncated search. **RECOMMENDATION:** set the cap high
   enough that reaching it is a bug (e.g. 20 000 — four orders of magnitude
   above today's 5 rows), and `console.error` on hit so it surfaces in logs
   rather than as quietly wrong results.

**OBSERVATION — no new abuse surface.** Radius adds one bounded integer to an
already-public endpoint. The genuinely abusable resource is the *billed provider
lookup*, and radius reaches it through the exact same `PlaceMatchService` path,
under the exact same global budget, as today.

---

## 22. Caching

**FACT.** Three caches exist: `place_resolution` (30 d / 24 h TTL, database);
the in-flight `Map` coalescing concurrent identical lookups; and Next.js's own
render cache, which the competitions page does not configure.

**RECOMMENDATION — do not add a radius result cache.**

1. **The expensive half is already cached.** Anchor resolution (a billed network
   call) is cached for 30 days. The distance query is sub-millisecond at any
   plausible scale.
2. **The cache key would be enormous.** `(anchor, radius, 17 other filters,
   sort, page, scope)`. Hit rates on that key space are near zero except for the
   handful of preset-seeded searches, which are cheap anyway.
3. **Competition data changes.** A cached result set can show a deleted or
   newly-unpublished competition. The existing architecture is deliberately
   cache-free for result sets.
4. It would be the first result-set cache in the codebase, introducing
   invalidation as a whole new concern for a query that takes 1 ms.

**RECOMMENDATION — one cheap, safe caching change, *if* profiling later shows a
need:** cache the `anchor → locationIds` mapping per `(placeId, radiusKm)` in
memory with a short TTL. It is small, keyed on two values, and independent of
competition data. **Do not build it in V1.**

**FACT — the migration interaction.** Adding coordinate columns to
`place_resolution` leaves every existing row with `NULL` coordinates. Options:
bump `EXTRACTION_VERSION` (invalidates *all* cached resolutions, forcing a full
re-bill — heavy-handed), or treat a `RESOLVED` row with null coordinates as
fresh for the area path and stale *only* when a radius is requested.
**RECOMMENDATION: the second.** It re-bills only the places someone actually
asks for a radius around, and it costs a few lines in `readCache`.

---

## 23. Data quality and migration

### 23.1 Measured state

**FACT**, live dev database, 2026-09-03:

| Question | Answer |
| --- | --- |
| `Location` rows | 5 |
| `Location` rows missing lat **or** lng | **0** |
| `Location` rows by provider | 5 × `GOOGLE`, 0 × `MANUAL` |
| `SearchArea` rows | 26 |
| **`SearchArea` rows missing lat or lng** | **17 (65 %)** |
| `place_resolution` rows | 8 (none carry coordinates — no such columns) |

### 23.2 Why 65 % of SearchAreas have no coordinates

**FACT.** `extractSearchAreaCandidates` (`extract-search-areas.ts:233-244`)
emits `ADDRESS_COMPONENT`-sourced candidates with
`latitude: null, longitude: null` — hard-coded, because Google returns no
coordinates for an address component. And address components are *the only way*
Pune, Maharashtra and India get an identity at all (the code says so, lines
205-209).

**OBSERVATION — the consequence.** The most commonly selected search anchors —
cities, states, countries — are precisely the `SearchArea` rows least likely to
have coordinates. **`SearchArea` is therefore the wrong source for anchor
coordinates**, and any design that assumed otherwise would fail on exactly the
places users search for most.

### 23.3 Where the anchor coordinate must come from

| Source | Viable? | Why |
| --- | --- | --- |
| `SearchArea.latitude/longitude` | ❌ | 65 % null, and null for the common cases (§23.2) |
| `Location.latitude/longitude` | ❌ | Describes a *competition's venue*, not the *user's chosen anchor*. A place with no competitions has no `Location` row at all. |
| **`PlaceIdentityDetails.latitude/longitude`, persisted on `place_resolution`** | ✅ | Already fetched, already billed, already mapped, discarded at the last step. **RECOMMENDED.** |
| Client-supplied `lat`/`lng` in the URL | ❌ | Unverifiable, unbounded, bypasses identity, breaks chips and sharing (§8) |

### 23.4 Competition-side coordinates

**FACT.** `placeDetailsToLocationInput` (`normalize.ts:192-193`) copies
`details.latitude` / `details.longitude` onto every Google-ingested `Location`.
**Coordinates are effectively guaranteed for the provider path** (subject to
Google returning them, which it does for every place type observed).

**FACT.** Coordinates are **not** guaranteed for the two other paths:

1. **Manual entry.** `LocationInputSchema` makes `latitude`/`longitude`
   optional. A pair that is only half-supplied is rejected (`superRefine`, with
   the comment *"A half-set coordinate is worse than none — it silently breaks
   any future proximity search"* — written in anticipation of exactly this
   feature). But omitting both is fully valid.
2. **Seeds.** `prisma/seed/seeders/competitions.seeder.ts:160-172` creates
   locations via `normalizeLocationInput({ displayName: h.location })` — a bare
   string. No coordinates.

> **FACT — a second documentation drift, and a significant one.**
> `docs/architecture/domain/location.md` § Ingestion states that manual entry
> *"Creates the `Location` plus a single `EXACT` self-area with a contextual
> identity key."* The code does not do this.
> `competition-location.service.ts` computes
> `const candidates = resolved.details ? extractSearchAreaCandidates(resolved.details) : []`
> — and `resolveSource` returns `details: null` for the manual path. **A
> manually entered location therefore gets zero `SearchArea` rows and is not
> discoverable by the location filter at all**, not even under its own name. The
> seeder's own comment confirms this is the intended current behaviour ("No
> SearchAreas: seed locations are free text… not discoverable by location until
> re-added through the place picker"), so the *code* is self-consistent and the
> *domain doc* is stale. This is worth fixing independently of radius search.

**OBSERVATION.** Combined with the measured 28-of-33 competitions having no
location at all, the practical reach of *any* location feature today is 5
competitions. **Location data coverage, not distance maths, is the limiting
factor on this feature's usefulness.**

### 23.5 Is a backfill required?

**RECOMMENDATION: no backfill is required for V1**, for three reasons:

1. All 5 `Location` rows already have coordinates.
2. Union semantics (§12.3) mean a coordinate-less location still matches via the
   identity path. Missing coordinates cost a *widening*, not a result.
3. `place_resolution` coordinates fill in naturally as places are resolved, at
   zero extra cost (§22).

**RECOMMENDATION — explicitly do NOT bulk-geocode.** The brief warns about this
and the warning is correct here:

- Geocoding a free-text `displayName` ("Multiple cities, India", "Dehradun,
  India + Online" — both real seed values) produces confident, wrong
  coordinates. **A wrong coordinate is worse than a missing one**: missing is
  visibly incomplete, wrong is invisibly false, and radius search would then
  assert things about the world that are not true.
- It bills a Geocoding API that no code currently calls, has no cache table, no
  negative cache, no rate limiter and no failure taxonomy — i.e. none of the
  machinery `PlaceMatchService` provides for the resolution path.
- It bypasses the identity architecture entirely, creating a second way places
  enter the system. That is precisely the "second system" the brief forbids.

**RECOMMENDATION instead — an operational report, not a migration.** A read-only
script (`scripts/report-location-coverage.ts`, following the existing
`verify-*.ts` convention) that prints: locations without coordinates, locations
without search areas, competitions without locations, and search areas without
coordinates. Run it before and after V1. It turns "how good is our location
data" from a guess into a number, and costs nothing.

### 23.6 Provider-id stability

**OBSERVATION.** Google place ids are documented as stable but *can* be
re-pointed or retired. The architecture already handles this: a retired id
resolves to `PLACE_NOT_FOUND`, is negatively cached for 24 h, and the search
returns an honest empty result rather than an error. Radius inherits this
unchanged — a dead anchor produces no coordinates and therefore no radius arm.

**FACT.** `PUNE_PLACE_ID = "ChIJARFGZy6_wjsRQ-Oenb9DjYI"` is hard-coded in
`search/presets.ts`. If that id is ever retired the "In Pune" preset silently
stops matching. Pre-existing; worth a note in the coverage report.

---

## 24. Backward compatibility

**RECOMMENDATION — the guarantee to make and to test:**

> **A URL without `radius` must produce a byte-identical Prisma `where` before
> and after this change.**

This is achievable and cheap to assert, because `radiusLocationIds` is
`undefined` when radius is absent and `buildLocationClause` then constructs the
same one or two arms it does today.

| Surface | Effect of shipping radius |
| --- | --- |
| `/competitions?placeId=X` | Identical results |
| `/competitions?placeId=X&includeOnline=true` | Identical results |
| Bookmarks and shared links | Unaffected |
| `?preset=platform:in-pune` | Unaffected (no radius in the preset — §19) |
| Saved custom presets in `localStorage` | Unaffected; `sanitizePresetFilters` ignores unknown keys and `radius` simply is not in them |
| Server-rendered "Clear all" / "Try again" links | Unaffected; both go through `buildSearchHref` |
| `GET /api/v1/competitions` | Unaffected; `radius` is optional |
| Admin and management listings | Unaffected; the same registry, the same resolvable filter, radius simply absent |

**RECOMMENDATION.** Add this to `verify-search-invariants.ts` as an explicit
assertion, not as an assumption: build the plan for a fixed set of radius-free
URLs before and after, and deep-compare the `where`.

---

## 25. Edge cases

### Relevant, must be handled

| # | Case | Recommended behaviour | Enforced where |
| --- | --- | --- | --- |
| 1 | `radius=0` | Dropped (`normalizeInteger` rejects `<= 0`) → radius absent | `readPlace` |
| 2 | `radius=-5` | Dropped | `readPlace` |
| 3 | `radius=abc` / `NaN` / `Infinity` / `1e999` | Dropped | `normalizeInteger` |
| 4 | `radius=2.5` | Dropped (`Number.isSafeInteger` fails) | `normalizeInteger` |
| 5 | `radius=999999` | Clamped to `maxKm` | `readPlace` |
| 6 | `radius` with no `placeId` | Whole filter absent — **already works today** | `readPlace:94-101` |
| 7 | `placeId` with no `radius` | Today's exact behaviour | §24 |
| 8 | Anchor resolves with **null coordinates** | No radius arm; area arm stands; UI says so | resolver + `PlaceControl` |
| 9 | Anchor resolution **FAILS** | Whole search fails loudly (`LOCATION_RESOLUTION_FAILED`) — unchanged | `planCompetitionSearch` |
| 10 | `Location` with null coordinates | Excluded from the radius arm; **still matches via the area arm** | union semantics |
| 11 | Distance exactly `= radius` | **Inclusive** (`<=`). "Within 25 km" includes 25.000 km | SQL predicate |
| 12 | Location identical to the anchor | Distance 0 → included. **Requires `acos` argument clamping** or the float can exceed 1 and yield `NaN` | SQL `LEAST/GREATEST` |
| 13 | Radius matches **zero** locations | Radius arm omitted; area arm stands; if both are empty → `MATCHES_NOTHING`, honest empty page | `buildLocationClause` |
| 14 | Radius matches **very many** locations | Capped at `MAX_RADIUS_LOCATION_IDS`, logged as an error | repository |
| 15 | Soft-deleted competition | Excluded by the `deletedAt: null` base clause, applied *before* the location clause | `deletionClauses` |
| 16 | `PRIVATE` / `UNLISTED` / `ARCHIVED` competition | Excluded by the `public` scope guard, applied *last* and not expressible as a filter | `publicScope` |
| 17 | `page=7` when radius narrows results | `resetPage: true` on every filter change | `applyParamPatch` |
| 18 | Change the place while a radius is set | Radius **carried over** — matches how `PlaceControl` already carries `includeOnline` | `PlaceControl.select` |
| 19 | Remove the place while a radius is set | `clearFilterPatch(spec)` clears *all* owned params including `radius` | `filterParams` |
| 20 | Change the radius while a preset is active | Preset marker survives (refinement) | `presets.ts` |
| 21 | Apply another preset while a radius is set | `radius` cleared with everything else | `clearAllFiltersPatch` |
| 22 | Clear all filters | `radius` cleared | `clearAllFiltersPatch` |
| 23 | Shared or hand-edited URL | Clamped/dropped, never an error page | `readPlace` |
| 24 | Ambiguous place name ("Nashik") | Google autocomplete disambiguates before selection; the anchor is a single place id | unchanged |
| 25 | Multi-location competition, one stop in range | Matches — `some` semantics | Prisma |

### Relevant to *code*, not to today's data

| # | Case | Recommended behaviour |
| --- | --- | --- |
| 26 | **Antimeridian** (box crosses ±180°) | Split the longitude predicate into `lng >= min OR lng <= max`. ~5 lines. Cheap insurance; skipping it means a silently empty result for a Fiji/NZ anchor. |
| 27 | **Near the poles** (`cos(lat) → 0`) | `Δlng` diverges. Clamp: if `\|lat\| + Δlat >= 90`, use the full longitude range and let the Haversine test do the work. |
| 28 | Anchor lat/lng out of valid range | Guard → return `[]` |

### Not relevant, and why

| Case | Why not |
| --- | --- |
| Coordinate-system reprojection | Everything is WGS-84 from one provider. No transformation exists to get wrong. |
| Ellipsoidal (Vincenty) accuracy | Haversine's 0.5 % error is 125 m at 25 km. The radius buckets are 5–200 km. Irrelevant. |
| Timezone / DST in distance | Distance is not temporal. `Location.timezone` is unpopulated and unused. |
| Sharded / partitioned geo tables | 5 rows. |
| Competitions "moving" | `Location` is immutable per competition except by admin edit, which re-derives search areas transactionally. |
| Concurrent radius writes | Radius is read-only. Nothing writes it. |

---

## 26. Testing strategy

**FACT.** No test runner. The convention is a standalone `tsx` script under
`scripts/`, run as `pnpm exec tsx scripts/verify-*.ts`, asserting against the
same functions production calls.

**RECOMMENDATION — three suites, matching the existing separation of concerns
(pure logic / identity / engine behaviour):**

### 26.1 `scripts/verify-radius-math.ts` — pure, no database

| Group | Cases |
| --- | --- |
| Bounding box | Δlat correct; Δlng scales with `1/cos(lat)`; box is a strict superset of the circle (property test over random anchors); antimeridian split; pole clamp |
| Haversine | Known city pairs (Pune↔Mumbai ≈ 120 km, Pune↔Pimpri ≈ 15 km, Pune↔Lonavala ≈ 64 km) within 1 %; distance to self **= 0, not `NaN`**; symmetry `d(a,b) == d(b,a)`; antipodal points |
| Radius decoding | Every row of §25 #1–#7 and #23 asserted directly against `readFilterValue(locationSpec, params)` |
| Round trip | `writeFilterValue(readFilterValue(x)) === x` for radius present/absent/clamped — the existing "canonical URLs are stable" invariant, extended |

### 26.2 `scripts/verify-radius-search.ts` — real database, fixture rows

Follows `verify-admin-competitions.ts`, which already creates and tears down
real fixture rows.

Fixtures: an anchor plus competitions at **0 km**, **exactly 25.000 km**,
**24.9 km**, **25.1 km**, **null coordinates**, `ONLINE` with no locations,
`HYBRID` in range, `HYBRID` out of range, soft-deleted in range, `PRIVATE` in
range, and a multi-city competition with one stop in range.

| Assertion |
| --- |
| Inside radius → included; outside → excluded |
| **Exactly on the boundary → included** (`<=`) |
| Distance-zero row returns without `NaN` |
| Null-coordinate location excluded from the radius arm **but still matched via its search area** (union semantics) |
| `ONLINE` excluded unless `includeOnline=true`; **`includeOnline=true` with a radius still returns online results** — the §15 trap, asserted directly |
| `HYBRID` with an in-range venue included |
| Soft-deleted and `PRIVATE` never returned in the `public` scope |
| Radius + 3 other filters → AND semantics |
| `findMany(plan)` and `count(plan)` agree, with radius active |
| `where` for a radius-free URL is **deep-equal to the pre-change output** (§24) |
| The SQL takes only bind parameters — assert the generated `Prisma.sql` has no interpolated strings |
| The id cap truncates *and* logs |

### 26.3 Extensions to existing suites

- **`verify-place-resolution.ts`** — anchor coordinates are read from the
  provider, persisted to `place_resolution`, returned from cache, and a cached
  row with null coordinates is treated as stale when (and only when) a radius is
  requested. Assert the field mask has **not** grown (no new billing).
- **`verify-competition-presets.ts`** — save/apply/clear a preset carrying
  `radius`; a `localStorage` preset with `{"radius":"99999"}` is clamped, not
  honoured.
- **`verify-search-invariants.ts`** — radius never produces an empty `in`;
  `defineSearch` still rejects a duplicate claim on `radius`; the
  byte-identical regression check from §24.

**OPEN DECISION.** This feature is a good moment to adopt Vitest. Five scripts
totalling 4 153 lines is past the point where a runner pays for itself, and
07 §8 already recommends it. Deciding to keep scripts is fine; deciding by
default is not.

---

## 27. V1 scope

### MUST HAVE

| Item | Why |
| --- | --- |
| `radius` on `PlaceSpec` (`radiusParam`, `defaultKm`, `maxKm`, `steps`) | The whole feature |
| `PlaceValue.radiusKm?: number` + decode/encode/chip in `spec-values.ts` | One decoder, both sides |
| Anchor coordinates: 2 nullable columns on `place_resolution` + read/write | §23.3 — the enabling change |
| `LocationRepository.findIdsWithinRadius` (`$queryRaw`, box + Haversine, capped) | The only raw SQL |
| `buildLocationClause` extended to ORed arms | §12.2 |
| Server-side validation, clamping, id cap | §21 |
| `@@index([latitude, longitude])` on `location` | Free now, a migration on a big table later |
| Radius control inside `PlaceControl` | §20 |
| A separately-removable "Within 25 km" chip | §20 |
| km only, integer only | §14 |
| URL persistence, back/forward, refresh, sharing | Free from the existing architecture |
| Backward-compatibility assertion | §24 |
| The three test suites | §26 |

### SHOULD HAVE

| Item | Why not MUST |
| --- | --- |
| `scripts/report-location-coverage.ts` | Operational visibility, not user-facing |
| "We don't have coordinates for this place" notice | Only reachable when the provider omits `location`; not yet observed |
| Antimeridian + pole handling | ~10 lines; irrelevant to India but cheap and prevents a silent wrong answer |
| A fourth "Around Pune" platform preset | Demonstrates the feature; trivially added later |

### FUTURE

- Distance sort (needs parameterised `SortRegistry` + raw row query) — §17
- "N km away" annotation on competition cards (cheap, high value, no query
  change)
- `cube`/`earthdistance` GiST migration — §11 Architecture C
- Browser geolocation / "near me", implemented as *reverse-geocode → place id →
  existing radius search* — §8
- Map-based anchor selection
- Miles, as a display preference and never as a URL value
- Radius on other entities (Projects, Blogs) — the core is entity-agnostic

### OUT OF SCOPE

- PostGIS — §9.5
- Bulk external geocoding — §23.5
- Any change to the `SearchArea` identity model
- Any change to the existing platform presets — §19
- Facet counts ("Within 25 km (12)") — [06 §3](06-open-questions.md)
- Result-set caching — §22
- Changing what `includeOnline` means — §16 (flagged, deliberately not bundled)

---

## 28. Implementation plan

Every phase is independently mergeable and independently revertible. Phases 1–3
change **no user-visible behaviour**, which is the point of ordering them first.

### Phase 0 — Data audit *(0.5 day, no production code)*

- **New:** `scripts/report-location-coverage.ts`
- **Does:** counts locations without coordinates, locations without search
  areas, competitions without locations, search areas without coordinates.
- **Why first:** establishes the baseline §23 measured once, as a repeatable
  number, before anything changes.
- **Risk:** none. **Tests:** n/a. **Migration:** none.

### Phase 1 — Anchor coordinates *(1 day)*

- **Changed:** `prisma/schema.prisma` (2 nullable `Decimal(9,6)` columns on
  `PlaceResolution`); `place-resolution.repository.ts`;
  `place-match.service.ts` (`PlaceResolution` gains `anchor`; `writeCache`
  persists it; `readCache` treats a null-coordinate `RESOLVED` row as stale
  **only** when coordinates are requested).
- **Migration:** `add_place_resolution_coordinates` — additive, nullable, no
  backfill.
- **Why:** every later phase depends on it, and it ships safely on its own
  because nothing reads `anchor` yet.
- **Tests:** `verify-place-resolution.ts` — persisted, returned, field mask
  unchanged, stale-on-null-when-radius.
- **Risk:** low. **Rollback:** drop two unread columns.

### Phase 2 — Distance primitives *(0.5 day)*

- **New:** `src/modules/locations/utils/radius.ts` — `haversineKm`,
  `boundingBox`, `clampRadiusKm`. Pure: no database, no clock, no network,
  mirroring `extract-search-areas.ts`'s testability discipline.
- **New:** `scripts/verify-radius-math.ts`.
- **Risk:** none. **Migration:** none.

### Phase 3 — The candidate query *(1 day)*

- **Changed:** `src/modules/locations/repository/location.repository.ts` —
  `findIdsWithinRadius`, one `Prisma.sql` template, box + clamped Haversine +
  `LIMIT`, coordinate guards, id cap with an error log.
- **Changed:** `prisma/schema.prisma` — `@@index([latitude, longitude])` on
  `Location`.
- **Migration:** `add_location_coordinate_index`.
- **Tests:** DB-backed boundary cases; the SQL-is-fully-parameterised assertion.
- **Risk:** low — nothing calls it yet.

### Phase 4 — The search contract *(1 day)*

- **Changed:** `src/lib/search/spec.ts` — `PlaceValue.radiusKm?: number`; delete
  the "not read by any current code path" note from `PlaceRadiusConfig` and
  **correct the "toWhere would be untouched" claim** (§1 finding 1).
- **Changed:** `src/lib/search/spec-values.ts` — `readPlace`
  decodes/validates/clamps `radius`; `writeFilterValue` emits it;
  `describeFilterChips` adds the removable chip.
- **Changed:** `src/modules/competitions/search/ui.ts` — set `radius` on the
  location spec.
- **Free consequences:** `filterParams`, `clearAllFiltersPatch`,
  `capturePresetFilters`, `sanitizePresetFilters`, `activeFilterCount` and
  `defineSearch`'s duplicate-parameter check all become radius-aware with no
  edits.
- **Tests:** decode/encode/clamp/round-trip; preset capture and clear.
- **Risk:** low — the value is decoded but nothing builds a clause from it yet.

### Phase 5 — Query integration *(1 day)*

- **Changed:** `src/modules/competitions/search/location-filter.ts` —
  `ResolvedPlace` gains `radiusLocationIds?`; `resolvePlace` calls
  `findIdsWithinRadius` when `value.radiusKm && resolution.anchor`.
- **Changed:** `src/modules/competitions/search/location-clause.ts` — ORed arms
  (§12.2), `MATCHES_NOTHING` preserved.
- **Tests:** `verify-radius-search.ts` in full, including the §24
  byte-identical regression and the §15 `includeOnline` trap.
- **Risk:** **highest phase.** It is where the union-vs-replace decision (§12.3)
  becomes real and where a mistake changes existing results.

### Phase 6 — UI *(1 day)*

- **Changed:** `src/lib/search/react/controls/place-control.tsx` — segmented
  radius control, rendered only when a place is selected, carried over on place
  change.
- **Unchanged:** `competition-filters.tsx`, `search/layout.ts`,
  `filter-sheet.tsx`, `quick-filter-bar.tsx`, `active-filter-chips.tsx`. **If
  any of these needs to change, the design is wrong — treat it as a signal, not
  a task.**
- **Tests:** manual — desktop popover, mobile sheet, chips, back/forward,
  refresh, hand-edited URL.

### Phase 7 — Presets *(0.5 day, verification only)*

No production code expected. Assert §19's table. If any row needs code, the
`filterParams` seam did not hold and that is worth understanding before
proceeding.

### Phase 8 — Performance verification *(0.5 day)*

- `EXPLAIN ANALYZE` the radius query at 5 rows and against a generated 100 k-row
  fixture set. Confirm the index is used at scale. Record the numbers in this
  document.
- Confirm no N+1: exactly one radius query per request, resolved inside the
  plan.

### Phase 9 — Rollout *(0.5 day)*

- Ship with `steps: [5, 10, 25, 50]` initially; widening the list is a one-line
  data change.
- Watch: `LOCATION_RESOLUTION_FAILED` rate, `places:resolve` budget exhaustion,
  radius-query duration, id-cap-hit errors.
- Update `docs/architecture/domain/location.md` § Status, and **fix the two
  documentation drifts found in this audit** (§3.1 the suggest endpoint, §23.4
  the manual-entry self-area).

**Total: ~7.5 days**, of which ~4 are behaviourally inert.

---

## 29. File-level impact analysis

All paths relative to `next/`. Every path below was verified to exist.

### Definitely affected

| File | Change | Why |
| --- | --- | --- |
| `prisma/schema.prisma` | 2 columns on `PlaceResolution`; `@@index` on `Location` | Anchor storage + the box index |
| `prisma/migrations/*` | 2 new migrations | Generated |
| `src/lib/search/spec.ts` | `PlaceValue.radiusKm?`; correct the `PlaceRadiusConfig` note | The reserved seam, activated and its wrong claim fixed |
| `src/lib/search/spec-values.ts` | `readPlace`, `writeFilterValue`, `describeFilterChips` | One decoder — all validation lives here |
| `src/modules/competitions/search/ui.ts` | Set `location.radius` | Turns the feature on |
| `src/modules/competitions/search/location-filter.ts` | Resolve radius ids | The lookup |
| `src/modules/competitions/search/location-clause.ts` | ORed arms | The clause |
| `src/modules/locations/services/place-match.service.ts` | Return + cache the anchor | §23.3 |
| `src/modules/locations/repository/place-resolution.repository.ts` | Persist/read coordinates | Cache columns |
| `src/modules/locations/repository/location.repository.ts` | `findIdsWithinRadius` | **The only raw SQL** |
| `src/lib/search/react/controls/place-control.tsx` | Radius control | §20 |
| `src/modules/locations/utils/radius.ts` | **New** | Pure maths |
| `scripts/verify-radius-math.ts`, `scripts/verify-radius-search.ts`, `scripts/report-location-coverage.ts` | **New** | §26, §23.5 |

### Probably affected

| File | Why |
| --- | --- |
| `src/modules/locations/index.ts` | Barrel export for `radius.ts` |
| `src/lib/search/index.ts`, `client.ts` | Only if a new type needs re-exporting |
| `scripts/verify-place-resolution.ts` | Anchor persistence assertions |
| `scripts/verify-search-invariants.ts` | Byte-identical regression (§24) |
| `scripts/verify-competition-presets.ts` | Radius in captured presets |
| `docs/architecture/domain/location.md` | Status + the two drift corrections |
| `docs/project/feature-specification/search/06-open-questions.md` | §1 partially answered |

### Possibly affected

| File | Only if… |
| --- | --- |
| `src/modules/competitions/search/presets.ts` | …an "Around Pune" preset is added |
| `src/modules/competitions/backend/mapper.ts`, `types/dto.ts` | …the "N km away" annotation ships |
| `src/modules/locations/types/place.ts` | …the anchor gets a named type rather than an inline one |
| `src/app/(dashboard)/(competition)/competitions/page.tsx` | …empty-state copy should mention widening the radius |

### Should NOT need modification

| File | Why not — and what it means if it does |
| --- | --- |
| `src/lib/search/engine.ts` | Radius adds no composition rule. A change here means radius escaped the resolvable-filter seam. |
| `src/lib/search/resolve.ts` | The three-outcome protocol is sufficient as-is. |
| `src/lib/search/compose.ts`, `params.ts`, `pagination.ts`, `scope.ts`, `sort.ts`, `guards.ts`, `layout.ts`, `presets.ts`, `preset-storage.ts`, `bind.ts`, `filters/*` | Radius is a value on an existing filter. Any change here means it was modelled as something bigger than it is. |
| `src/modules/competitions/search/definition.ts` | No new registry entry — that is the design. |
| `src/modules/competitions/search/plan.ts` | Already resolves whatever the registry declares. |
| `src/modules/competitions/backend/{repository,service,controller,facade}.ts` | They consume a plan. Radius never reaches them as a concept. |
| `src/modules/competitions/components/discovery/competition-filters.tsx` | Its stated contract is that adding a filter does not change it. §20. |
| `src/modules/competitions/search/layout.ts` | Location is already placed. |
| `src/lib/search/react/{quick-filter-bar,filter-sheet,active-filter-chips,clear-all-filters-button,filter-popover}.tsx` | All registry-driven. |
| `src/modules/locations/providers/google.provider.ts` | Coordinates are **already** fetched and mapped. A change here would mean new billing. |
| `src/modules/locations/utils/extract-search-areas.ts` | Identity extraction is unrelated to distance, and `EXTRACTION_VERSION` must **not** be bumped (it would invalidate every cached resolution — §22). |
| `src/modules/competitions/backend/competition-location.service.ts` | Ingestion already stores coordinates. |
| `src/modules/locations/backend/{place,search-area}.controller.ts` | No new endpoint. |
| Any authorization file | Radius is not an authorization concern; scope guards are unchanged and still applied last. |

---

## 30. Architectural boundaries

```text
┌─ UI ─────────────────────────────────────────────────────────────┐
│ PlaceControl                                                     │
│   renders the stepper, writes PlaceValue.radiusKm                │
│   NO validation logic (the decoder owns it), NO distance maths   │
└──────────────────────────────┬───────────────────────────────────┘
                               │ ParamPatch
┌─ URL / search state ─────────▼───────────────────────────────────┐
│ params.ts        merge, canonicalise, reset page                 │
│ spec.ts          declares the parameter exists (PlaceRadiusConfig)│
└──────────────────────────────┬───────────────────────────────────┘
┌─ Spec values (CLIENT-SAFE) ──▼───────────────────────────────────┐
│ readPlace()   ★ PARSING, VALIDATION, CLAMPING — the ONLY place   │
│ writeFilterValue(), describeFilterChips()                        │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Resolvable filter ──────────▼───────────────────────────────────┐
│ competitionLocationFilter.resolve()                              │
│   ★ COORDINATE EXTRACTION (anchor from PlaceMatchService)        │
│   ★ CANDIDATE LOOKUP       (delegated to the repository)         │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Clause construction ────────▼───────────────────────────────────┐
│ buildLocationClause()   ★ QUERY CONSTRUCTION — pure, synchronous │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Engine ─────────────────────▼───────────────────────────────────┐
│ buildSearchQuery()  composeAnd(base, filters, guard) + sort/page │
│ ★ RESULT ORDERING — unchanged, no distance sort in V1            │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Repository ─────────────────▼───────────────────────────────────┐
│ LocationRepository.findIdsWithinRadius()  ★ THE ONLY RAW SQL     │
│ CompetitionRepository.findMany/count(plan)                       │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Database ───────────────────▼───────────────────────────────────┐
│ location(latitude, longitude) + btree index                      │
│ place_resolution(latitude, longitude)  ← anchor cache            │
└──────────────────────────────────────────────────────────────────┘
```

**Rules this enforces:**

- **No business logic in React.** `PlaceControl` writes a number. It does not
  clamp, validate, or compute anything — the decoder does, because the control
  is one of five writers (control, preset, hand-edited URL, shared link, API).
- **No search semantics in the Prisma schema.** The schema gains two nullable
  columns and one index. It learns nothing about radius, circles or discovery.
- **Raw SQL is confined to one function** with a typed signature at its
  boundary.
- **`buildSearchQuery` stays pure.** Every asynchronous step happens in
  `planCompetitionSearch`, once, before the query exists.

---

## 31. Risks

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | **Union vs replace is wrong for users.** Someone expects "within 25 km" to *exclude* a 90 km "Pune District" tag. | Medium | Medium | §12.3 states the choice explicitly and §32 raises it as an open decision. Reversible: it is one `buildLocationClause` branch. |
| 2 | **`includeOnline` regression.** Radius accidentally implemented as a separate clause. | Low (documented) | **High** — silent, user-visible wrongness | §15; asserted directly in `verify-radius-search.ts`. |
| 3 | **Anchor has no coordinates.** Google omits `location` for some place type. | Low | Medium | Radius arm omitted, area arm stands, UI says so. Never a wrong answer, only a missing widening. |
| 4 | **Cache migration re-bills.** Handled badly, all `place_resolution` rows re-resolve. | Medium | Medium | §22: stale-only-when-radius-requested, never an `EXTRACTION_VERSION` bump. |
| 5 | **Id list explosion** at future scale. | Low now | High later | `LIMIT` in SQL + `MAX_RADIUS_LOCATION_IDS` + an error log on cap hit. |
| 6 | **Raw SQL precedent.** The first `$queryRaw` in `src/` invites more. | Medium | Medium | Confine it to one documented function; state the rule in the file header, as `location-clause.ts` and `resolve.ts` already do for their own invariants. |
| 7 | **`Decimal` ↔ `float8` mismatch.** `Decimal(9,6)` in raw SQL. | Low | Medium | Explicit `::float8` casts; boundary tests at exactly 25.000 km. |
| 8 | **Data coverage undermines the feature.** 28 of 33 competitions have no location. | **High** | High | Not a code risk. Phase 0's coverage report makes it visible; it is an editorial/ingestion problem and should be owned as one. |
| 9 | **Distance sort demanded post-launch.** | Medium | Medium | §17 costs it honestly. Architecture C is the migration target. |
| 10 | **Production DB unverified.** Neon is commented out; extension availability unconfirmed. | Medium | Low for B (no extensions), **High for C** | B needs no extensions. Confirm before considering C. |
| 11 | **Two live doc drifts** (suggest endpoint, manual self-area) mean other docs may also be stale. | Confirmed | Medium | Fix both in Phase 9; treat `location.md` as needing a re-read against code. |

---

## 32. Open decisions

Ordered by how much they change the work.

1. **Union or replace?** (§12.3) — Should adding a radius be purely additive
   ("Pune, or within 25 km of Pune") or reinterpretive ("only within 25 km")?
   **Recommendation: union.** Replace also requires a coordinate backfill
   strategy, which §23.5 argues against.
2. **`maxKm`?** (§14) — 200 km proposed. 500 km would make "anywhere in
   Maharashtra" a radius question rather than an identity question.
3. **Radius step values?** (§14) — `[5, 10, 25, 50, 100, 200]` proposed. Pure
   data; costs nothing to change later.
4. **Is distance sort a launch requirement?** (§17) — If yes, V1 roughly doubles
   and Architecture C becomes preferable.
5. **Should `includeOnline` include `HYBRID`?** (§16) — Pre-existing question
   that radius makes more visible. Should be answered now, shipped separately.
6. **Should "In Pune" gain a radius?** (§19) — **Recommendation: no**; add a
   fourth preset instead, so existing preset links do not silently change.
7. **Why does the public place filter call Google?** (§3.1) —
   `PlaceSpec.suggestEndpoint` points at `/api/v1/places/autocomplete` while
   `/api/v1/search-areas` exists, is free, and is what `location.md` says should
   be used. Independent of radius, but it changes §21's abuse surface and §22's
   caching answer.
8. **Adopt Vitest?** (§26) — 4 153 lines of `verify-*.ts` scripts. 07 §8 already
   recommends a runner.
9. **What is the production database?** (§9.1) — Neon is commented out. Needed
   before any extension-based approach.
10. **Who owns location data coverage?** (§23) — 28 of 33 competitions have no
    location. This bounds the feature's value far more than any technical choice
    in this document.

---

## 33. Future evolution path

```text
V1  (this proposal)
    place anchor + radius, union semantics, box+Haversine over `location`
     │
     ├─▶ "N km away" on competition cards
     │     mapper-only; coordinates are already loaded via `locations` include
     │
     ├─▶ cube + earthdistance + GiST                      (at ~100 k locations)
     │     replaces the body of findIdsWithinRadius; signature unchanged;
     │     nothing above the repository knows
     │
     ├─▶ Distance sort                                    (needs product demand)
     │     parameterised SortRegistry + raw row query + MIN() aggregate
     │
     ├─▶ "Near me"
     │     reverse-geocode device position → place id → existing radius search
     │     (preserves identity, chips, sharing, and the MATCHES_NOTHING contract)
     │
     ├─▶ Map-based anchor
     │     same as "near me": the map picks a place id, not a bare coordinate
     │
     └─▶ Radius on Projects / Blogs
           `PlaceSpec` and `resolve.ts` are entity-agnostic; a second entity
           declares `radius` on its own place spec and reuses everything
```

**The invariant to hold across all of it:** the anchor is always a *place with an
identity*, never a bare coordinate. That is what keeps chips readable, links
shareable, presets stable, and the resolution cache useful — and it is the
single property that separates "radius search added to Kizunia's search" from "a
second, parallel nearby-search feature".

---

## Verification of this document

Every path referenced was checked to exist. Every schema claim was read from
`prisma/schema.prisma`. Every row count, extension availability, index
definition and coordinate-coverage figure comes from a live read-only query
against the configured `DATABASE_URL` on 2026-09-03; no data was written and no
production code was modified.

Three claims in existing documentation were found not to match the code and are
recorded as findings rather than repeated as fact: the public place-suggest
endpoint (§3.1), the manual-entry self-area (§23.4), and `PlaceRadiusConfig`'s
"toWhere would be untouched" (§1, §12).
