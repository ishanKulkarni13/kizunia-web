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
