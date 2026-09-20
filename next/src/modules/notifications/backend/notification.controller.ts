/**
 * Notifications — Controller
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

import {
  ListNotificationsQuerySchema,
  RegisterPushSubscriptionSchema,
} from "../schemas/notification";
import { NotificationService } from "./notification.service";
import { PushSubscriptionService } from "./push-subscription.service";

export class NotificationController {
  /** The CURRENT authenticated user's inbox, newest first. */
  static async listForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATIONS_INBOX_READ,
        request,
        actor,
      });

      const query = ListNotificationsQuerySchema.parse(
        Object.fromEntries(request.nextUrl.searchParams),
      );

      const page = await NotificationService.getInbox({
        userId: actor.id,
        limit: query.limit,
        cursor: query.cursor,
        unreadOnly: query.unreadOnly,
      });

      return ApiResponse.ok(page);
    });
  }

  /**
   * Just the unread count.
   *
   * Its own endpoint because the bell polls it and has no use for the
   * notifications themselves — one indexed count is a great deal cheaper than a
   * page of rows, and it gets its own, higher rate limit for the same reason.
   */
  static async unreadCountForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATIONS_UNREAD_COUNT,
        request,
        actor,
      });

      const unreadCount = await NotificationService.getUnreadCount(actor.id);

      return ApiResponse.ok({ unreadCount });
    });
  }

  static async markRead(request: NextRequest, notificationId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATIONS_MARK_READ,
        request,
        actor,
      });

      await NotificationService.markRead(actor.id, notificationId);

      // `ok({})` rather than `noContent()` — `HttpClient` parses a JSON body
      // unconditionally, so a 204 throws in the browser. Matches the
      // delete/restore/bookmark precedent in the competitions controller.
      return ApiResponse.ok({});
    });
  }

  static async markAllRead(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATIONS_MARK_READ,
        request,
        actor,
      });

      const updated = await NotificationService.markAllRead(actor.id);

      return ApiResponse.ok({ updated });
    });
  }

  static async markResponded(request: NextRequest, notificationId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATIONS_MARK_READ,
        request,
        actor,
      });

      await NotificationService.markResponded(actor.id, notificationId);

      return ApiResponse.ok({});
    });
  }
}

export class PushSubscriptionController {
  static async registerForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.PUSH_SUBSCRIPTIONS_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = RegisterPushSubscriptionSchema.parse(body);

      const subscription = await PushSubscriptionService.register({
        userId: actor.id,
        token: input.token,
        // Falls back to the request's own header, so the list is useful even
        // when a client does not bother sending one.
        userAgent: input.userAgent ?? request.headers.get("user-agent"),
      });

      return ApiResponse.created(subscription);
    });
  }

  static async listForCurrentUser(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.NOTIFICATIONS_INBOX_READ,
        request,
        actor,
      });

      const subscriptions = await PushSubscriptionService.listForUser(actor.id);

      return ApiResponse.ok({ subscriptions });
    });
  }

  static async revokeForCurrentUser(request: NextRequest, subscriptionId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.PUSH_SUBSCRIPTIONS_WRITE,
        request,
        actor,
      });

      // Revoking something that is already gone, or was never theirs, reports
      // the same no-content result. There is nothing useful to say, and saying
      // more would confirm the id exists.
      await PushSubscriptionService.revoke(actor.id, subscriptionId);

      return ApiResponse.ok({});
    });
  }
}
