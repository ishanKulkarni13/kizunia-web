/**
 * TEMPORARY — TESTING/DEVELOPMENT ONLY. MUST BE REMOVED BEFORE PRODUCTION.
 *
 * This route exists solely so the internal debug panel at
 * `/internal/notification/top-competition` can trigger a recommendation run
 * by hand and inspect the diagnostics. It is NOT part of any production
 * flow: real notification generation calls
 * `RecommendationService.generateForUser` directly, in-process, and never
 * touches this endpoint.
 *
 * BY DESIGN it has no entitlement, plan, or quota gating of any kind — only
 * session auth plus the `RECOMMENDATIONS_GENERATE` rate limit. Recommendation
 * generation is not an intended production capability to expose as a
 * user-callable HTTP endpoint without a plan/quota gate. The production
 * recommendation surface will be designed separately and will NOT be this
 * route.
 *
 * Removal checklist: delete this route file, delete
 * `RecommendationController.generateForCurrentUser`, and delete the debug
 * page under `src/app/(dashboard)/internal/notification/top-competition/`.
 * `RecommendationService` itself stays — it is production code.
 *
 * See docs/architecture/recommendation/testing.md.
 */
import { NextRequest } from "next/server";
import { RecommendationController } from "@/modules/recommendations/backend/controller";

export async function POST(request: NextRequest) {
  return RecommendationController.generateForCurrentUser(request);
}
