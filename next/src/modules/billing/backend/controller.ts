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
import { BillingSummaryService } from "./billing-summary.service";
import { CommandRunner, parseIdempotencyKey } from "./commands/command-runner";
import { ConfirmCheckoutService } from "./commands/confirm-checkout";
import { StartCheckoutCommand, type StartCheckoutDeps } from "./commands/start-checkout";
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
   * `POST /api/v1/me/billing/checkout` — StartCheckout. Requires an
   * `Idempotency-Key` header; a retry with the same key gets the same answer.
   * `200` with checkout parameters, or `202` while it is being set up or confirmed.
   */
  static async startCheckout(request: NextRequest, runner = new CommandRunner(), checkout: StartCheckoutDeps = {}) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_CHECKOUT, request, actor });

      const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
      const body = await request.json().catch(() => ({}));
      const input = StartCheckoutSchema.parse(body);

      const result = await runner.run(new StartCheckoutCommand(input, checkout), {
        actor: { userId: actor.id, actorKind: "USER", actorUserId: actor.id },
        idempotencyKey,
      });

      return result.status === "CHECKOUT_READY" || result.status === "CLOSED" ? ApiResponse.ok(result) : ApiResponse.accepted(result);
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
}
