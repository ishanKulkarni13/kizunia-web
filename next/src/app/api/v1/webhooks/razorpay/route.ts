/**
 * `POST /api/v1/webhooks/razorpay` — Razorpay webhook deliveries.
 *
 * Registered in the Razorpay Dashboard, once per mode, with its own secret,
 * and subscribed to exactly the SB-WH-08 events. The route holds HTTP only:
 * `BillingWebhookController` reads the raw body and schedules the follow-up,
 * and `WebhookService` verifies, records and answers
 * (docs/architecture/subscription/implementation/webhooks.md).
 *
 * - `runtime = "nodejs"`: the raw bytes and `node:crypto` HMAC are needed.
 * - `dynamic = "force-dynamic"`: never evaluated at build time.
 * - `after()` runs the best-effort sync once the 2xx has gone; correctness never
 *   depends on it, since the tick drains whatever it does not finish.
 */
import { after, type NextRequest } from "next/server";

import { BillingWebhookController } from "@/modules/billing/backend/webhooks/webhook.controller";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** The response itself stays well inside Razorpay's 5 s; this bounds the `after()` follow-up. */
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return BillingWebhookController.razorpay(request, (work) => after(work));
}
