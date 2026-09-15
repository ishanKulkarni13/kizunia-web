/**
 * Recommendations Module - Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication (never trusts a caller-supplied userId)
 * - Rate limiting
 * - Calling the service
 * - Returning responses
 *
 * Controllers should never contain business logic. In particular: this
 * controller contains no scoring, eligibility, or ranking logic — it exists
 * only to get an authenticated `userId` and a validated request body to
 * `RecommendationService.generateForUser`.
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { GenerateRecommendationsSchema } from "../schemas/generate-recommendations";
import { RecommendationService } from "./recommendation.service";

export class RecommendationController {
  /**
   * Generates recommendations for the CURRENT authenticated user only.
   *
   * `SessionService.getStrictActor` is the sole source of `userId` here —
   * the request schema has no `userId` field at all (see
   * `schemas/generate-recommendations.ts`), so there is no field a caller
   * could populate to ask for another user's recommendations.
   */
  static async generateForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.RECOMMENDATIONS_GENERATE,
        request,
        actor
      });

      const body = request.headers.get("content-length") === "0"
        ? {}
        : await request.json().catch(() => ({}));

      const input = GenerateRecommendationsSchema.parse(body);

      const result = await RecommendationService.generateForUser({
        userId: actor.id,
        profileOverrides: input.profileOverrides,
        threshold: input.threshold,
        topN: input.topN,
        enabledDimensions: input.enabledDimensions,
        includeDiagnostics: input.includeDiagnostics ?? true,
      });

      return ApiResponse.ok(result);
    });
  }
}
