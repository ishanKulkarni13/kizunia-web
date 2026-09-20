/**
 * Recommendation Engine — Public surface of the PURE engine.
 *
 * Everything exported here has no Prisma import and no I/O. Consumers
 * outside this module should import from `@/modules/recommendations`
 * (the module barrel), not from `engine/` directly — this file exists so
 * `config/` and `backend/` within the module have one place to import the
 * engine from.
 */
export * from "./types";
export { normalizeProfile, hardDimensions } from "./profile";
export { evaluateEligibility } from "./eligibility";
export { evaluateDimension } from "./dimensions/dimension";
export { COMPETITION_DIMENSIONS } from "./dimensions/registry";
export { WeightedCoverageScorer } from "./scoring";
export { rankCandidates, type ScoredCandidate } from "./ranking";
export { runRecommendationPipeline } from "./pipeline";
