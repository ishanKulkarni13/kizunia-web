/**
 * Billing — User-facing Controller
 *
 * Responsible for:
 * - Authentication
 * - Rate limiting
 * - Request parsing (the body, and the `Idempotency-Key` header)
 * - Calling the service
 * - Returning responses
 *
 * Every endpoint acts on the session user's own billing only: `userId` comes
 * from the session, never from the request.
 */
import { NextRequest } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { ConfirmCheckoutSchema, StartCheckoutSchema } from "../schemas/checkout";
import { CancelSubscriptionSchema, ChangePlanSchema } from "../schemas/lifecycle";
import { RedeemPromotionSchema } from "../schemas/promotion";
import { BillingSummaryService } from "./billing-summary.service";
import { CancelSubscriptionCommand } from "./commands/cancel";
import { ChangePlanCommand } from "./commands/change-plan";
import { CommandRunner, parseIdempotencyKey } from "./commands/command-runner";
import { ConfirmCheckoutService } from "./commands/confirm-checkout";
import { StartCheckoutCommand, type StartCheckoutDeps } from "./commands/start-checkout";
import { SupersedeCommand } from "./commands/supersede";
import { EntitlementsService } from "./entitlements.service";
import { PromotionService } from "./grants/promotion.service";
import { RecoveryService } from "./recovery.service";

/** Pending outcomes answer 202; definitive ones 200. */
const PENDING: ReadonlySet<string> = new Set(["IN_PROGRESS", "CONFIRMING"]);

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

  /**
   * `GET /api/v1/me/billing` — effective plan, capabilities, allowed actions
   * and state facets. What the billing UI renders and polls; it never calls
   * the provider.
   */
  static async getMyBilling(request: NextRequest, service = new BillingSummaryService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      // The same budget as /me/entitlements: both are cheap reads of the caller's own access.
      await rateLimitService.enforce({ policyId: RateLimitPolicyId.ENTITLEMENTS_READ, request, actor });

      return ApiResponse.ok(await service.getForUser(actor));
    });
  }

  /**
   * `POST /api/v1/me/billing/checkout` — StartCheckout, or a supersession
   * when the body carries `supersedesSubscriptionId` and
   * `confirmSupersession: true` (Phase VI). Requires an `Idempotency-Key`
   * header; a retry with the same key gets the same answer. `200` with
   * checkout parameters, or `202` while it is being set up or confirmed.
   */
  static async startCheckout(request: NextRequest, runner = new CommandRunner(), checkout: StartCheckoutDeps = {}) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_CHECKOUT, request, actor });

      const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
      const body = await request.json().catch(() => ({}));
      const input = StartCheckoutSchema.parse(body);

      const invocation = { actor: { userId: actor.id, actorKind: "USER" as const, actorUserId: actor.id }, idempotencyKey };
      const { supersedesSubscriptionId } = input;
      // The trial flag and the code are the only acquisition intents the client sends (IB-27).
      const result =
        supersedesSubscriptionId !== undefined
          ? await runner.run(
              new SupersedeCommand({ plan: input.plan, cycle: input.cycle, trial: input.trial, code: input.code, supersedesSubscriptionId }, checkout),
              invocation,
            )
          : await runner.run(new StartCheckoutCommand(input, checkout), invocation);

      return PENDING.has(result.status) ? ApiResponse.accepted(result) : ApiResponse.ok(result);
    });
  }

  /**
   * `POST /api/v1/me/billing/promotions/redeem` — redeem a promotion code for
   * the session user: free access to its plan for its duration, once per user,
   * never beyond its limit. No provider is involved, so it needs no
   * Idempotency-Key and works in every provider mode: a repeat is a
   * `409 PROMOTION_ALREADY_REDEEMED` (IB-27 item 14).
   */
  static async redeemPromotion(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.PROMOTIONS_REDEEM, request, actor });

      const input = RedeemPromotionSchema.parse(await request.json().catch(() => ({})));

      return ApiResponse.created(await PromotionService.redeem(actor, input));
    });
  }

  /**
   * `POST /api/v1/me/billing/checkout/confirm` — ConfirmCheckout, after
   * Razorpay Checkout. A read-only trigger: no Idempotency-Key (IB-25 item 8).
   */
  static async confirmCheckout(request: NextRequest, service = new ConfirmCheckoutService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_CHECKOUT_CONFIRM, request, actor });

      const body = await request.json().catch(() => ({}));
      const input = ConfirmCheckoutSchema.parse(body);

      return ApiResponse.ok(await service.confirm(actor, input));
    });
  }

  /**
   * `POST /api/v1/me/billing/cancel` — cancel the caller's subscription with
   * the timing they confirmed (`CYCLE_END` for ACTIVE, `IMMEDIATE` otherwise).
   * Requires an `Idempotency-Key`. `200` when requested or observed, `202`
   * while being confirmed.
   */
  static async cancel(request: NextRequest, runner = new CommandRunner()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_COMMAND, request, actor });

      const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
      const input = CancelSubscriptionSchema.parse(await request.json().catch(() => ({})));

      const result = await runner.run(new CancelSubscriptionCommand(input.timing), {
        actor: { userId: actor.id, actorKind: "USER", actorUserId: actor.id },
        idempotencyKey,
      });

      return PENDING.has(result.status) ? ApiResponse.accepted(result) : ApiResponse.ok(result);
    });
  }

  /**
   * `POST /api/v1/me/billing/change-plan` — a native plan change where
   * Razorpay allows it; otherwise refused with the V1 limitation. Requires an
   * `Idempotency-Key`.
   */
  static async changePlan(request: NextRequest, runner = new CommandRunner()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_COMMAND, request, actor });

      const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
      const input = ChangePlanSchema.parse(await request.json().catch(() => ({})));

      const result = await runner.run(new ChangePlanCommand(input), {
        actor: { userId: actor.id, actorKind: "USER", actorUserId: actor.id },
        idempotencyKey,
      });

      return PENDING.has(result.status) ? ApiResponse.accepted(result) : ApiResponse.ok(result);
    });
  }

  /**
   * `POST /api/v1/me/billing/recovery` — what `checkout.js` needs to open
   * Razorpay's payment-method change for the caller's on-hold subscription.
   * No provider call and nothing recorded (IB-26 item 8).
   */
  static async recovery(request: NextRequest, service = new RecoveryService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_COMMAND, request, actor });

      return ApiResponse.ok(await service.recoveryParams(actor));
    });
  }

  /**
   * `POST /api/v1/me/billing/sync` — "check now": a read-only sync of the
   * caller's own subscription, answered with the summary. No Idempotency-Key.
   */
  static async checkNow(request: NextRequest, service = new RecoveryService()) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_CHECKOUT_CONFIRM, request, actor });

      return ApiResponse.ok(await service.checkNow(actor));
    });
  }
}
