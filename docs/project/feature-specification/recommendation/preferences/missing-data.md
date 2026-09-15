# Missing Competition Data

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-03](../decisions/README.md#rd-03)

Missing competition data is treated as a **mismatch** for the affected
dimension, matching the existing notification decisions
(`ND-R-05`/`ND-R-06`, cited in
[`../../../architecture/notifications/recommendation/scoring-strategy.md`](../../../architecture/notifications/recommendation/scoring-strategy.md)).

## Worked example

```text
User preference: registrationFeeType = Free, weight 0.8   (soft)

Competition A: registrationFeeType = FREE      -> MATCH
Competition B: registrationFeeType = PAID      -> MISMATCH
Competition C: registrationFeeType = null      -> MISMATCH (missing data)
```

## Soft vs hard

| Regime | On mismatch or missing data |
| --- | --- |
| Soft (`0 < weight < 1`) | Lowers relevance. The candidate survives to be shown, just scored lower. |
| Hard (`weight = 1`) | The candidate is excluded — a hard preference that cannot be verified is treated the same as one that is verified false. |

So `registrationFeeType = Free, weight 1.0` means: `PAID` is rejected, and
so is `null` — an unknown fee type is not given the benefit of the doubt.

## One documented exception: team size

Team size (`minTeamSize`/`maxTeamSize`) is the one dimension where "no data"
has an established domain meaning that is not "unknown" — a competition
with no team-size bounds at all has already been defined, by the existing
search filter (`buildTeamSizeClause`), as accepting any team size. Phase 0
reuses that meaning rather than inventing a different one for
recommendations: an unconstrained competition is a **match**, not a
missing-data mismatch. See
[`../../../architecture/recommendation/dimensions.md`](../../../architecture/recommendation/dimensions.md)
for the full reasoning.

## Phase 0's simplification: `MISSING` and `MISMATCH` score identically

Whether a missing value should be penalized less harshly than a value that
is known and simply different is recorded as open in the existing
notification decisions (`ND-R-07`). Phase 0 does not resolve that; both
outcomes contribute `0` to the score. This is documented as a first-version
choice, not a permanent one — see
[`../../../architecture/recommendation/scoring-strategy.md`](../../../architecture/recommendation/scoring-strategy.md).
