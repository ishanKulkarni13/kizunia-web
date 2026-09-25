import { describe, expect, it } from "vitest";

import { SUBSCRIBED_WEBHOOK_EVENTS } from "../types";
import { parseRazorpayWebhook } from "./webhook-events";

/*
 * Fixtures follow Razorpay's documented sample payloads
 * (https://razorpay.com/docs/webhooks/payloads/subscriptions/, …/refunds/,
 * …/disputes/), trimmed to the fields that matter plus a few that must be
 * ignored. The same envelope is used in TEST and LIVE.
 */
const CREATED_AT = 1_790_000_000;
const PERIOD_START = 1_789_900_000;
const PERIOD_END = 1_792_500_000;

function subscriptionEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_00000000000001",
    entity: "subscription",
    plan_id: "plan_00000000000001",
    customer_id: "cust_00000000000001",
    status: "active",
    current_start: PERIOD_START,
    current_end: PERIOD_END,
    charge_at: PERIOD_END,
    notes: { kz_sub: "ck_local", kz_env: "TEST" },
    customer_email: "someone@example.com",
    ...overrides,
  };
}

function envelope(event: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_00000000000001",
    event,
    contains: Object.keys(payload),
    payload,
    created_at: CREATED_AT,
    ...extra,
  });
}

const paymentEntity = {
  id: "pay_00000000000001",
  entity: "payment",
  amount: 1000,
  currency: "INR",
  status: "captured",
  invoice_id: "inv_00000000000001",
  method: "card",
  created_at: CREATED_AT - 10,
};

describe("parseRazorpayWebhook — subscription events", () => {
  const lifecycle = SUBSCRIBED_WEBHOOK_EVENTS.filter((type) => type.startsWith("subscription."));

  it("recognizes exactly the ten subscribed lifecycle events", () => {
    expect(lifecycle).toHaveLength(10);
  });

  it.each(lifecycle)("reads %s: the envelope and the subscription ID", (event) => {
    const parsed = parseRazorpayWebhook(envelope(event, { subscription: { entity: subscriptionEntity() } }));

    expect(parsed).toMatchObject({
      kind: "EVENT",
      eventType: event,
      category: "SUBSCRIPTION",
      accountId: "acc_00000000000001",
      providerCreatedAt: new Date(CREATED_AT * 1000),
      providerSubscriptionId: "sub_00000000000001",
    });
  });

  it("never reads the payload status: the event carries no phase", () => {
    const parsed = parseRazorpayWebhook(
      envelope("subscription.halted", { subscription: { entity: subscriptionEntity({ status: "active" }) } }),
    );

    expect(JSON.stringify(Object.keys(parsed))).not.toContain("status");
  });

  it("subscription.charged carries a CHARGE fact, with the period from the subscription entity", () => {
    const parsed = parseRazorpayWebhook(
      envelope("subscription.charged", {
        subscription: { entity: subscriptionEntity() },
        payment: { entity: paymentEntity },
      }),
    );

    expect(parsed).toMatchObject({
      category: "SUBSCRIPTION",
      moneyFact: {
        kind: "CHARGE",
        providerObjectId: "pay_00000000000001",
        amountMinor: 1000,
        currency: "INR",
        providerInvoiceId: "inv_00000000000001",
        periodStart: new Date(PERIOD_START * 1000),
        periodEnd: new Date(PERIOD_END * 1000),
        occurredAt: new Date((CREATED_AT - 10) * 1000),
        relatedPaymentId: null,
      },
    });
  });

  it("records no fact from an incomplete payment entity, but still reads the event", () => {
    const parsed = parseRazorpayWebhook(
      envelope("subscription.charged", {
        subscription: { entity: subscriptionEntity() },
        payment: { entity: { ...paymentEntity, amount: "1000" } },
      }),
    );

    expect(parsed).toMatchObject({ kind: "EVENT", moneyFact: null, providerSubscriptionId: "sub_00000000000001" });
  });

  it("a lifecycle event other than charged carries no fact, even with a payment entity", () => {
    const parsed = parseRazorpayWebhook(
      envelope("subscription.activated", {
        subscription: { entity: subscriptionEntity() },
        payment: { entity: paymentEntity },
      }),
    );

    expect(parsed).toMatchObject({ moneyFact: null });
  });
});

describe("parseRazorpayWebhook — fact-only events", () => {
  it("refund.processed is a REFUND fact linked to its payment", () => {
    const parsed = parseRazorpayWebhook(
      envelope("refund.processed", {
        refund: {
          entity: {
            id: "rfnd_00000000000001",
            entity: "refund",
            amount: 500,
            currency: "INR",
            payment_id: "pay_00000000000001",
            status: "processed",
            created_at: CREATED_AT,
          },
        },
        payment: { entity: paymentEntity },
      }),
    );

    expect(parsed).toMatchObject({
      category: "FACT_ONLY",
      providerSubscriptionId: null,
      moneyFact: {
        kind: "REFUND",
        providerObjectId: "rfnd_00000000000001",
        amountMinor: 500,
        relatedPaymentId: "pay_00000000000001",
        providerInvoiceId: null,
      },
    });
  });

  it("payment.dispute.created is a DISPUTE fact linked to its payment", () => {
    const parsed = parseRazorpayWebhook(
      envelope("payment.dispute.created", {
        payment: { entity: paymentEntity },
        dispute: {
          entity: {
            id: "disp_00000000000001",
            entity: "dispute",
            payment_id: "pay_00000000000001",
            amount: 1000,
            currency: "INR",
            created_at: CREATED_AT,
          },
        },
      }),
    );

    expect(parsed).toMatchObject({
      category: "FACT_ONLY",
      moneyFact: { kind: "DISPUTE", providerObjectId: "disp_00000000000001", relatedPaymentId: "pay_00000000000001" },
    });
  });
});

describe("parseRazorpayWebhook — anything else", () => {
  it("an unsubscribed type is UNSUPPORTED, never a failure", () => {
    for (const event of ["payment.captured", "invoice.paid", "order.paid", "subscription.something_new"]) {
      expect(parseRazorpayWebhook(envelope(event, { payment: { entity: paymentEntity } }))).toMatchObject({
        kind: "EVENT",
        eventType: event,
        category: "UNSUPPORTED",
        moneyFact: null,
      });
    }
  });

  it("accepts bytes as well as a string", () => {
    const body = envelope("subscription.paused", { subscription: { entity: subscriptionEntity() } });

    expect(parseRazorpayWebhook(new TextEncoder().encode(body))).toMatchObject({ eventType: "subscription.paused" });
  });

  it("keeps the parsed body for the event record", () => {
    const parsed = parseRazorpayWebhook(envelope("subscription.paused", {}));

    expect(parsed).toMatchObject({ kind: "EVENT", payload: { event: "subscription.paused" } });
  });

  it("tolerates a missing created_at and a missing subscription", () => {
    expect(parseRazorpayWebhook(envelope("subscription.paused", {}, { created_at: undefined }))).toMatchObject({
      providerCreatedAt: null,
      providerSubscriptionId: null,
    });
  });

  it.each([
    ["not JSON", "not json at all"],
    ["an array", "[]"],
    ["null", "null"],
    ["no event type", JSON.stringify({ account_id: "acc_1", payload: {} })],
    ["no account", JSON.stringify({ event: "subscription.paused", payload: {} })],
    ["an empty event type", JSON.stringify({ event: " ", account_id: "acc_1" })],
  ])("is MALFORMED for %s", (_name, body) => {
    expect(parseRazorpayWebhook(body)).toMatchObject({ kind: "MALFORMED" });
  });
});
