/**
 * Razorpay — Webhook Events
 *
 * Translates a verified Razorpay webhook body into Kizunia's event vocabulary
 * (`ProviderWebhookEvent`, in `../types.ts`). The only code that knows the
 * payload's shape: `backend/` never reads a Razorpay field name.
 *
 * What it extracts, and nothing more:
 *
 *  - the envelope: `event`, `account_id`, `created_at`;
 *  - the subscription the event is about (`payload.subscription.entity.id`);
 *  - a money fact, for the three events that carry one (SB-WH-04):
 *      subscription.charged     payload.payment.entity  -> CHARGE, with the period
 *                               from payload.subscription.entity
 *      refund.processed         payload.refund.entity   -> REFUND
 *      payment.dispute.created  payload.dispute.entity  -> DISPUTE
 *
 * The subscription's **status in the payload is deliberately not read**. It
 * may be stale or reordered, so an event only ever triggers a fetch (SB-WH-03).
 *
 * A body that is not JSON, or has no event type or account, is `MALFORMED`: a
 * correctly signed body Kizunia cannot read is serious, and the caller alerts.
 * A money-carrying event whose entity is incomplete is still an event; it
 * simply records no fact.
 *
 * Shapes from https://razorpay.com/docs/webhooks/payloads/ (subscriptions,
 * refunds, disputes). The payload is identical in TEST and LIVE.
 */
import type { MoneyFactKind } from "@/generated/prisma";

import {
  SUBSCRIBED_WEBHOOK_EVENTS,
  type ParsedWebhook,
  type WebhookEventCategory,
  type WebhookMoneyFact,
} from "../types";

type Json = Readonly<Record<string, unknown>>;

const SUBSCRIPTION_EVENT_PREFIX = "subscription.";
const FACT_ONLY_EVENTS: ReadonlySet<string> = new Set(["refund.processed", "payment.dispute.created"]);
const SUBSCRIBED: ReadonlySet<string> = new Set(SUBSCRIBED_WEBHOOK_EVENTS);

export function parseRazorpayWebhook(rawBody: string | Uint8Array): ParsedWebhook {
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    return { kind: "MALFORMED", reason: "body is not JSON" };
  }

  if (!isObject(body)) return { kind: "MALFORMED", reason: "body is not a JSON object" };

  const eventType = nonEmptyString(body.event);
  const accountId = nonEmptyString(body.account_id);

  if (eventType === null) return { kind: "MALFORMED", reason: "missing event type" };
  if (accountId === null) return { kind: "MALFORMED", reason: "missing account_id" };

  const payload = isObject(body.payload) ? body.payload : {};
  const subscription = entityOf(payload, "subscription");

  return {
    kind: "EVENT",
    eventType,
    category: categoryOf(eventType),
    accountId,
    providerCreatedAt: epochToDate(body.created_at),
    providerSubscriptionId: subscription ? nonEmptyString(subscription.id) : null,
    moneyFact: moneyFactOf(eventType, payload, subscription),
    payload: body,
  };
}

function categoryOf(eventType: string): WebhookEventCategory {
  if (!SUBSCRIBED.has(eventType)) return "UNSUPPORTED";
  if (FACT_ONLY_EVENTS.has(eventType)) return "FACT_ONLY";

  return eventType.startsWith(SUBSCRIPTION_EVENT_PREFIX) ? "SUBSCRIPTION" : "UNSUPPORTED";
}

function moneyFactOf(eventType: string, payload: Json, subscription: Json | null): WebhookMoneyFact | null {
  switch (eventType) {
    case "subscription.charged": {
      const payment = entityOf(payload, "payment");

      return payment
        ? fact("CHARGE", payment, {
            providerInvoiceId: nonEmptyString(payment.invoice_id),
            periodStart: subscription ? epochToDate(subscription.current_start) : null,
            periodEnd: subscription ? epochToDate(subscription.current_end) : null,
            relatedPaymentId: null,
          })
        : null;
    }
    case "refund.processed": {
      const refund = entityOf(payload, "refund");

      return refund ? fact("REFUND", refund, related(refund)) : null;
    }
    case "payment.dispute.created": {
      const dispute = entityOf(payload, "dispute");

      return dispute ? fact("DISPUTE", dispute, related(dispute)) : null;
    }
    default:
      return null;
  }
}

function related(entity: Json) {
  return {
    providerInvoiceId: null,
    periodStart: null,
    periodEnd: null,
    relatedPaymentId: nonEmptyString(entity.payment_id),
  };
}

function fact(
  kind: MoneyFactKind,
  entity: Json,
  extra: Pick<WebhookMoneyFact, "providerInvoiceId" | "periodStart" | "periodEnd" | "relatedPaymentId">,
): WebhookMoneyFact | null {
  const providerObjectId = nonEmptyString(entity.id);
  const amountMinor = entity.amount;
  const currency = nonEmptyString(entity.currency);
  const occurredAt = epochToDate(entity.created_at);

  if (providerObjectId === null || currency === null || occurredAt === null) return null;
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor)) return null;

  return { kind, providerObjectId, amountMinor, currency, occurredAt, ...extra };
}

/** `payload.<name>.entity`, when it is an object. */
function entityOf(payload: Json, name: string): Json | null {
  const wrapper = payload[name];

  return isObject(wrapper) && isObject(wrapper.entity) ? wrapper.entity : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function epochToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}
