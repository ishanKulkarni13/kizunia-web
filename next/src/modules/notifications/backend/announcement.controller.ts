/**
 * Announcements — Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication
 * - Rate limiting
 * - Calling the service
 * - Returning responses
 *
 * Authorization is deliberately *not* here. It lives in the service, called
 * through `NotificationAnnouncementAuthorizer`, matching the repository's
 * convention — so a second caller (an internal tool, a test, a future admin
 * action) cannot reach the capability by going around the HTTP layer.
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import {
  CreateAnnouncementSchema,
  ListAnnouncementsQuerySchema,
} from "../schemas/announcement";
import { AnnouncementService } from "./announcement.service";

export class AnnouncementController {
  static async create(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.ANNOUNCEMENTS_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = CreateAnnouncementSchema.parse(body);

      const announcement = await AnnouncementService.create(actor, input);

      return ApiResponse.created(announcement);
    });
  }

  static async list(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.ANNOUNCEMENTS_WRITE,
        request,
        actor,
      });

      const query = ListAnnouncementsQuerySchema.parse(
        Object.fromEntries(request.nextUrl.searchParams),
      );

      const announcements = await AnnouncementService.list(actor, query.limit);

      return ApiResponse.ok({ announcements });
    });
  }

  static async cancel(request: NextRequest, announcementId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.ANNOUNCEMENTS_WRITE,
        request,
        actor,
      });

      const announcement = await AnnouncementService.cancel(actor, announcementId);

      return ApiResponse.ok(announcement);
    });
  }
}
