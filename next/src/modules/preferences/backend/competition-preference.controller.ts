/**
 * Competition Preferences — Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication (never trusts a caller-supplied userId)
 * - Rate limiting
 * - Calling the service
 * - Returning responses
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { UpdateCompetitionPreferencesSchema } from "../schemas/competition-preference";
import { CompetitionPreferenceService } from "./competition-preference.service";

export class CompetitionPreferenceController {
  /**
   * Returns the CURRENT authenticated user's competition preference
   * profile — possibly empty, which is itself meaningful (no personalized
   * recommendation signal yet, see ND-P-04).
   */
  static async getForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.COMPETITION_PREFERENCES_READ,
        request,
        actor,
      });

      const preferences = await CompetitionPreferenceService.getForUser(actor.id);

      return ApiResponse.ok({ preferences });
    });
  }

  /**
   * Full-replace: the request body is the CURRENT authenticated user's
   * complete desired profile. An empty `preferences` array is valid and
   * resets the profile.
   */
  static async replaceForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.COMPETITION_PREFERENCES_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = UpdateCompetitionPreferencesSchema.parse(body);

      const preferences = await CompetitionPreferenceService.replaceForUser(actor.id, input);

      return ApiResponse.ok({ preferences });
    });
  }
}
