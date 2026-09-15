# Location Matching — Phase 0

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-06](../decisions/README.md#rd-06)

Location is intentionally simple in Phase 0:

```text
user location preference -> competition location -> match / mismatch
```

**No distance calculation. No radius. No kilometers.** A competition either
matches the user's preferred location(s) or it does not.

## What "match" means, precisely

Kizunia's location domain already materializes containment at ingestion —
see
[`../../../architecture/domain/location.md`](../../../architecture/domain/location.md).
A competition's location carries an explicit link to every `SearchArea`
that contains it (city, then state, then country, as resolved), computed
once when the location is created, never re-derived at query time.

Phase 0 reuses exactly this. A user's location preference value is a
`SearchArea` — the same kind of value the explicit search feature's
location filter already uses. A competition **matches** if any of its
locations carries a link to that `SearchArea`.

```text
User prefers: Pune (a SearchArea)

Competition A, located in Pune           -> MATCH
Competition B, located in Bangalore      -> MISMATCH
Competition C, with no location on file  -> MISMATCH (missing data)
```

Because containment is already downward-only in the underlying data — a
Pune address's row points at "Pune" and at "Maharashtra" and at "India" if
those were resolved, never the reverse — preferring the broader
"Maharashtra" area matches a Pune-only competition, but preferring "Pune"
specifically does not match a competition that only resolved to
"Maharashtra". This is exactly the existing decision that search expands
downward, never upward, and Phase 0 gets it for free by reusing the same
data rather than reimplementing hierarchy logic.

## Why no distance calculation

Explicitly out of scope for Phase 0 — see
[`../non-goals.md`](../non-goals.md). The candidate shape the engine
operates on does not carry coordinates at all, so distance is not merely
unimplemented, it is structurally absent. Adding it later means adding
coordinate fields to that shape and either extending this dimension or
adding a new one — not rewriting the pipeline.

## Relationship to Search

Search and Notifications/Recommendations both consume the same location
domain and must agree on what "in Pune" means — see
[`../../../architecture/notifications/module-boundaries.md`](../../../architecture/notifications/module-boundaries.md).
Phase 0 keeps that agreement by reusing the identical `SearchArea`
containment model rather than introducing a parallel one.
