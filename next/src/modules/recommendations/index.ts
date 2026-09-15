/**
 * Recommendations module — public API. Import from this file, not from
 * `engine/`, `backend/`, or any other internal path, outside this module —
 * with one deliberate exception.
 *
 * `backend/` (the service, controller, candidate repository/service,
 * preference provider) is NOT re-exported here. It imports `@/lib/prisma`
 * and `next/server` transitively, and this barrel must stay safe to import
 * from a client component. Server-side consumers (the API route, the
 * internal testing page) deep-import
 * `@/modules/recommendations/backend/...` directly — the same convention
 * `competitions/search/definition.ts` vs `ui.ts` and `lib/http/route.ts`
 * (excluded from the `lib/http` barrel for the same reason) already
 * establish in this codebase.
 */

// Engine — the pure, reusable capability. Phase 1 Notifications and any
// future recommendation surface should depend on these exports, not
// reimplement scoring/ranking/eligibility.
export {
  DimensionId,
  normalizeProfile,
  runRecommendationPipeline,
  WeightedCoverageScorer,
  type PreferenceEntry,
  type PreferenceProfile,
  type NormalizedProfile,
  type RecommendationCandidate,
  type RecommendationConfig,
  type RecommendationDiagnostics,
  type PipelineResult,
  type RankedCandidate,
} from "./engine";

// Configuration
export {
  defaultRecommendationConfig,
  SYSTEM_WEIGHTS,
  ENABLED_DIMENSIONS,
  DEFAULT_THRESHOLD,
  DEFAULT_TOP_N,
  DEFAULT_CANDIDATE_LIMIT,
} from "./config/recommendation-config";

// DTOs
export type {
  RecommendationResultDTO,
  RecommendationItemDTO,
} from "./types/recommendation.dto";

// Client
export { RecommendationApi } from "./api/recommendation-api";
export {
  GenerateRecommendationsSchema,
  type GenerateRecommendationsInput,
} from "./schemas/generate-recommendations";
