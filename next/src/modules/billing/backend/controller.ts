/**
 * Billing — User-facing Controller
 *
 * Responsible for:
 * - Authentication
 * - Rate limiting
 * - Calling the service
 * - Returning responses
 *
 * Phase I exposes only the caller's own effective access. Checkout and
 * subscription commands arrive in later phases.
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { EntitlementsService } from "./entitlements.service";

export class BillingController {
  /** `GET /api/v1/me/entitlements` */
  static async getMyEntitlements(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.ENTITLEMENTS_READ,
        request,
        actor,
      });

      const entitlements = await EntitlementsService.getForUser(actor);

      return ApiResponse.ok(entitlements);
    });
  }
}
