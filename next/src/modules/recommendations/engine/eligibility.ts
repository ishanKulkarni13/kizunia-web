/**
 * Recommendation Engine — Eligibility / Hard-Constraint Stage (PURE)
 *
 * Runs strictly before scoring (mirrors ND-R-04 from the notification
 * spec's relevance decisions: candidate filtering runs before scoring).
 * Only dimensions the user made *hard* (weight `1`, after hard-constraint
 * dominance — see `profile.ts`) are evaluated here; a soft mismatch is
 * never a rejection reason.
 *
 * This stage is deliberately not "the recommendation scorer with a cutoff".
 * It answers a yes/no eligibility question and stops at the first failing
 * hard dimension it is asked to check — evaluation order comes from the
 * caller's dimension list, not from a strength ranking, so it stays
 * deterministic and cheap.
 */
import { evaluateDimension } from "./dimensions/dimension";
import type {
  DimensionId,
  DimensionSignal,
  EligibilityResult,
  NormalizedProfile,
  RecommendationCandidate,
  RecommendationDimension,
} from "./types";

export function evaluateEligibility(
  profile: NormalizedProfile,
  candidate: RecommendationCandidate,
  dimensions: ReadonlyMap<DimensionId, RecommendationDimension>,
  enabledDimensions: ReadonlySet<DimensionId>,
): EligibilityResult {
  const signals: DimensionSignal[] = [];

  for (const [id, preference] of profile) {
    if (!preference.hard || !enabledDimensions.has(id)) continue;

    const dimension = dimensions.get(id);
    if (!dimension) continue;

    const signal = evaluateDimension(dimension, preference, candidate);
    signals.push(signal);

    if (signal.outcome !== "MATCH") {
      return {
        eligible: false,
        rejection: {
          dimension: id,
          reason: signal.outcome === "MISSING" ? "HARD_MISSING" : "HARD_MISMATCH",
        },
        signals,
      };
    }
  }

  return { eligible: true, signals };
}
