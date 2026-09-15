# Recommendation

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Recommendation answers *"what should be recommended to this user?"*. Notification answers *"should
this recommendation become a notification, and how is it handled?"*.

These are separate responsibilities
([`../principles.md`](../principles.md)):

> The recommendation system must not own notification delivery.
> The notification system must not own the competition relevance algorithm.

This area covers the recommendation half — candidate selection, scoring, ranking, selection and
aggregation — and the mechanics that keep each of them replaceable.

---

## Documents

| Document | Contents |
| --- | --- |
| [candidate-selection.md](candidate-selection.md) | Producing the working set, and the cost problem attached to it |
| [scoring-strategy.md](scoring-strategy.md) | Relevance as a replaceable strategy |
| [ranking-and-selection.md](ranking-and-selection.md) | Ordering, thresholds and selection policies |
| [aggregation.md](aggregation.md) | Combining a selection into user-facing notifications |

---

## The replaceability requirement

Relevance scoring and ranking are expected to evolve. The notification infrastructure must not
depend on a particular scoring or ranking implementation.

Changing the recommendation algorithm should not require changes to:

- notification persistence;
- notification delivery;
- notification preferences;
- queueing;
- unrelated notification intents.

Similarly, selection, ranking and aggregation must not be permanently coupled to one
implementation. Think in terms of **policies and strategies that evolve independently**.

---

## What is decided and what is not

| Decided | Open |
| --- | --- |
| Relevance produces a ranking, not a verdict | The scoring formula |
| Filtering runs before scoring | Weight normalization |
| A minimum threshold applies as a floor | The threshold's value |
| Selection count belongs to the notification policy | Whether fields carry inherent importance |
| Aggregation is a per-intent policy | The location-matching algorithm |

The product rules are in
[`relevance/`](../../../project/feature-specification/notification/relevance/README.md); the open
items in
[`open-decisions.md`](../../../project/feature-specification/notification/open-decisions.md).

The fact that so much is open is not a gap in this design — it is the point. Everything the rest of
the subsystem depends on is specified **without** the formula, which is exactly what makes the
formula replaceable.

---

## Phase 0

A concrete recommendation engine now exists as its own capability, independent of the notification
subsystem: [`docs/architecture/recommendation/`](../../recommendation/README.md). It implements
candidate selection, eligibility, preference matching, a first scoring strategy, threshold and
ranking against the contract `userId -> RecommendationResult` — see
[`docs/project/feature-specification/recommendation/README.md`](../../../project/feature-specification/recommendation/README.md).

This directory's open questions are **not** all resolved by Phase 0. In particular:

- The scoring formula Phase 0 chose (`WeightedCoverageScorer`,
  [`docs/architecture/recommendation/scoring-strategy.md`](../../recommendation/scoring-strategy.md))
  is a first version for a manually-triggered testing surface, not a product-validated answer to
  ND-R-07.
- Phase 0's candidate selection reads `Competition.status` only, not the timestamp-based reasoning
  this directory recommends for the exact registration-open boundary — a deliberate, temporary
  simplification Phase 1 must revisit (see
  [`docs/architecture/recommendation/candidate-selection.md`](../../recommendation/candidate-selection.md)).
- Phase 0's preference profile is a hardcoded dummy, not a persisted model — open decision A-2
  below remains open.

Phase 1 Notifications is expected to depend on the Phase 0 engine for relevance rather than
implementing scoring or ranking itself — see
[`docs/project/feature-specification/recommendation/phase-relationship.md`](../../../project/feature-specification/recommendation/phase-relationship.md).
