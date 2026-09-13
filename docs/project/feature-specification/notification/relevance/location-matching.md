# Location Matching

> **Status:** Stable — algorithm open
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-P-10](../decisions/preferences.md#nd-p-10--location-expands-downward-never-upward),
> [ND-P-11](../decisions/preferences.md#nd-p-11--location-may-temporarily-be-a-hard-constraint)

Location is the one preference field whose matching is not a simple value comparison. Geography is
hierarchical, and containment has a direction.

---

## The rule

> **Search expands downward geographically, never upward.**

Given a user preference of `Pune → 0.8`:

| Competition location | Relationship to preference | Result |
| --- | --- | --- |
| Pune | Exact | Strong geographic match |
| A locality contained **within** Pune | Narrower | Matches the Pune preference |
| Maharashtra, which **contains** Pune | Broader | Very low likelihood of selection |
| Mumbai | Unrelated | No geographic match |

A competition in a location contained within Pune should match the Pune preference. A competition
whose location is only known at a broader level is **not** an equivalent Pune match and must not be
treated as one.

---

## Why direction matters

A user who says "Pune" is telling Kizunia where they can physically go. Everything inside Pune
satisfies that; a state-level listing does not, because most of Maharashtra is unreachable for
them.

Treating containment as symmetric would flood city-preferring users with events they cannot attend,
and would do so *confidently* — the competition would score as a strong match. That is worse than a
missing match, because it teaches the user the recommendations are unreliable.

---

## Weighted location and its cost

The product model conceptually supports weighted location, like every other preference field:

```text
Location -> 0 to 1
```

However, hierarchical weighted geographic matching may introduce significant backend and query
cost. Resolving containment relationships at scoring time, across a hierarchy, for every candidate
and every user, is not a cheap query.

**Concession permitted.** If the initial implementation finds weighted hierarchical matching
prohibitive, location may temporarily operate as a **hard constraint**:

```text
Location -> 1
```

while preserving the model's ability to support weighted location later.

**Constraint on that concession.** This is an implementation decision to be evaluated separately.
The product model must not unnecessarily prevent future weighted location support. A storage or
API shape that can only express "location is required" would violate this.

---

## What is open

The exact location-matching algorithm is an open decision — see
[`open-decisions.md`](../open-decisions.md). Specifically undecided:

- how containment is resolved (precomputed hierarchy, geometry, search areas, or a hybrid);
- how much a narrower-than-preference match is discounted, if at all;
- how a broader-than-preference match is scored, given it must be possible but very unlikely to be
  selected;
- whether distance, rather than containment, ever participates.

### Existing work to build on

The repository already models location with real structure rather than free text:

- `Location`, `SearchArea` and `LocationSearchArea` in the Prisma schema, with an explicit
  `LocationPrecision` and a `SearchAreaRelation`;
- [`domain/location.md`](../../../../architecture/domain/location.md) for the domain model;
- the Search subsystem's [radius search research](../../search/08-radius-search-research.md),
  which audits the live location architecture and compares geospatial approaches for competitions.

Location matching for notifications should reuse that foundation rather than introducing a parallel
geographic model. Whatever is decided for search radius and whatever is decided here must agree on
what "in Pune" means.

---

## Interaction with missing data

A competition with no location at all behaves like any other missing value:

- under a soft location preference, it is not a match but remains recommendable;
- under a hard location constraint — including the temporary hard-constraint mode described above —
  it is excluded.

See [missing-data.md](missing-data.md).
