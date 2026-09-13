# Scoring Strategy

> **Status:** Design
>
> **Last Updated:** 2026-09-12

Relevance scoring is the part of this subsystem most likely to change, and the change most likely
to be dramatic — a better deterministic scorer, an experiment variant, eventually a learned model.

The architectural requirement is therefore not *"score well"*. It is *"be replaceable"*.

---

## The contract

A scoring strategy takes a user's competition preference profile and a candidate, and produces a
relevance signal that can be ordered.

That is the whole contract. Deliberately absent from it:

- what the number means in absolute terms;
- how it is computed;
- whether it is deterministic;
- whether it is explainable;
- how many fields contributed.

Nothing downstream reads the score's internals. Ranking orders it; the threshold compares it;
selection counts. None of them inspect it.

That property — and not any particular interface shape — is what makes the algorithm replaceable.

---

## What the strategy must honour

Replaceable does not mean unconstrained. Any implementation must satisfy the product rules:

| Rule | Ruling |
| --- | --- |
| Hard constraints are **not** the scorer's job — failures are already excluded before scoring | [ND-P-08](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-08--weight-1-is-a-hard-constraint-applied-before-scoring) |
| A soft mismatch or a missing value lowers relevance but never excludes | [ND-R-05](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-05--soft-mismatches-and-missing-values-lower-relevance-but-do-not-exclude) |
| Weight `0` and an unset field both mean *no preference*, never dislike | [ND-P-06](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-06--weight-0-means-indifference-never-dislike) |
| An unset field contributes no signal | [ND-P-03](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-03--nothing-selected-in-a-field-means-no-preference) |
| Location matches downward through the hierarchy, never upward | [ND-P-10](../../../project/feature-specification/notification/decisions/preferences.md#nd-p-10--location-expands-downward-never-upward) |
| The output is comparable across candidates for the same user | [ND-R-01](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-01--relevance-is-a-ranking-not-a-verdict) |

A replacement scorer that violates any of these is a behavior change requiring a new ruling, not a
drop-in substitution.

---

## What is not decided

The formula itself, whether fields carry inherent importance, weight normalization, and how harshly
a `null` is penalized relative to a mismatch are all open
([ND-R-07](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-07--the-scoring-formula-is-deliberately-undecided)).

**This is deliberate and is the reason the contract above is so thin.** A contract that leaked the
formula's structure — normalized field weights summing to one, say — would have to change the first
time the formula did.

---

## Comparability and the threshold

One consequence needs stating, because it is easy to miss.

The threshold is an absolute floor
([ND-R-02](../../../project/feature-specification/notification/decisions/relevance.md#nd-r-02--the-minimum-threshold-is-a-floor-never-lowered-for-quota)),
so scores must be comparable **across users and across time**, not only within one ranking.
Otherwise a threshold tuned for one user's profile shape silently means something different for
another's.

This is the tightest real constraint on the formula, and it is why the threshold's value cannot be
chosen before the formula exists. Swapping scorers means re-deriving the threshold.

---

## Replacement scenarios the design must survive

| Scenario | What must not change |
| --- | --- |
| A better deterministic scorer | Persistence, delivery, preferences, queueing, any intent |
| An ML model | The same, plus the pipeline's stage sequence |
| An A/B or experiment variant | The same, plus the ability for two strategies to coexist |
| A feature-flagged implementation | The same, plus per-user strategy resolution |

The last two imply that strategy selection is resolved **per evaluation**, not fixed at startup —
which is a cheap property to preserve now and expensive to retrofit.

---

## What experiments will need that does not exist

A scoring experiment is not analysable unless the run records which strategy produced the result.
The relevant vocabulary — algorithm or model version, experiment variant, ranking position,
recommendation reason — is listed as **future** tracking and is not built
([`../cross-cutting/analytics-and-tracking.md`](../cross-cutting/analytics-and-tracking.md)).

Noted here so that whoever builds the first variant knows the tracking is a prerequisite, not a
follow-up.

---

## Ranking is a separate strategy

Scoring produces a signal; ranking orders candidates. They are separated so that ordering concerns
— tie-breaking, recency bias, diversity across a selection — can change without touching the
scorer. See [ranking-and-selection.md](ranking-and-selection.md).
