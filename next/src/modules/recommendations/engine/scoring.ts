/**
 * Recommendation Engine — Default Scoring Strategy (PURE)
 *
 * =============================================================================
 * The formula
 * =============================================================================
 *
 *   for each ACTIVE dimension d (user expressed a preference in d, AND d is
 *   enabled):
 *
 *     w_d = systemWeight(d) * userStrength(d)
 *
 *     m_d = MATCH    -> matched value's weight / userStrength(d)     in (0, 1]
 *           MISMATCH -> 0
 *           MISSING  -> 0
 *
 *   score = sum(w_d * m_d) / sum(w_d)     over active dimensions only
 *
 * =============================================================================
 * Why this shape
 * =============================================================================
 *
 * - It is a weighted mean of terms already in [0, 1], so the result is in
 *   [0, 1] and — critically — comparable across users and across time. A
 *   weighted *sum* would not have that property, and the threshold (a fixed
 *   floor per `docs/architecture/recommendation/scoring-strategy.md`) is
 *   only meaningful if scores mean the same thing for every profile shape.
 *
 * - Dimensions the user never expressed a preference for are absent from
 *   *both* the numerator and the denominator. A user who only configured
 *   `categories` and `location` is scored purely on those two — inactive
 *   dimensions cannot drag the average down, and cannot inflate it either.
 *
 * - Hard dimensions contribute `m_d = 1` unconditionally: eligibility has
 *   already guaranteed a weight-1 match for every hard dimension by the time
 *   scoring runs (see `eligibility.ts`), so re-scoring them would double
 *   count the same fact. They still contribute their full `w_d` to the
 *   denominator, which is intentional — a hard preference is not "free",
 *   it is already fully satisfied.
 *
 * - `MISSING` and `MISMATCH` are scored identically (both `m_d = 0`) in
 *   Phase 0. Whether a missing value should be penalized less harshly than
 *   a genuine mismatch is recorded as open in the existing notification
 *   spec (`ND-R-07`); equal treatment is the simplest defensible default
 *   and is documented as a first-version choice, not a permanent one.
 *
 * This is one strategy behind the `ScoringStrategy` interface (`types.ts`).
 * Swapping it for another deterministic formula, an experiment variant, or
 * eventually a learned model changes nothing about eligibility, ranking,
 * threshold or the pipeline's shape — see `docs/architecture/recommendation/scoring-strategy.md`.
 */
import { evaluateDimension } from "./dimensions/dimension";
import { COMPETITION_DIMENSIONS } from "./dimensions/registry";
import type {
  DimensionContribution,
  DimensionId,
  DimensionSignal,
  ScoringStrategy,
} from "./types";

export const WeightedCoverageScorer: ScoringStrategy = {
  id: "weighted-coverage-v1",

  score({ profile, candidate, systemWeights, enabledDimensions }) {
    const contributions: DimensionContribution[] = [];
    let numerator = 0;
    let denominator = 0;

    for (const [dimensionId, preference] of profile) {
      if (!enabledDimensions.has(dimensionId)) continue;

      const dimension = COMPETITION_DIMENSIONS.get(dimensionId);
      if (!dimension) continue;

      const systemWeight = systemWeights[dimensionId] ?? 0;
      const effectiveWeight = systemWeight * preference.userStrength;
      if (effectiveWeight <= 0) continue;

      const signal: DimensionSignal = preference.hard
        ? hardSignal(dimensionId, dimension.extract(candidate))
        : evaluateDimension(dimension, preference, candidate);

      const m = signal.outcome === "MATCH" ? signal.strength : 0;

      numerator += effectiveWeight * m;
      denominator += effectiveWeight;

      contributions.push({
        dimension: dimensionId,
        systemWeight,
        userStrength: preference.userStrength,
        effectiveWeight,
        signal,
      });
    }

    const score = denominator > 0 ? numerator / denominator : 0;

    return { score, contributions };
  },
};

/**
 * A hard dimension has already been proven MATCH by the eligibility stage
 * (or this candidate would not be here) — re-running set intersection would
 * just repeat that work, so scoring treats it as a guaranteed full-strength
 * match instead.
 */
function hardSignal(
  dimension: DimensionId,
  candidateValues: readonly string[] | null,
): DimensionSignal {
  return {
    dimension,
    outcome: "MATCH",
    strength: 1,
    candidateValues: candidateValues ?? [],
  };
}
