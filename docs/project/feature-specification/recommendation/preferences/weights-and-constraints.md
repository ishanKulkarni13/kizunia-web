# Preference Weights and Constraints

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-01](../decisions/README.md#rd-01), [RD-02](../decisions/README.md#rd-02)

This restates, for the recommendation engine specifically, the weight
semantics already established for competition preferences in
[`../../notification/preferences/weights-and-constraints.md`](../../notification/preferences/weights-and-constraints.md).
Phase 0 does not redefine these rules; it is their first implementation.

---

## The three regimes

A preference is a `(dimension, value, weight)` fact, weight in `[0, 1]`.

| Weight | Meaning | Effect |
| --- | --- | --- |
| `0`, or no entry at all | No preference | Contributes nothing. Not a dislike. |
| `0 < weight < 1` | Soft preference | Raises or lowers relevance. Never excludes. |
| `1` | Hard constraint | A candidate that does not satisfy it is excluded before scoring. |

## Hard-constraint dominance

If **any** value within a dimension has weight `1`, the whole dimension
becomes hard-constrained, and only the weight-1 value(s) are acceptable.
Softer values in the same dimension are ignored, not averaged in.

```text
Location: Pune -> 1.0, Mumbai -> 0.5

Result: Pune is required. Mumbai's 0.5 is discarded — it does not make a
Mumbai competition "half acceptable".
```

## Why hard constraints are not scored

A hard constraint is evaluated in the **eligibility** stage, strictly
before scoring — see
[`../../../architecture/recommendation/pipeline.md`](../../../architecture/recommendation/pipeline.md).
By the time a candidate reaches scoring, every hard dimension it has is
already known to match; scoring treats that as a given rather than
re-deriving it.
