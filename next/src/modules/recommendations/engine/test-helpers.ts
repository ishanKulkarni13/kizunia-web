/**
 * Shared candidate/profile builders for the engine's unit tests. Not
 * imported by production code — kept alongside the engine so every test
 * file builds fixtures the same way instead of hand-rolling
 * `RecommendationCandidate` objects with different defaults.
 */
import type { PreferenceEntry, RecommendationCandidate } from "./types";

let counter = 0;

export function buildCandidate(
  overrides: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  counter += 1;
  return {
    id: overrides.id ?? `candidate-${counter}`,
    mode: null,
    status: "REGISTRATION_OPEN",
    minTeamSize: null,
    maxTeamSize: null,
    registrationType: null,
    registrationFeeType: null,
    registrationPlatform: null,
    organizerType: null,
    difficulty: null,
    certificateType: null,
    categorySlugs: [],
    technologySlugs: [],
    eligibilityTypes: [],
    searchAreaIds: [],
    startDate: null,
    registrationDeadline: null,
    ...overrides,
  };
}

export function entry(
  dimension: PreferenceEntry["dimension"],
  value: string,
  weight: number,
): PreferenceEntry {
  return { dimension, value, weight };
}
