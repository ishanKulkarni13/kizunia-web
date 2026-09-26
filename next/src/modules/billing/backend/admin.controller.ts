/**
 * Billing — Admin Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication
 * - Rate limiting
 * - Calling the service
 * - Returning responses
 *
 * Authorization is deliberately *not* here. It lives in `GrantService`, through
 * `BillingAuthorizer`, so no caller can reach a grant mutation by going around
 * the HTTP layer.
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { CreateGrantSchema, ExtendGrantSchema, RevokeGrantSchema } from "../schemas/grant";
import { AdminCancelSchema } from "../schemas/lifecycle";
import { CreatePromotionSchema } from "../schemas/promotion";
import { AdminSyncService } from "./admin-sync.service";
import { AdminCancelService } from "./commands/admin-cancel";
import { parseIdempotencyKey } from "./commands/command-runner";
import { GrantService } from "./grants/grant.service";
import { PromotionService } from "./grants/promotion.service";

export class BillingAdminController {
  /** `GET /api/v1/admin/billing/promotions` */
  static async listPromotions(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      // Throttling only: authorization (`MANAGE_ENTITLEMENT_GRANTS`) is in the service.
      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await PromotionService.list(actor, Object.fromEntries(request.nextUrl.searchParams.entries())));
    });
  }

  /** `POST /api/v1/admin/billing/promotions` */
  static async createPromotion(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE, request, actor });

      const input = CreatePromotionSchema.parse(await request.json().catch(() => ({})));

      return ApiResponse.created(await PromotionService.create(actor, input));
    });
  }

  /** `GET /api/v1/admin/billing/grants` */
  static async listGrants(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.BILLING_ADMIN_READ,
        request,
        actor,
      });

      const result = await GrantService.list(
        actor,
        Object.fromEntries(request.nextUrl.searchParams.entries()),
      );

      return ApiResponse.ok(result);
    });
  }

  /** `POST /api/v1/admin/billing/grants` */
  static async createGrant(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = CreateGrantSchema.parse(body);

      const grant = await GrantService.create(actor, input);

      return ApiResponse.created(grant);
    });
  }

  /** `POST /api/v1/admin/billing/grants/{id}/extend` */
  static async extendGrant(request: NextRequest, grantId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = ExtendGrantSchema.parse(body);

      const grant = await GrantService.extend(actor, grantId, input);

      return ApiResponse.ok(grant);
    });
  }

  /** `POST /api/v1/admin/billing/grants/{id}/revoke` */
  static async revokeGrant(request: NextRequest, grantId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE,
        request,
        actor,
      });

      const body = await request.json().catch(() => ({}));
      const input = RevokeGrantSchema.parse(body);

      const grant = await GrantService.revoke(actor, grantId, input);

      return ApiResponse.ok(grant);
    });
  }

  /**
   * `POST /api/v1/admin/billing/subscriptions/{id}/sync` — "sync now". Reads
   * from Razorpay only, but spends provider budget, so it is limited like a
   * billing admin write.
   */
  static async syncSubscription(request: NextRequest, subscriptionId: string, service = new AdminSyncService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE,
        request,
        actor,
      });

      return ApiResponse.ok(await service.syncNow(actor, subscriptionId));
    });
  }

  /**
   * `POST /api/v1/admin/billing/subscriptions/{id}/cancel` — an immediate
   * cancel with a reason (MANAGE_BILLING, checked in the service). Requires an
   * `Idempotency-Key`; takes the customer's operation slot (409 while one of
   * theirs is in flight).
   */
  static async cancelSubscription(request: NextRequest, subscriptionId: string, service = new AdminCancelService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE,
        request,
        actor,
      });

      const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
      const input = AdminCancelSchema.parse(await request.json().catch(() => ({})));
      const result = await service.cancel(actor, subscriptionId, input, idempotencyKey);

      return result.status === "CANCELLED" ? ApiResponse.ok(result) : ApiResponse.accepted(result);
    });
  }
}
