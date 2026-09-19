# Open Questions

Design areas deliberately left unresolved. Each records what is known, what
the constraints are, and what input is needed — so the eventual discussion
starts from evidence rather than a blank page.

None of these block Phases 0–3.

---

## 1. Location and geography

**Status: awaiting product input. A separate discussion is planned.**

### Where it stands today

`Competition.location` is a single nullable free-text `String`. The filter
is `{ location: { contains: value, mode: "insensitive" } }`. There is no
`Place`, `City`, or geo model anywhere in the schema, and no coordinates.

That means today's behaviour is a substring match on whatever an admin or
contributor typed. `"Pune"` matches `"Pune, Maharashtra"` and
`"MIT Pune Campus"` — but also fails to match `"Puné"`, and cannot express
"within 50 km of Pune", "anywhere in Maharashtra", or "online or near me".

`CompetitionMode` (`ONLINE` / `OFFLINE` / `HYBRID`) is separate from
location and already carries part of the semantics users actually mean when
they think "where."

### Why this is not a filter question

Location is the one dimension where the *data model*, not the filter layer,
is the constraint. No amount of filter architecture makes free text
geographically queryable. Any real location feature requires a schema
decision first — which is exactly why the core treats `location` as an
ordinary `textContainsFilter` for now and leaves the seam open.

### Options, roughly ordered by cost

| Option | Enables | Cost |
| --- | --- | --- |
| Keep free text, add normalization on write | Fewer near-miss mismatches | Very low |
| Structured fields (`city`, `state`, `country`) | Faceted region filtering, canonical picklists | Low–medium; backfill needed |
| Normalized `Place` entity with a relation | Canonical names, aliases, hierarchy, "anywhere in X" | Medium; a real taxonomy to curate |
| `Place` + lat/lng | Radius search, "near me", distance sort | Medium–high; needs PostGIS or manual haversine |
| External geocoding provider | Autocomplete, resolution of user-typed places | High; third-party dependency and cost |

### What the core would need

- A `geo-radius` filter kind (`{ lat, lng, radiusKm }`) compiling to either
  a PostGIS predicate or a bounding-box pre-filter plus exact distance.
  Prisma cannot express this natively, so it would use `$queryRaw` behind
  the same `FilterDescriptor` interface — the abstraction holds, but this is
  the one primitive that escapes Prisma's type-safe query builder.
- Distance as a sort option, which is the first sort whose `orderBy` depends
  on a *parameter* rather than being static. `SortRegistry` would need to
  admit parameterised sorts.

Both are additive. Neither should be built speculatively.

### Questions to answer in that discussion

1. Is location primarily a **filter** ("show me things in Pune") or a
   **ranking** signal ("prefer things near me")? These have very different
   costs.
2. Is "near me" — requiring the user's coordinates and a permission prompt —
   actually wanted, or is city/region selection enough?
3. Should `ONLINE` competitions always match a location filter, never match,
   or be a separate user choice? This is a genuine product decision that
   affects result counts more than any other single rule.
4. Is the location taxonomy India-first, or international from the start?
5. Who curates canonical places — admins, the suggestion workflow, or a
   geocoding provider?

---

## 2. Full-text search

Today: `contains` over `title` and `organizer` for Competitions, `title` and
`shortDescription` for Projects. `contains` cannot rank by relevance, does
not stem, and degrades on large tables without a trigram index.

Notably, the Blog domain specification explicitly says search should
"prioritize metadata rather than parsing the entire Markdown document" — so
the highest-volume text in the system is deliberately **out of scope** for
search, which removes the usual reason to reach for a search engine.

Recommendation: stay with `contains` until there is evidence of a problem,
then move to Postgres `pg_trgm` / `tsvector` before considering an external
engine. `multiFieldTextFilter` is the single swap point.

Triggers to revisit: result sets where relevance ordering matters more than
recency, noticeable latency on the text predicate, or a product requirement
for body/content search.

---

## 3. Facet counts

Showing "Online (12)" next to each option materially improves filter UX —
it prevents users selecting combinations that return nothing.

Cost: one grouped-count query per faceted filter per request, each needing
the *other* filters applied but not its own. This is why facets are
expensive and why they are deferred rather than assumed.

Open: whether to compute facets for quick filters only, cache them, or
compute them lazily when a filter popover opens. The last is probably the
best cost/benefit and needs no caching layer.

---

## 4. Organizer normalization

`Competition.organizer` is free text with no `Organizer` model, so organizer
filtering can only ever be fuzzy. If "browse by organizer" or organizer
credibility signals (mentioned in the brief's §17 as something users care
about) become product goals, this needs a model — closely analogous to the
location question and probably worth deciding at the same time.

---

## 5. Sort null placement

`startDate` and `registrationDeadline` are nullable. A competition with no
start date should almost certainly sort **last** under "starting soonest,"
not first. This needs one explicit decision per nullable sort column, and
should be settled during Phase 1 rather than inherited from database
defaults.

---

## 6. Quick-filter set

Phase 2 proposes `modes`, `categories`, `technologies`, `location`,
`difficultyLevels`, `registrationFeeTypes`. The brief mentions user research
in progress; that research should override this default. The registry makes
re-grouping a one-line change per filter, so this is explicitly a
low-cost decision to revise — it does not need to be right first time.

---

## 7. Saved-search semantics (Phase 7)

Deferred, but two questions will need answers and are cheap to note now:

- Does a saved search store the parameters *as written*, or normalized? If a
  filter is later removed from the registry, does the saved search fail
  loudly or silently drop it?
- Are saved searches private, or shareable/public as curated collections
  ("Best beginner hackathons")? The latter is a meaningfully different
  feature with moderation implications.
