/**
 * Webhook ingestion against real Postgres, with the fake provider's signing
 * and the real Razorpay payload parser: verification first, one transaction,
 * dedupe, unmatched events, money facts, and nothing recorded on failure.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { InMemoryRateLimitStore } from "@/lib/rate-limit/memory.store";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { ALERT_CONFIG } from "../../config/billing-config";
import { createPlanCatalog } from "../../config/plan-catalog";
import { FakeBillingProvider, type FakeWebhookInput } from "../../provider/fake-provider";
import { SyncService } from "../sync/sync.service";
import { WebhookService, type WebhookServiceDeps } from "./webhook.service";

const PREFIX = "__vitest_billing_webhook__";
const T0 = new Date("2026-10-01T12:00:00.000Z");

let fake: FakeBillingProvider;
let records: LogRecord[];
let sequence = 0;

function service(overrides: Partial<WebhookServiceDeps> = {}) {
  return new WebhookService({
    provider: () => fake,
    mode: () => "TEST",
    accountId: () => "acc_fake",
    counterStore: new InMemoryRateLimitStore(),
    sync: new SyncService({
      providerFor: () => fake,
      resolvedMode: () => "TEST",
      now: () => T0,
      random: () => 0.5,
      catalog: createPlanCatalog([{ providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" }]),
    }),
    ...overrides,
  });
}

const eventId = () => `evt_${PREFIX}${Date.now()}_${(sequence += 1)}`;
const unknownPsub = () => `sub_${PREFIX}${Date.now()}_${(sequence += 1)}`;

function delivery(input: FakeWebhookInput, options: { eventId?: string | null; signature?: string | null; receivedAt?: Date } = {}) {
  const body = fake.webhookBody(input);
  const bytes = Buffer.from(body);

  return {
    rawBody: bytes,
    signature: options.signature === undefined ? fake.signWebhook(body) : options.signature,
    eventId: options.eventId === undefined ? eventId() : options.eventId,
    receivedAt: options.receivedAt ?? T0,
  };
}

async function bound(phase: "ACTIVE" | "CANCELLED" | "PENDING_AUTHENTICATION" = "ACTIVE") {
  const userId = await createBillingUser(PREFIX);
  const sub = await insertBoundSubscription(userId, { phase });

  return { userId, sub, psub: sub.providerSubscriptionId! };
}

const eventRow = (dedupeKey: string) => prisma.billingEvent.findUnique({ where: { provider_dedupeKey: { provider: "RAZORPAY", dedupeKey } } });
const alertConditions = () => records.filter((r) => r.event === "billing.alert").map((r) => r.fields.condition);

beforeEach(() => {
  fake = new FakeBillingProvider({ now: () => T0 });
  records = [];
  setLogSink((record) => {
    records.push(record);
  });
});
afterEach(async () => {
  resetLogSink();
  await cleanupBillingUsers(PREFIX);
});
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("WebhookService.ingest — verification comes first (SB-WH-01)", () => {
  it("refuses a bad or missing signature and writes nothing", async () => {
    const { psub } = await bound();

    for (const signature of ["deadbeef", null, ""]) {
      const d = delivery({ eventType: "subscription.halted", providerSubscriptionId: psub }, { signature });

      expect(await service().ingest(d)).toEqual({ status: 400, outcome: "INVALID_SIGNATURE" });
      expect(await eventRow(d.eventId!)).toBeNull();
    }
    expect(records.filter((r) => r.event === "webhook.rejected_signature")).toHaveLength(3);
  });

  it("fails closed when billing is disabled", async () => {
    const d = delivery({ eventType: "subscription.halted", providerSubscriptionId: unknownPsub() });

    expect(await service({ mode: () => "DISABLED" }).ingest(d)).toEqual({ status: 400, outcome: "DISABLED" });
    expect(await eventRow(d.eventId!)).toBeNull();
  });

  it("accepts the previous secret inside its rotation window, and records which matched", async () => {
    fake = new FakeBillingProvider({
      now: () => T0,
      previousWebhookSecret: "old",
      previousWebhookSecretUntil: new Date(T0.getTime() + 60_000),
    });
    const { psub } = await bound();
    const body = fake.webhookBody({ eventType: "subscription.halted", providerSubscriptionId: psub });
    const id = eventId();

    const result = await service().ingest({
      rawBody: Buffer.from(body),
      signature: fake.signWebhookWithPrevious(body),
      eventId: id,
      receivedAt: T0,
    });

    expect(result).toMatchObject({ status: 200, outcome: "RECORDED" });
    expect(await eventRow(id)).toMatchObject({ matchedSecret: "PREVIOUS" });
  });

  it("rejects a signed body that is not JSON, with an alert, and records nothing", async () => {
    const body = "definitely not json";

    const result = await service().ingest({
      rawBody: Buffer.from(body),
      signature: fake.signWebhook(body),
      eventId: eventId(),
      receivedAt: T0,
    });

    expect(result).toEqual({ status: 400, outcome: "MALFORMED" });
    expect(alertConditions()).toContain("WEBHOOK_SIGNED_NON_JSON");
  });

  it("rejects an event from another merchant account", async () => {
    const d = delivery({ eventType: "subscription.halted", providerSubscriptionId: unknownPsub(), accountId: "acc_other" });

    expect(await service().ingest(d)).toEqual({ status: 400, outcome: "ACCOUNT_MISMATCH" });
    expect(await eventRow(d.eventId!)).toBeNull();
    expect(records.find((r) => r.event === "webhook.rejected_account")?.fields.receivedAccountId).toBe("acc_other");
  });

  it("alerts once when rejected signatures cross the hourly baseline", async () => {
    const svc = service();

    for (let i = 0; i < ALERT_CONFIG.signatureFailuresPerHour + 3; i += 1) {
      await svc.ingest(delivery({ eventType: "subscription.halted" }, { signature: "bad" }));
    }

    expect(alertConditions().filter((c) => c === "WEBHOOK_SIGNATURE_FAILURES")).toHaveLength(1);
  });
});

describe("WebhookService.ingest — recording", () => {
  it("records a subscription event and marks its subscription due; the payload status is never applied", async () => {
    const { sub, psub } = await bound("ACTIVE");
    const d = delivery({ eventType: "subscription.halted", providerSubscriptionId: psub, subscription: { status: "halted" } });

    const result = await service().ingest(d);

    expect(result).toMatchObject({ status: 200, outcome: "RECORDED", followUp: { subscriptionIds: [sub.id], unmatchedProviderSubscriptionIds: [] } });
    expect(await eventRow(d.eventId!)).toMatchObject({
      providerMode: "TEST",
      dedupeSource: "HEADER",
      eventType: "subscription.halted",
      providerSubscriptionId: psub,
      accountId: "acc_fake",
      status: "RECORDED",
      subscriptionId: sub.id,
      matchedSecret: "CURRENT",
      duplicateCount: 0,
    });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      phase: "ACTIVE",
      syncDueAt: T0,
      syncReason: "WEBHOOK",
      syncRequestedAt: T0,
    });
  });

  it("does nothing twice for a redelivery of the same event", async () => {
    const { psub } = await bound();
    const d = delivery({ eventType: "subscription.charged", providerSubscriptionId: psub, payment: { id: `pay_${PREFIX}1`, amount: 1000 } });

    await service().ingest(d);
    const again = await service().ingest(d);

    expect(again).toMatchObject({ status: 200, outcome: "DUPLICATE", followUp: { subscriptionIds: [] } });
    expect(await eventRow(d.eventId!)).toMatchObject({ duplicateCount: 1 });
    expect(await prisma.billingMoneyFact.count({ where: { providerObjectId: `pay_${PREFIX}1` } })).toBe(1);
  });

  it("deduplicates on the body hash when the event-ID header is absent (A6 fallback)", async () => {
    const { psub } = await bound();
    const d = delivery({ eventType: "subscription.paused", providerSubscriptionId: psub }, { eventId: null });

    const first = await service().ingest(d);
    const second = await service().ingest(d);

    expect(first).toMatchObject({ outcome: "RECORDED" });
    expect(second).toMatchObject({ outcome: "DUPLICATE" });
    expect(await prisma.billingEvent.findUniqueOrThrow({ where: { id: (first as { billingEventId: string }).billingEventId } })).toMatchObject({
      dedupeSource: "BODY_SHA256",
      duplicateCount: 1,
    });
  });

  it("records one row under concurrent delivery of one event", async () => {
    const { psub } = await bound();
    const d = delivery({ eventType: "subscription.resumed", providerSubscriptionId: psub });

    const results = await Promise.all(Array.from({ length: 4 }, () => service().ingest(d)));

    expect(results.filter((r) => r.status === 200 && r.outcome === "RECORDED")).toHaveLength(1);
    expect(await eventRow(d.eventId!)).toMatchObject({ duplicateCount: 3 });
  });

  it("persists an event for a subscription Kizunia does not know as UNMATCHED_PENDING (SB-WH-06)", async () => {
    const psub = unknownPsub();
    const d = delivery({ eventType: "subscription.activated", providerSubscriptionId: psub });

    const result = await service().ingest(d);

    expect(result).toMatchObject({ status: 200, followUp: { subscriptionIds: [], unmatchedProviderSubscriptionIds: [psub] } });
    expect(await eventRow(d.eventId!)).toMatchObject({ status: "UNMATCHED_PENDING", subscriptionId: null });
  });

  it("records an unsupported type as SKIPPED_UNSUPPORTED, marking nothing", async () => {
    const { sub, psub } = await bound();
    const d = delivery({ eventType: "payment.captured", providerSubscriptionId: psub });

    expect(await service().ingest(d)).toMatchObject({ status: 200, followUp: { subscriptionIds: [] } });
    expect(await eventRow(d.eventId!)).toMatchObject({ status: "SKIPPED_UNSUPPORTED" });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).syncDueAt).toBeNull();
  });

  it("links an event for a terminal subscription without marking it due", async () => {
    const { sub, psub } = await bound("CANCELLED");
    const d = delivery({ eventType: "subscription.cancelled", providerSubscriptionId: psub });

    expect(await service().ingest(d)).toMatchObject({ status: 200, followUp: { subscriptionIds: [] } });
    expect(await eventRow(d.eventId!)).toMatchObject({ status: "RECORDED", subscriptionId: sub.id });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).syncDueAt).toBeNull();
  });

  it("returns 500 and records nothing when the transaction fails", async () => {
    const { sub, psub } = await bound();
    const d = delivery({ eventType: "subscription.charged", providerSubscriptionId: psub, payment: { id: `pay_${PREFIX}fail`, amount: 500 } });

    const result = await service({
      beforeCommit: async () => {
        throw new Error("database went away");
      },
    }).ingest(d);

    expect(result).toEqual({ status: 500, outcome: "RECORD_FAILED" });
    expect(await eventRow(d.eventId!)).toBeNull();
    expect(await prisma.billingMoneyFact.count({ where: { providerObjectId: `pay_${PREFIX}fail` } })).toBe(0);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).syncDueAt).toBeNull();
    expect(alertConditions()).toContain("WEBHOOK_RECORD_FAILED");
  });
});

describe("WebhookService.ingest — money facts (SB-WH-04)", () => {
  it("records a charge once, even if Razorpay sends it under two event IDs", async () => {
    const { sub, psub, userId } = await bound();
    const payment = { id: `pay_${PREFIX}charge`, amount: 1000, invoiceId: "inv_1" };

    await service().ingest(delivery({ eventType: "subscription.charged", providerSubscriptionId: psub, payment }));
    await service().ingest(delivery({ eventType: "subscription.charged", providerSubscriptionId: psub, payment }));

    const facts = await prisma.billingMoneyFact.findMany({ where: { providerObjectId: payment.id } });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "CHARGE", amountMinor: 1000, currency: "INR", providerInvoiceId: "inv_1", subscriptionId: sub.id, userId });
  });

  it("links a refund to its subscription through the charge of the same payment, and never changes access", async () => {
    const { sub, psub } = await bound();
    const paymentId = `pay_${PREFIX}refunded`;

    await service().ingest(delivery({ eventType: "subscription.charged", providerSubscriptionId: psub, payment: { id: paymentId, amount: 1000 } }));
    const result = await service().ingest(
      delivery({ eventType: "refund.processed", refund: { id: `rfnd_${PREFIX}1`, paymentId, amount: 1000 } }),
    );

    expect(result).toMatchObject({ status: 200, followUp: { subscriptionIds: [] } });
    expect(await prisma.billingMoneyFact.findFirst({ where: { providerObjectId: `rfnd_${PREFIX}1` } })).toMatchObject({
      kind: "REFUND",
      subscriptionId: sub.id,
    });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).phase).toBe("ACTIVE");
  });

  it("records a dispute and raises a support alert", async () => {
    await service().ingest(
      delivery({ eventType: "payment.dispute.created", dispute: { id: `disp_${PREFIX}1`, paymentId: `pay_${PREFIX}x`, amount: 700 } }),
    );

    expect(await prisma.billingMoneyFact.findFirst({ where: { providerObjectId: `disp_${PREFIX}1` } })).toMatchObject({
      kind: "DISPUTE",
      subscriptionId: null,
    });
    expect(alertConditions()).toContain("DISPUTE_RECORDED");
  });
});

describe("WebhookService.followUp", () => {
  it("syncs the marked subscription from the authoritative fetch", async () => {
    const { sub, psub } = await bound("ACTIVE");
    fake.seed({ providerSubscriptionId: psub, rawStatus: "halted", providerPlanId: "plan_pro_m" });
    const svc = service();

    const result = await svc.ingest(delivery({ eventType: "subscription.halted", providerSubscriptionId: psub }));
    if (result.status !== 200) throw new Error("expected 200");
    await svc.followUp(result.followUp);

    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ phase: "HALTED" });
    expect(await prisma.subscriptionHistoryEntry.findFirst({ where: { subscriptionId: sub.id } })).toMatchObject({
      trigger: "WEBHOOK",
      billingEventId: result.billingEventId,
    });
  });
});
