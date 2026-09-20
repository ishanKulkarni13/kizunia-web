# Weights and Constraints

> **Status:** Stable
>
> **Last Updated:** 2026-09-12
>
> **Rulings:** [ND-P-05](../decisions/preferences.md#nd-p-05--weights-run-from-0-to-1),
> [ND-P-06](../decisions/preferences.md#nd-p-06--weight-0-means-indifference-never-dislike),
> [ND-P-07](../decisions/preferences.md#nd-p-07--multiple-values-in-one-field-carry-independent-weights),
> [ND-P-08](../decisions/preferences.md#nd-p-08--weight-1-is-a-hard-constraint-applied-before-scoring),
> [ND-P-09](../decisions/preferences.md#nd-p-09--hard-constraints-dominate-their-field)

---

## The scale

Each selected preference carries a weight between `0` and `1`, expressing how strongly the user
cares:

```text
0            no preference
0 < w < 1    soft preference
1            hard constraint
```

One scale carries both *how much* the user cares and *whether it is negotiable*.

---

## Weight 0 means indifference

A weight of `0` is semantically identical to the preference not being configured at all.

```text
Online -> 0
```

means:

> The user does not care about the mode.

It does **not** mean:

> The user dislikes online competitions.

There is no negative-preference concept in this model. Nothing anywhere in the subsystem may treat
`0` as aversion. If genuine negative preferences are ever wanted, they need their own design and
their own decision — see [`future/personalization.md`](../future/personalization.md).

---

## Soft preferences

A weight strictly between `0` and `1` influences relevance and never excludes.

```text
Mode:
  Online  -> 0.9
  Offline -> 0.4
```

The user prefers online competitions more strongly than offline ones, but an offline competition
can still be recommended if the rest of its characteristics score well.

The model supports independent weights for multiple values within the same field regardless of
what the initial user interface exposes. The UX for configuring individual weights is decided
separately, and the backend must not be built in a way that forecloses it.

---

## Hard constraints

A preference with weight `1` is a **hard constraint**: the competition must satisfy it to remain
eligible.

```text
Online -> 1.0

Online competition   eligible
Offline competition  excluded
```

Hard constraints are applied **before** relevance scoring
([ND-R-04](../decisions/relevance.md#nd-r-04--candidate-filtering-runs-strictly-before-scoring)).
This matters for two reasons:

1. **Correctness.** A candidate that fails a hard constraint must not be able to score its way
   back in on the strength of other attributes.
2. **Efficiency.** Scoring effort is not spent on candidates that can never qualify.

### Hard constraints and missing data

A hard constraint is strict even when the competition's data is incomplete. If the user requires
`Online → 1.0` and the competition's mode is `null`, the competition is **excluded** — Kizunia
cannot establish that the constraint is satisfied.

Soft preferences behave differently with missing data. The full matrix is in
[`relevance/missing-data.md`](../relevance/missing-data.md).

---

## Hard constraint dominance

If **any** value within a field has weight `1`, the entire field becomes hard-constrained and only
the weight-1 values are acceptable.

```text
Online  -> 1.0
Offline -> 0.5
```

means:

> **Only Online is acceptable.**

The `0.5` on Offline is ignored. A hard constraint is a hard constraint.

```text
Any value with weight = 1
        │
Field becomes hard-constrained
        │
Only hard-constrained values are acceptable
```

This rule exists so that weight `1` cannot be quietly weakened by a soft sibling value. Without
it, "I only want online events" would still deliver offline ones.

---

## Summary of semantics

```text
No value selected      no preference
Weight = 0             no preference
0 < weight < 1         soft preference
Weight = 1             hard constraint
```

| Situation | Effect |
| --- | --- |
| Field unset | Field does not participate in relevance |
| All values in field weight 0 | Field does not participate in relevance |
| Some values soft | Matching values raise relevance; others lower it, none are excluded |
| Any value weight 1 | Field is hard-constrained; non-matching and `null` values are excluded |

---

## What is not decided here

How weights are combined into a single relevance score, whether some competition fields carry
inherent importance regardless of user weight, and how weights are normalized are all deliberately
open — see [ND-R-07](../decisions/relevance.md#nd-r-07--the-scoring-formula-is-deliberately-undecided)
and [`open-decisions.md`](../open-decisions.md).
