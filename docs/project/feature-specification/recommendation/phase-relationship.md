# Phase Relationship

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

```text
PHASE 0                              PHASE 1
Competition Recommendation   ---->   Notification System
Engine                                consuming recommendations

userId -> RecommendationResult        Trigger
                                         -> User eligibility
                                         -> Candidate selection
                                         -> Recommendation Engine (Phase 0)
                                         -> Recommendation Set
                                         -> Notification Policy
                                         -> Notification Generation
                                         -> Queue
                                         -> Delivery
```

## What Phase 0 owns

Everything up to and including `RecommendationResult`. The recommendation
engine has no knowledge of notifications, delivery, or persistence — see
[`../../../architecture/notifications/principles.md`](../../../architecture/notifications/principles.md),
Principle 3, which this phase split makes structural.

## What Phase 1 owns

Deciding **whether** a recommendation becomes a notification, and
everything after that decision: policy, aggregation, generation, queueing,
delivery, history. Phase 1's existing specification (see
[`../notification/README.md`](../notification/README.md)) already describes
this pipeline in detail; it should call into the Phase 0 engine for
relevance rather than re-implementing scoring, ranking, or eligibility.

## Where the two must agree, and how

| Concept | Phase 0 | Phase 1 |
| --- | --- | --- |
| Preference weight semantics | Implements them | Same semantics — see [`preferences/weights-and-constraints.md`](preferences/weights-and-constraints.md) |
| Location matching | Implements `SearchArea` containment | Must reuse, not reimplement — [`relevance/location-matching.md`](relevance/location-matching.md) |
| Threshold | Owns the default and the mechanism | May choose a different threshold value once its own scoring needs are known, but must not conflate threshold with selection quantity — [`relevance/threshold-and-selection.md`](relevance/threshold-and-selection.md) |
| Candidate universe | "Open for registration" only, `status`-based | May need a different candidate rule per intent (e.g. `REGISTRATION_CLOSING`'s deadline window) — see [`../../../architecture/recommendation/candidate-selection.md`](../../../architecture/recommendation/candidate-selection.md) for what Phase 1 must revisit |

## What Phase 1 should NOT do

- Re-implement relevance scoring, ranking, or eligibility filtering inside
  the notification pipeline.
- Reach into competition internals to compute relevance itself — that
  temptation is explicitly named as a risk in
  [`../../../architecture/notifications/module-boundaries.md`](../../../architecture/notifications/module-boundaries.md).
- Treat Phase 0's dummy preference profile as real data — Phase 1's own
  candidate-selection blocking question (A-4, "where does 'relevant' come
  from") should be answered in terms of *replacing* the dummy provider with
  a real one, not by building a second scoring path.

## Open item this creates for Phase 1

Phase 0's candidate selection is deliberately simplified (`status`-only,
no timestamp reasoning — see
[`decisions/README.md#rd-09`](decisions/README.md#rd-09)). Phase 1's
`TOP_RELEVANT_COMPETITION` intent, which runs on a schedule rather than on
manual demand, should revisit whether that simplification is still
acceptable once it has to run unattended and at volume — see the cost
problem already recorded in
[`../../../architecture/notifications/recommendation/candidate-selection.md`](../../../architecture/notifications/recommendation/candidate-selection.md).
