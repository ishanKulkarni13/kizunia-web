# Recommendation Decisions

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

Rulings made during Phase 0, using the `RD-<nn>` prefix (Recommendation
Decision), following the same "amend, do not silently rewrite" convention
as the notification spec's `ND-*`/`R-*` rulings — see
[`../../notification/decisions/README.md`](../../notification/decisions/README.md).

## RD-01 — Weight semantics reuse the notification spec's, unchanged

Phase 0 does not redefine no-preference/soft/hard semantics; it implements
the ones already specified in
[`../../notification/preferences/weights-and-constraints.md`](../../notification/preferences/weights-and-constraints.md).
See [`../preferences/weights-and-constraints.md`](../preferences/weights-and-constraints.md).

## RD-02 — Multi-value aggregation: best match, relative to the user's own max

For multiple values in one soft dimension, a candidate's strength is the
best-matching value's weight divided by the dimension's strongest expressed
weight. See [`../preferences/multiple-values.md`](../preferences/multiple-values.md).

## RD-03 — `MISSING` and `MISMATCH` score identically in Phase 0

Both contribute `0` to a dimension's match strength. The relative severity
between them is recorded as open in the notification spec (`ND-R-07`) and
is not resolved here. See [`../preferences/missing-data.md`](../preferences/missing-data.md).

## RD-04 — Phase 0 preference source is a hardcoded dummy profile

Not `User.interests` (which is being removed from the domain), not
portfolio data, not `NotificationPreference`. See
[`../preferences/phase-0-dummy-profile.md`](../preferences/phase-0-dummy-profile.md).

## RD-05 — Thirteen dimensions implemented; two requested dimensions deferred

`registrationFee` (no numeric domain) and `competitionType` (does not
exist) are documented as unavailable rather than invented. See
[`../relevance/dimensions.md`](../relevance/dimensions.md).

*Update:* `competitionType` was added as a fourteenth dimension once
`CompetitionType`/`CompetitionTypeRelation` existed in the schema.
`registrationFee` remains deferred for the reason stated above.

## RD-06 — Temporal dimensions removed from Phase 0

`startDate`/`endDate`/`registrationDeadline`/`registrationStartDate` are
not scored dimensions in Phase 0, by explicit product direction. They
remain available as ranking tiebreakers. See
[`../relevance/dimensions.md`](../relevance/dimensions.md) and
[`../../../architecture/recommendation/future.md`](../../../architecture/recommendation/future.md).

## RD-07 — Default scoring strategy: weighted coverage of active dimensions

See [`../../../architecture/recommendation/scoring-strategy.md`](../../../architecture/recommendation/scoring-strategy.md)
for the formula and full rationale.

## RD-08 — Default threshold is 0.5; never relaxed to fill Top-N

See [`../relevance/threshold-and-selection.md`](../relevance/threshold-and-selection.md).

## RD-09 — Candidate selection reads `Competition.status` only in Phase 0

Not timestamp-derived, unlike the guidance in
[`../../../architecture/notifications/recommendation/candidate-selection.md`](../../../architecture/notifications/recommendation/candidate-selection.md).
Explicit, deliberate, temporary product direction for a manual testing
surface — see
[`../../../architecture/recommendation/candidate-selection.md`](../../../architecture/recommendation/candidate-selection.md)
for the full reasoning and what Phase 1 must revisit.
