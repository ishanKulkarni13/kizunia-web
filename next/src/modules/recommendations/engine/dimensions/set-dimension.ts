/**
 * Recommendation Engine — Generic Value-Set Dimension (PURE)
 *
 * Factory for the common case: a dimension whose candidate value is a
 * single nullable scalar (an enum field) or a list of related slugs/ids,
 * matched by default set-intersection (see `dimension.ts`).
 *
 * This is what keeps the engine from becoming "one class per dimension with
 * its own hand-written boilerplate" — nine of the thirteen Phase 0
 * dimensions (mode, registrationPlatform, registrationType,
 * registrationFeeType, organizerType, difficulty, certificateType, status,
 * plus categories/technologies/eligibilities as list-valued ones) are one
 * call to this factory each. See `registry.ts`.
 */
import type { RecommendationCandidate, RecommendationDimension } from "../types";
import type { DimensionId } from "../types";

/**
 * A single nullable scalar field — `null` means "the competition has no
 * data for this dimension", which the default matcher treats as MISSING.
 */
export function scalarDimension(
  id: DimensionId,
  read: (candidate: RecommendationCandidate) => string | null,
): RecommendationDimension {
  return {
    id,
    extract: (candidate) => {
      const value = read(candidate);
      return value === null ? null : [value];
    },
  };
}

/**
 * A list-valued relation (categories, technologies, eligibilities). An
 * empty list is treated the same as `null` — "this competition declares no
 * categories" and "this competition has no category data" are the same
 * thing from a matching standpoint, and both must be MISSING, not a
 * mismatch produced by comparing against an empty set.
 */
export function listDimension(
  id: DimensionId,
  read: (candidate: RecommendationCandidate) => readonly string[],
): RecommendationDimension {
  return {
    id,
    extract: (candidate) => {
      const values = read(candidate);
      return values.length === 0 ? null : values;
    },
  };
}
