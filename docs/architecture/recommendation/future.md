# Future Work

> **Status:** Direction only — none of this is implemented
>
> **Last Updated:** 2026-09-15

Nothing here may be presented as current behavior or implemented because
"the architecture supports it" — matching the convention already
established in the notification spec's own `future/` tree.

## Temporal dimensions

Reintroduce `startDate`/`endDate`/`registrationDeadline`/`registrationStartDate`
as scored dimensions (removed from Phase 0 by explicit product direction —
see `dimensions.md` and RD-06). Needs: a `now` parameter threaded back
through the pipeline (deliberately removed in Phase 0 — see
[`pipeline.md`](pipeline.md)), and a chosen encoding — an earlier draft
considered day-bucket preference values ("starts within 30 days") but this
was never implemented or validated.

## Real, persisted preference profiles

Replace `DummyPreferenceProfileProvider` with an adapter backed by a real
model, once open decision A-2 (in the notification spec) is resolved. The
`PreferenceProfileProvider` port already exists for this.

## Timestamp-aware candidate selection

Phase 0's candidate selection reads `Competition.status` only (RD-09). The
sweep-lag concern the existing notification spec raises is real; Phase 1's
scheduled evaluation should reason from timestamps as that spec recommends.

## `competitionType`

Not implemented because it does not exist in the current domain. Once a
product decision defines the type taxonomy and it lands in the schema, add
it the same way any other list-valued dimension is added — see
`extensibility.md`.

## `registrationFee` as a numeric dimension

Requires a domain decision: a currency, a numeric range, and a migration
away from (or a parser for) the current free-text field.

## Location distance/radius scoring

Explicitly out of scope for Phase 0 (product decision, not a limitation of
convenience). Would require adding coordinates to `RecommendationCandidate`
and either extending the location dimension or adding a new one.

## Batching, precomputation, caching

The cost problem the existing notification spec raises for a daily,
all-users evaluation (`docs/architecture/notifications/recommendation/candidate-selection.md`)
is unaddressed here. `CandidateService` is the seam where any of these
would be introduced — see [`pipeline.md`](pipeline.md).

## ML relevance

A learned relevance signal, combined with or replacing the deterministic
`WeightedCoverageScorer`. The `ScoringStrategy` interface already isolates
this; no ML provider dependency exists anywhere in Phase 0.

## Multi-user / clustering

Similar-user recommendations, clustering, or any cross-user signal. Phase 0
evaluates exactly one user at a time, by design.
