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
 * Authorization is deliberately *not* here. It lives in the services (`GrantService`,
 * the Phase VIII admin services, ...), through `BillingAuthorizer`, so no caller
 * can reach a billing mutation or a restricted read by going around the HTTP layer.
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { BulkResyncSchema, ResolveAnomalySchema, UserLookupSchema } from "../schemas/admin";
import { CreateGrantSchema, ExtendGrantSchema, RevokeGrantSchema } from "../schemas/grant";
import { AdminCancelSchema } from "../schemas/lifecycle";
import { CreatePromotionSchema } from "../schemas/promotion";
import { AdminSyncService } from "./admin-sync.service";
import { AdminCancelService } from "./commands/admin-cancel";
import { parseIdempotencyKey } from "./commands/command-runner";
import { GrantService } from "./grants/grant.service";
import { PromotionService } from "./grants/promotion.service";
import { AnomalyAdminService } from "./admin/anomaly-admin.service";
import { BulkResyncService } from "./admin/bulk-resync.service";
import { AdminExplainService } from "./admin/explain.service";
import { BillingHealthService } from "./admin/health.service";
import { AdminPayloadService } from "./admin/payload.service";
import { AdminTimelineService } from "./admin/timeline.service";

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

  // -- Phase VIII: explain, timeline, anomalies, bulk re-sync, health ---------
  //
  // Reads are throttled by the read bucket and mutations by the write bucket.
  // Every role check (VIEW_BILLING, MANAGE_BILLING, raw payloads) is in the
  // service.

  /** `GET /api/v1/admin/billing/health` (VIEW_BILLING) */
  static async healthSummary(request: NextRequest, service = new BillingHealthService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await service.summary(actor));
    });
  }

  /** `GET /api/v1/admin/billing/users?userId=|email=` — finds a user for the billing views (VIEW_BILLING). */
  static async lookupUser(request: NextRequest, service = new AdminExplainService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      const params = request.nextUrl.searchParams;
      const input = UserLookupSchema.parse({
        userId: params.get("userId") ?? undefined,
        email: params.get("email") ?? undefined,
      });

      return ApiResponse.ok(await service.lookupUser(actor, input));
    });
  }

  /** `GET /api/v1/admin/billing/users/{id}/access` — explain effective access (VIEW_BILLING). */
  static async explainUser(request: NextRequest, userId: string, service = new AdminExplainService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await service.explain(actor, userId));
    });
  }

  /** `GET /api/v1/admin/billing/users/{id}/timeline` (VIEW_BILLING) */
  static async userTimeline(request: NextRequest, userId: string, service = new AdminTimelineService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await service.forUser(actor, userId));
    });
  }

  /** `GET /api/v1/admin/billing/subscriptions/{id}/timeline` (VIEW_BILLING) */
  static async subscriptionTimeline(request: NextRequest, subscriptionId: string, service = new AdminTimelineService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await service.forSubscription(actor, subscriptionId));
    });
  }

  /**
   * `GET /api/v1/admin/billing/events/{id}/payload` — one webhook's raw
   * payload. SUPER_ADMIN only (checked in the service); never cached.
   */
  static async rawPayload(request: NextRequest, billingEventId: string, service = new AdminPayloadService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      const response = ApiResponse.ok(await service.rawPayload(actor, billingEventId));
      response.headers.set("Cache-Control", "no-store");

      return response;
    });
  }

  /** `GET /api/v1/admin/billing/anomalies` (VIEW_BILLING) */
  static async listAnomalies(request: NextRequest, service = new AnomalyAdminService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await service.list(actor, Object.fromEntries(request.nextUrl.searchParams.entries())));
    });
  }

  /** `GET /api/v1/admin/billing/anomalies/{id}` (VIEW_BILLING) */
  static async getAnomaly(request: NextRequest, anomalyId: string, service = new AnomalyAdminService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_READ, request, actor });

      return ApiResponse.ok(await service.detail(actor, anomalyId));
    });
  }

  /**
   * `POST /api/v1/admin/billing/anomalies/{id}/resolve` — records a human
   * decision with a mandatory reason; changes no billing state (MANAGE_BILLING).
   */
  static async resolveAnomaly(request: NextRequest, anomalyId: string, service = new AnomalyAdminService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE, request, actor });

      const input = ResolveAnomalySchema.parse(await request.json().catch(() => ({})));

      return ApiResponse.ok(await service.resolve(actor, anomalyId, input));
    });
  }

  /**
   * `POST /api/v1/admin/billing/resync` — bulk re-sync: marks matching
   * subscriptions due; never calls the provider (MANAGE_BILLING).
   */
  static async bulkResync(request: NextRequest, service = new BulkResyncService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_ADMIN_WRITE, request, actor });

      const input = BulkResyncSchema.parse(await request.json().catch(() => ({})));

      return ApiResponse.ok(await service.resync(actor, input));
    });
  }
}
