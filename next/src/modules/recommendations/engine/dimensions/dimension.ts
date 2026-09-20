/**
 * Recommendation Engine — Default Dimension Matching (PURE)
 *
 * The default `match` behavior every dimension gets unless it overrides one
 * (see `RecommendationDimension.match` in `../types.ts`): is any preferred
 * value present in what the candidate carries.
 *
 * This is what lets most dimensions — mode, categories, technologies,
 * eligibilities, location, the remaining enum fields — be declared as pure
 * `extract` functions with no bespoke matching code at all.
 */
import type {
  DimensionPreference,
  DimensionSignal,
  MatchOutcome,
  RecommendationCandidate,
  RecommendationDimension,
} from "../types";

export function evaluateDimension(
  dimension: RecommendationDimension,
  preference: DimensionPreference,
  candidate: RecommendationCandidate,
): DimensionSignal {
  if (dimension.match) {
    return dimension.match(preference, candidate);
  }

  return defaultSetMatch(dimension, preference, candidate);
}

/**
 * Set-intersection matching: MATCH if the candidate carries any value the
 * user prefers, MISSING if the candidate has no data for this dimension at
 * all, MISMATCH otherwise (the candidate has data, but none of it matches).
 *
 * On MATCH, `strength` is the *matched* value's own weight relative to the
 * dimension's `userStrength` — this is what makes `Pune 1.0 / Mumbai 0.7`
 * score a Mumbai match lower than a Pune match while both still count as
 * "matched" for eligibility purposes.
 */
function defaultSetMatch(
  dimension: RecommendationDimension,
  preference: DimensionPreference,
  candidate: RecommendationCandidate,
): DimensionSignal {
  const candidateValues = dimension.extract(candidate);

  if (candidateValues === null) {
    return missing(dimension.id);
  }

  let bestMatchWeight = 0;
  for (const value of candidateValues) {
    const weight = preference.values.get(value);
    if (weight !== undefined && weight > bestMatchWeight) {
      bestMatchWeight = weight;
    }
  }

  const outcome: MatchOutcome = bestMatchWeight > 0 ? "MATCH" : "MISMATCH";

  return {
    dimension: dimension.id,
    outcome,
    strength: outcome === "MATCH" ? bestMatchWeight / preference.userStrength : 0,
    candidateValues,
  };
}

function missing(dimension: DimensionSignal["dimension"]): DimensionSignal {
  return { dimension, outcome: "MISSING", strength: 0, candidateValues: [] };
}
