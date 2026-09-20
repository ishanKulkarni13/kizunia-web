# Scoring — Product View

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15
>
> **Rulings:** [RD-07](../decisions/README.md#rd-07)

The technical formula and its full rationale live in
[`../../../architecture/recommendation/scoring-strategy.md`](../../../architecture/recommendation/scoring-strategy.md).
This document states the product-level guarantees that formula must honor,
independent of its exact shape — mirroring the existing notification
decisions this inherits from (`ND-P-06`, `ND-P-08`, `ND-R-01`, `ND-R-05`).

## What a score means

A relevance score is a number in `[0, 1]`, comparable across candidates for
the same user, expressing **how well a competition matches the preferences
the user actually expressed** — not how many of all possible competition
attributes happen to match.

## The guarantees

- A dimension the user never expressed a preference for does not lower
  their score for any candidate. A user who only cares about categories and
  location is scored on categories and location — not diluted by every
  other dimension defaulting to "no match".
- Matching a preferred value raises relevance; mismatching or missing data
  lowers it (never raises it).
- A user's own weights matter: something weighted `1.0` counts for more
  than something weighted `0.4`.
- Kizunia's own sense of what matters more (a "system weight" — e.g.
  category matters more than certificate type) also factors in, independent
  of the user's weighting. See
  [`../../../architecture/recommendation/configuration.md`](../../../architecture/recommendation/configuration.md)
  for the current values and their rationale.
- Hard preferences do not need to be "matched again" in the score — they
  were already required to match to reach scoring at all (see
  [`threshold-and-selection.md`](threshold-and-selection.md) and
  [`../preferences/weights-and-constraints.md`](../preferences/weights-and-constraints.md)).

## What is deliberately not fixed yet

The exact formula, the exact relative weight between dimensions, and
whether missing data should be penalized less harshly than a genuine
mismatch are all first-version choices, expected to change with real usage.
The architecture keeps the scoring strategy replaceable specifically so
that changing the formula does not require touching eligibility, ranking,
threshold handling, or anything downstream. See
[`../../../architecture/recommendation/scoring-strategy.md`](../../../architecture/recommendation/scoring-strategy.md).
