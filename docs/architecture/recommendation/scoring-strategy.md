# Scoring Strategy

> **Status:** Stable — Phase 0
>
> **Last Updated:** 2026-09-15

## The contract

`engine/types.ts`'s `ScoringStrategy`:

```ts
interface ScoringStrategy {
  readonly id: string;
  score(input: {
    profile: NormalizedProfile;
    candidate: RecommendationCandidate;
    signals: readonly DimensionSignal[];
    systemWeights: Readonly<Record<DimensionId, number>>;
    enabledDimensions: ReadonlySet<DimensionId>;
  }): ScoringResult;
}
```

This mirrors the existing notification spec's scoring contract
(`docs/architecture/notifications/recommendation/scoring-strategy.md`):
nothing downstream inspects a score's internals. Ranking orders it, the
threshold compares it. That property is what makes the strategy
replaceable — see [`extensibility.md`](extensibility.md).

## The default strategy: `WeightedCoverageScorer`

```text
for each ACTIVE dimension d (user expressed a preference in d, AND d is enabled):

  w_d = systemWeight(d) * userStrength(d)

  m_d = MATCH    -> matched value's weight / userStrength(d)     in (0, 1]
        MISMATCH -> 0
        MISSING  -> 0

score = sum(w_d * m_d) / sum(w_d)     over active dimensions only
```

Implementation: `engine/scoring.ts`.

## Why this shape

- **A weighted mean, not a weighted sum** — the result is always in
  `[0, 1]`, and comparable across users and across time. This is the
  tightest real constraint identified by the existing notification
  scoring-strategy doc: the threshold is an absolute floor, so it is only
  meaningful if scores mean the same thing for every profile shape. A
  weighted sum would not have that property (a user with more active
  preferences would trivially score higher).
- **Inactive dimensions are absent from both numerator and denominator** —
  a user who only configured `categories` and `location` is scored purely
  on those two. This directly answers the product requirement that
  dimensions a user does not care about must not drag down their score.
- **Hard dimensions contribute `m_d = 1`** — eligibility already guaranteed
  a weight-1 match for every hard dimension before scoring runs
  (`engine/eligibility.ts`), so re-scoring them would double count the same
  fact. They still contribute their full `w_d` to the denominator: a hard
  preference is not "free", it is already fully satisfied.
- **`MISSING` and `MISMATCH` are scored identically** — both `m_d = 0`. The
  relative severity between them is recorded as open in the existing
  notification decisions (`ND-R-07`) and Phase 0 does not resolve it; equal
  treatment is the simplest defensible default.
- **Zero active dimensions -> score `0`**, not an artificial "everything
  matches". `denominator > 0 ? numerator / denominator : 0` in
  `engine/scoring.ts` enforces this directly.

## Replacing the strategy

A different deterministic formula, an experiment variant, or eventually an
ML model can implement `ScoringStrategy` and be substituted in
`config/recommendation-config.ts`'s `scorer` field. What must not change
when doing so:

- Hard constraints are not the scorer's job — they are already excluded
  before scoring runs.
- A soft mismatch or missing value lowers relevance, never excludes.
- Weight `0` and an unset field both mean "no preference", never dislike.
- The output stays comparable across candidates for the same user.

Swapping the scorer means re-deriving the threshold default (see
[`configuration.md`](configuration.md)) — a new formula almost certainly
does not preserve "0.5 means half the weighted preference mass" exactly.
