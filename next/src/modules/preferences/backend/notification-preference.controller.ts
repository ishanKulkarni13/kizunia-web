/**
 * Notification Preferences — Controller
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

import { UpdateNotificationPreferenceSchema } from "../schemas/notification-preference";
import { NotificationPreferenceService } from "./notification-preference.service";

export class NotificationPreferenceController {
  /**
   * Returns the CURRENT authenticated user's notification preferences,
   * covering every known intent (missing ones reported at their default).
   */
  static async getForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATION_PREFERENCES_READ,
        request,
        actor,
      });

      const preferences = await NotificationPreferenceService.getForUser(actor.id);

      return ApiResponse.ok({ preferences });
    });
  }

  /**
   * Updates one intent's enabled state for the CURRENT authenticated user.
   * The request schema has no `userId` field, so there is nothing a caller
   * could supply to target another user's preference.
   */
  static async updateForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATION_PREFERENCES_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = UpdateNotificationPreferenceSchema.parse(body);

      const preference = await NotificationPreferenceService.update(
        actor.id,
        input.intent,
        input.enabled,
      );

      return ApiResponse.ok(preference);
    });
  }
}
