# Locations Module

## Purpose

Real-world places, and the geographic entities competitions are discovered
through.

Two models with different jobs:

- **`Location`** — where a competition actually is. Competition-owned, never
  deduplicated, so editing one competition's venue can never rewrite another's.
- **`SearchArea`** — a specific geographic entity a user can select as a search
  boundary. Globally reused and deduplicated by `identityKey`.

`LocationSearchArea` links them with `EXACT` or `WITHIN`. `CompetitionLocation`
lives in the competitions module, because label/venue/dates describe *usage*
rather than geography.

## Folder Structure

```
locations/
├── README.md
├── index.ts
├── api/
│   └── location-api.ts               ← browser client (autocomplete + typeahead)
├── backend/
│   ├── controller.ts                 ← admin place autocomplete (billed)
│   └── search-area.controller.ts     ← public typeahead (free, internal rows)
├── providers/
│   ├── index.ts                      ← resolvePlaceProvider(), may return null
│   └── google.provider.ts            ← Places Autocomplete + Place Details
├── repository/
│   ├── location.repository.ts
│   └── search-area.repository.ts
├── schemas/
│   ├── location-input.ts
│   └── location-search.ts
├── services/
│   ├── location.service.ts
│   └── search-area.service.ts        ← the only place SearchAreas are created
├── types/
│   ├── location.dto.ts
│   ├── search-area.dto.ts
│   └── place.ts                      ← PlaceProvider interface, PlaceDetails
└── utils/
    ├── identity.ts                   ← identityKey construction
    ├── extract-search-areas.ts       ← PURE: PlaceDetails → candidates
    └── normalize.ts
```

## Design rules

**A SearchArea is an entity, never a name.** "Nashik City" and "Nashik District"
share a word but have different boundaries. Identity comes from the provider's
place id where one exists, and from `{providerKind}:{name}:{parent context}`
where it does not — never from the display name alone.

**Nothing is inferred.** A link is created only where the provider gave explicit
evidence about that specific entity. A competition in Yeola gains Nashik District
if the provider says so, and never gains Nashik City. `NEAR` and `OUTSKIRTS` are
proximity, not containment, and are discarded.

**Containment is materialized at ingestion, never traversed at query time.**
That is what makes parent searches reach their children while making upward or
sideways expansion impossible — and it is required, because the search engine is
synchronous and pure and cannot query from inside a filter.

**Search never creates SearchAreas.** Only ingestion does. A place nothing is
linked to could only return zero results, so it should not be offerable at all.

**The provider is optional.** `resolvePlaceProvider()` returning `null` is
supported: manual entry still saves normally, yielding a single self-area.
Discovery is narrower; editing is never blocked.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Server-only. Never expose as `NEXT_PUBLIC_`. |
| `GOOGLE_PLACES_BASE_URL` | Override to point at a stub during testing. |

Leaving these unset is a valid configuration.

## Public API

```ts
import { ... } from "@/modules/locations";
```

Other modules should **never** import internal files directly.
