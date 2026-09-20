# Recommendation Engine — Architecture

> **Status:** Stable — Phase 0
>
> **Version:** 1.0
>
> **Audience:** Engineering
>
> **Last Updated:** 2026-09-15

This is the technical architecture for the Phase 0 Competition
Recommendation Engine. Product scope and behavior are specified separately
in
[`docs/project/feature-specification/recommendation/`](../../project/feature-specification/recommendation/README.md);
this tree describes how the engine is built, not what it must do.

Implementation: `next/src/modules/recommendations/`.

---

## Documents in this tree

| Document | Contents |
| --- | --- |
| [`pipeline.md`](pipeline.md) | Stage sequence and module boundaries |
| [`dimensions.md`](dimensions.md) | The `RecommendationDimension` abstraction and registry |
| [`configuration.md`](configuration.md) | System weights, threshold, Top-N, enabled dimensions |
| [`scoring-strategy.md`](scoring-strategy.md) | The default formula and its rationale |
| [`candidate-selection.md`](candidate-selection.md) | What candidates are evaluated, and Phase 0's simplification |
| [`result-contract.md`](result-contract.md) | `RecommendationResult` and its diagnostics view |
| [`extensibility.md`](extensibility.md) | How to add/remove a dimension, or replace the scorer |
| [`testing.md`](testing.md) | Test strategy and the internal testing route |
| [`implementation-plan.md`](implementation-plan.md) | What was reused, what was built, and why |
| [`future.md`](future.md) | Explicitly deferred work |

---

## Phase relationship

```text
PHASE 0                              PHASE 1
Competition Recommendation   ---->   Notification System
Engine (this tree)                    consuming recommendations
```

Phase 0 is a standalone module with no knowledge of notifications. Phase 1
Notifications is expected to depend on `RecommendationService` (or the pure
engine directly) as a library, not to reimplement scoring, ranking, or
eligibility. See
[`docs/project/feature-specification/recommendation/phase-relationship.md`](../../project/feature-specification/recommendation/phase-relationship.md)
for the full mapping, and
[`docs/architecture/notifications/recommendation/README.md`](../notifications/recommendation/README.md)
for how the existing notification architecture docs point back here.

## Guiding principle

> The recommendation system must not own notification delivery. The
> notification system must not own the competition relevance algorithm.
>
> — [`docs/architecture/notifications/principles.md`](../notifications/principles.md), Principle 3

Phase 0 exists specifically to make that structural.
