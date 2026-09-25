/**
 * Billing — Webhook Controller
 *
 * The HTTP edge of `POST /api/v1/webhooks/razorpay`. Responsible for:
 *
 * - the inbound rate limit (by IP, generous, fail-open);
 * - reading the body as raw bytes, never as JSON (SB-WH-01);
 * - handing bytes and headers to `WebhookService`, which is HTTP-agnostic;
 * - scheduling the follow-up after the response (`after()` in the route), so
 *   the 2xx never waits on a provider call;
 * - timing the response against Razorpay's 5-second limit.
 *
 * Unauthenticated by session by necessity: the signature is the only
 * authenticity check, and it is the service's first step. The scheduler is a
 * parameter so tests can run the follow-up synchronously; `after()` throws
 * outside a request scope.
 */
import { NextResponse } from "next/server";

import { Route } from "@/lib/http/route";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { ALERT_CONFIG } from "../../config/billing-config";
import { BillingAlertCondition, logBillingAlert, logBillingEvent } from "../../observability/log";
import { WebhookService } from "./webhook.service";

/** Runs work after the response has been sent: `after` from `next/server` in the route. */
export type AfterResponse = (work: () => Promise<void>) => void;

export class BillingWebhookController {
  static async razorpay(
    request: Request,
    afterResponse: AfterResponse,
    service: WebhookService = new WebhookService(),
  ) {
    const startedAt = Date.now();

    return Route.execute(async () => {
      await rateLimitService.enforce({ policyId: RateLimitPolicyId.BILLING_WEBHOOK, request });

      const rawBody = Buffer.from(await request.arrayBuffer());
      const result = await service.ingest({
        rawBody,
        signature: request.headers.get("x-razorpay-signature"),
        eventId: request.headers.get("x-razorpay-event-id"),
        receivedAt: new Date(),
      });

      const latencyMs = Date.now() - startedAt;

      logBillingEvent("webhook.latency", { status: result.status, outcome: result.outcome, latencyMs });

      if (latencyMs > ALERT_CONFIG.webhookLatencyAlertMs) {
        logBillingAlert(BillingAlertCondition.WEBHOOK_LATENCY, "HIGH", { latencyMs, outcome: result.outcome });
      }

      if (result.status === 200) {
        const { followUp } = result;

        if (followUp.subscriptionIds.length > 0 || followUp.unmatchedProviderSubscriptionIds.length > 0) {
          afterResponse(() => service.followUp(followUp));
        }
      }

      // Razorpay reads only the status. The body says nothing an attacker could use.
      return NextResponse.json({ received: result.status === 200 }, { status: result.status });
    });
  }
}
