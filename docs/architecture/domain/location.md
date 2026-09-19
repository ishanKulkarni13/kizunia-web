# Location

> **Status:** In Progress — SearchArea discovery implemented; radius search implemented (place or device centre, distance-only, 200 km ceiling); distance sorting not started
>
> **Version:** 2.0
>
> **Referenced By:** Competitions, Search
>
> **Last Updated:** 2026-09-02

---

# Purpose

This document is the reference for **competition location and geographic
discovery**: the problem it solves, how places are modelled, where it lives in
the codebase, what is done versus what remains, the trade-offs taken, and how it
connects to competition search.

It exists so anyone (including a future session) can re-enter this area without
re-deriving the design.

---

# Problem

A competition happens at *one* place, but users look for it through *many*.

A competition at Vishwakarma Institute of Technology should be findable by
searching *VIT Pune*, *Bibwewadi*, *Pune*, *Maharashtra*, or *India*. No fixed
column set expresses that — and adding columns for neighbourhood, ward, borough,
district, prefecture is an endless, country-specific losing game.

So a location has two distinct responsibilities, and v1 conflated them:

1. **Where the competition actually is.**
2. **Which places it should be discoverable through.**

Version 2.0 splits them.

---

# Architecture

```text
Competition ─< CompetitionLocation >─ Location ─< LocationSearchArea >─ SearchArea
                                     (owned,              (EXACT |        (shared,
                                    never shared)          WITHIN)      deduplicated)
```

| Model | Answers | Sharing |
| --- | --- | --- |
| `Location` | Where is this competition? | Competition-owned, never deduplicated |
| `SearchArea` | Which entity can it be found through? | Globally reused, deduplicated by `identityKey` |
| `LocationSearchArea` | Is this location inside that entity? | The verified link, `EXACT` or `WITHIN` |

## Two governing rules

1. **A SearchArea is stored only where there is a concrete reason to allow
   discovery through that place.** Provider data is evidence, not an instruction
   to store. Kizunia is not a mirror of Google Maps.
2. **A SearchArea is a geographic entity, never a name.** "Nashik City" and
   "Nashik District" share a word but have different boundaries and different
   search semantics. Identity comes from provider identity, never display name.

---

# Why expansion is downward-only

**Containment is materialized at ingestion, never traversed at query time.**
Each location stores an explicit link to every entity that contains it.
Searching a parent works because the children already point at it — the query
never walks a hierarchy, never recurses, and therefore *cannot* widen upward or
sideways.

This is also what keeps search compatible with the pure, synchronous search
engine, which cannot perform database lookups inside a filter.

Given a Yeola competition linked to `Yeola(EXACT), Nashik District, Maharashtra,
India`, and a Nashik City competition linked to `Nashik City(EXACT), Nashik
District, Maharashtra, India`:

| User selects | VIT Pune comp. | Yeola comp. | Nashik City comp. |
| --- | --- | --- | --- |
| Bibwewadi | ✅ | ❌ | ❌ |
| Pune | ✅ WITHIN | ❌ | ❌ |
| Yeola | ❌ | ✅ EXACT | ❌ |
| **Nashik City** | ❌ | ❌ ← required | ✅ EXACT |
| **Nashik District** | ❌ | ✅ WITHIN | ✅ WITHIN |
| Maharashtra | ❌ | ✅ | ✅ |

The Yeola competition never surfaces under Nashik City because no such link is
ever created. It surfaces under Nashik District only because provider data
verified that containment.

**The filter ignores `relation`.** `EXACT` and `WITHIN` both match — selecting
"VIT Pune" and selecting "Pune" should each find the competition at VIT Pune.
The distinction is kept to explain *why* something matched.

---

# Identity

Identity correctness *is* search correctness here, so it is ranked:

1. **Provider place id** → `google:place:{placeId}`. Distinct entities have
   distinct ids, so Nashik City and Nashik District separate without Kizunia
   needing to know what a district is. Always preferred.
2. **Contextual fallback** → `component:{providerKind}:{name}:{parent context}`,
   e.g. `component:administrative_area_level_2:nashik:maharashtra:india` versus
   `component:locality:nashik:maharashtra:india`. Including the provider's raw
   type is what keeps district and city apart when no place id exists; the
   parent context keeps the many places called "Indira Nagar" apart.

Names are normalized (lowercase, diacritics stripped, non-alphanumerics → `-`)
for identity only. Display names are stored verbatim.

**Address components rank lowest precisely because they lack stable identity.**
That is why containing places and address descriptors, which carry place ids,
are preferred sources.

## `providerKind`, not a Kizunia enum

`SearchArea.providerKind` stores the provider's own type string (`locality`,
`administrative_area_level_2`, `university`) **verbatim, for display and
disambiguation only. Nothing branches on it.**

An earlier draft used a `SearchAreaKind { COUNTRY STATE CITY AREA PLACE }` enum.
That was wrong twice: it encoded one country's administrative hierarchy as
universal, and it could not represent "Nashik District" and "Nashik City" as
different kinds at all.

---

# Two place-search surfaces

Conflating these would be a design error.

| | Admin ingestion | Public filtering |
| --- | --- | --- |
| Endpoint | `/api/v1/locations/autocomplete` | `/api/v1/search-areas` |
| Source | Google Places | Kizunia's own `SearchArea` rows |
| Auth | Required | Public |
| Cost | Billed per session | Free |
| Creates SearchAreas? | Yes | **Never** |

Public filtering must not call Google. A place no competition is linked to could
only return zero results, so it should not be offerable at all. Because several
entities can share a name, the filter typeahead renders `contextLabel` and
`providerKind` alongside the name — without them the user cannot make the choice
the architecture requires of them.

---

# Implementation map

Paths relative to `next/`.

## Schema

`prisma/schema.prisma` — `Location`, `CompetitionLocation`, `SearchArea`,
`LocationSearchArea`; enums `LocationPrecision`, `LocationProvider`
(`MANUAL | GOOGLE`), `SearchAreaRelation`, `SearchAreaSource`.

Migrations: `20260830153816_add_competition_location`,
`20260902205244_add_search_area`.

## `locations` module

```
src/modules/locations/
├── types/place.ts                    PlaceProvider, PlaceDetails, SearchAreaCandidate
├── types/location.dto.ts, search-area.dto.ts
├── utils/identity.ts                 identityKey construction, name normalization
├── utils/extract-search-areas.ts     PURE: PlaceDetails -> SearchAreaCandidate[]
├── utils/normalize.ts                location normalization, placeDetailsToLocationInput
├── providers/google.provider.ts      Places Autocomplete + Place Details
├── providers/index.ts                resolvePlaceProvider(), env-driven, may return null
├── repository/location.repository.ts, search-area.repository.ts
├── services/location.service.ts, search-area.service.ts
├── backend/controller.ts             admin place autocomplete
├── backend/search-area.controller.ts public typeahead
└── api/location-api.ts               browser client for both
```

`extract-search-areas.ts` is the testable core: no database, no network, no
clock. Everything about which competitions surface for which place is decided
there.

## Competition side

`backend/competition-location.{repository,service,mapper}.ts`,
`schemas/competition-location.ts`, `search/definition.ts` (the `locationFilter`),
plus the `[id]/locations` routes and the admin `locations-tab` / `location-picker`.

---

# Extraction rules

Sources, strongest first — the same entity from several sources collapses to one
candidate keeping the strongest:

1. `SELECTED_PLACE` → `EXACT`
2. `CONTAINING_PLACE` → `WITHIN` *(carries place ids)*
3. `ADDRESS_DESCRIPTOR`, `WITHIN` only → `WITHIN`
4. `ADDRESS_COMPONENT`, allowlist only → `WITHIN` *(last resort, no stable id)*

Allowlist: country, administrative areas 1–3, locality, postal_town,
sublocality, neighborhood.
**Rejected:** route, street number, postal code, floor/unit, and any `NEAR` or
`OUTSKIRTS` relation. `NEAR ≠ WITHIN` — proximity belongs to radius search.

**No relationship is ever created from a shared or similar name.** Every link
traces to explicit provider evidence about that specific entity.

## Accepted incompleteness

If the provider does not surface a containing entity, no link is created and the
competition is not discoverable through it. "Correct but incomplete" beats
"incorrect geographic expansion." A later enrichment pass can add verified links
with no schema change.

---

# Ingestion

`CreateCompetitionLocationSchema` accepts exactly one of:

- **`providerPlaceId`** — the server resolves it, normalizes into a `Location`,
  extracts candidates, and links SearchAreas.
- **`location`** — manual entry. Creates the `Location` plus a single `EXACT`
  self-area with a contextual identity key.

Manual entry is what preserves resilience now that Google is the only provider.
If Google is unreachable an admin can still save; discovery is narrower (findable
by its own name, not through a wider region) but **editing is never blocked** —
which was always the actual guarantee.

Replacing a location's place also **re-derives** its search areas, so a location
moved from Pune to Mumbai stops being discoverable through Pune.

---

# Search integration

`search/definition.ts` declares one `locationFilter` owning two URL keys:

| Key | Meaning |
| --- | --- |
| `searchAreas` | Comma-separated SearchArea ids. Multiple values OR together. |
| `includeOnline` | Opt-in: also return `ONLINE` competitions. |

Both keys live on one filter because the engine AND-composes separate filters,
while `includeOnline` must **OR** with the location clause.

```ts
// searchAreas only
{ locations: { some: { location: { searchAreas: { some: { searchAreaId: { in: ids } } } } } } }

// searchAreas + includeOnline=true
{ OR: [ <above>, { mode: "ONLINE" } ] }

// includeOnline alone -> contributes nothing
```

Online competitions have no location and so can never satisfy a geographic
clause; including them is an explicit user choice rather than something the
location filter decides for them.

Ids are resolved *before* the request reaches the filter, which is required:
`buildSearchQuery` is synchronous and pure, so a filter cannot query the
database.

---

# Status

## Done

- [x] `SearchArea` / `LocationSearchArea` schema, enums, migration
- [x] Deterministic `identityKey` with provider-id and contextual strategies
- [x] Pure candidate extraction with source priority, dedup, and allowlisting
- [x] Google Places provider (autocomplete + details), session-token aware
- [x] Ingestion for both selected-place and manual paths, transactional
- [x] Search cut over to SearchArea id matching, with `includeOnline`
- [x] Public SearchArea typeahead (internal rows, no provider call)
- [x] Nominatim dropped; `LocationProvider` is now `MANUAL | GOOGLE`
- [x] Seed data routed through the manual path so dev data is discoverable
- [x] Verified: 32-case pure harness (fixtures + filter clauses), `tsc`, `eslint`, `next build`

## Remaining

- [ ] **Public filter UI** — the backend accepts `searchAreas`/`includeOnline`,
      but nothing in the competitions search page renders the control yet.
      This is Phase 2 of the search plan.
- [ ] **Manual browser walkthrough** with a real `GOOGLE_MAPS_API_KEY` — the
      Google provider has been verified against fixtures, not the live API.
- [x] **Radius / "near me"** — built. Not as a `geo-radius` filter kind, but as
      a modifier on the existing `place` filter: a radius has exactly one centre,
      so it can never be an independent registry entry. The centre is either a
      provider place (anchor read from `place_resolution`, which now stores the
      coordinates Google was already returning) or the device's own position,
      carried as bare `lat`/`lng` and never reverse geocoded or persisted.
      The predicate is a Prisma bounding box intersected with a SQL
      corner-exclusion list, so filtering, sorting, counting and pagination all
      stay in the database and nothing is capped. When a radius is set it
      **replaces** SearchArea matching rather than widening it — see
      `search/08-radius-search-research.md` § Amendment.
- [ ] **Distance sorting ("nearest first")** — still not started. `SortRegistry`
      holds a static `orderBy` per option and cannot be parameterised by a
      request value, and "distance to a competition" is a `MIN()` over its
      locations that Prisma cannot express. Would require a raw row query.
- [ ] **Enrichment pass** to add containment a provider did not return first time.
- [ ] No automated test framework in the repo; verification harnesses are
      temporary scripts.
- [ ] `Location.timezone` exists but nothing populates it.

---

# Trade-offs

## Benefits

- Discovery matches how people actually search — one competition, many entry points.
- Entity-level correctness: same-named places never merge, and a competition
  never surfaces somewhere it is not.
- Search is one indexed join, with no hierarchy traversal and no recursion.
- SearchAreas are shared, so "everything in Pune" gets cheaper as data grows,
  while Locations stay competition-owned and independently editable.
- Provider-swappable: `PlaceProvider` is an interface; extraction consumes a
  neutral `PlaceDetails`.

## Costs

- **Discovery is only as complete as provider evidence.** Address Descriptors
  have limited regional availability (India is covered); without them extraction
  degrades to address components — correct, but fewer paths.
- **Google is billed** per autocomplete session and details call, and is now the
  only provider. Manual entry remains the free/offline path.
- **Component-derived areas have weaker identity** than place-id-backed ones.
  Mitigated by including the provider type in the key, not eliminated.
- **Ingestion is heavier**: one resolve call plus several upserts per location,
  versus a single insert previously.
- **No proximity search yet.** Coordinates are stored on both `Location` and
  `SearchArea`, so the data is ready, but nothing queries by distance.

---

# Configuration

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Server-only. Never expose as `NEXT_PUBLIC_`. |
| `GOOGLE_PLACES_BASE_URL` | Override to point at a stub during testing. |

Leaving these unset is supported: autocomplete returns
`providerAvailable: false`, the picker offers manual entry, and competitions
save normally.

---

# Guiding principle

> **Store the actual place accurately, record only the places it can genuinely be
> discovered through, and never invent a geographic relationship.**

The goal is not a complete model of world geography. It is a discovery model
that is never wrong about where a competition is.
