/**
 * Events for provider subscriptions Kizunia does not know (SB-WH-06): bound
 * through Kizunia's own notes, or kept UNMATCHED with an anomaly, never
 * dropped and never matched by anything else.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription, insertOperation } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { BillingSyncTask } from "../reconciliation/billing-sync.task";
import { SyncService } from "../sync/sync.service";
import { UnmatchedEventResolver } from "./unmatched-resolver";
import { WebhookService } from "./webhook.service";

const PREFIX = "__vitest_billing_unmatched__";
const T0 = new Date("2026-10-01T12:00:00.000Z");
const catalog = createPlanCatalog([{ providerPlanId: "plan_pro_m", plan: "PRO", cycle: "MONTHLY" }]);

let fake: FakeBillingProvider;
let clock: Date;
let sequence = 0;
const now = () => clock;

const resolver = () =>
  new UnmatchedEventResolver({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog });

const webhooks = () =>
  new WebhookService({
    provider: () => fake,
    mode: () => "TEST",
    accountId: () => "acc_fake",
    unmatched: resolver(),
    sync: new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog }),
  });

const psubId = () => `sub_${PREFIX}${Date.now()}_${(sequence += 1)}`;

/** Ingests a signed event for `psub`, as Razorpay would deliver it. */
async function deliver(psub: string, eventType = "subscription.activated", extra: Record<string, unknown> = {}) {
  const body = fake.webhookBody({ eventType, providerSubscriptionId: psub, ...extra });
  const result = await webhooks().ingest({
    rawBody: Buffer.from(body),
    signature: fake.signWebhook(body),
    eventId: `evt_${PREFIX}${Date.now()}_${(sequence += 1)}`,
    receivedAt: clock,
  });

  if (result.status !== 200) throw new Error(`expected 200, got ${result.status}`);

  return result;
}

async function provisioning() {
  const userId = await createBillingUser(PREFIX);
  const sub = await insertBoundSubscription(userId, { phase: "PROVISIONING", providerSubscriptionId: null });
  const op = await insertOperation(userId, {
    subscriptionId: sub.id,
    kind: "CREATE_SUBSCRIPTION",
    status: "OUTCOME_UNKNOWN",
    requestSentAt: new Date(T0.getTime() - 60_000),
  });

  return { userId, sub, op };
}

const eventsFor = (psub: string) => prisma.billingEvent.findMany({ where: { providerSubscriptionId: psub } });
const anomalyFor = (psub: string) =>
  prisma.billingAnomaly.findFirst({ where: { subjectKey: AnomalySubject.providerSubscription(psub) } });

beforeEach(() => {
  clock = T0;
  fake = new FakeBillingProvider({ now });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("UnmatchedEventResolver — binding through notes", () => {
  it("binds a lost create: provider ID, BINDING history, the create settled, events linked, facts back-filled, state applied", async () => {
    const { userId, sub, op } = await provisioning();
    const psub = psubId();
    fake.seed({
      providerSubscriptionId: psub,
      rawStatus: "active",
      providerPlanId: "plan_pro_m",
      notes: { kz_sub: sub.id, kz_op: op.id, kz_env: "TEST" },
    });

    const recorded = await deliver(psub, "subscription.charged", { payment: { id: `pay_${PREFIX}${sequence}`, amount: 1000 } });
    expect(recorded.followUp.unmatchedProviderSubscriptionIds).toEqual([psub]);

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("BOUND");

    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      providerSubscriptionId: psub,
      phase: "ACTIVE",
      plan: "PRO",
    });
    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await eventsFor(psub)).toMatchObject([{ status: "RECORDED", subscriptionId: sub.id }]);
    expect(await prisma.billingMoneyFact.findFirst({ where: { billingEventId: recorded.billingEventId } })).toMatchObject({
      kind: "CHARGE",
      subscriptionId: sub.id,
      userId,
    });

    const history = await prisma.subscriptionHistoryEntry.findMany({ where: { subscriptionId: sub.id }, orderBy: { recordedAt: "asc" } });
    expect(history).toMatchObject([
      { change: "BINDING", toValue: psub, cause: "KIZUNIA_COMMAND", operationId: op.id, trigger: "WEBHOOK" },
      { change: "PHASE", fromValue: "PROVISIONING", toValue: "ACTIVE", trigger: "WEBHOOK" },
    ]);
  });

  it("runs from the webhook's follow-up", async () => {
    const { sub, op } = await provisioning();
    const psub = psubId();
    fake.seed({ providerSubscriptionId: psub, rawStatus: "created", providerPlanId: "plan_pro_m", notes: { kz_sub: sub.id, kz_op: op.id, kz_env: "TEST" } });

    const recorded = await deliver(psub, "subscription.authenticated");
    await webhooks().followUp(recorded.followUp);

    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({
      providerSubscriptionId: psub,
      phase: "PENDING_AUTHENTICATION",
    });
  });

  it("just links the events when the subscription was bound meanwhile", async () => {
    const userId = await createBillingUser(PREFIX);
    const psub = psubId();
    await deliver(psub);
    const sub = await insertBoundSubscription(userId, { providerSubscriptionId: psub });

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("LINKED");
    expect(await eventsFor(psub)).toMatchObject([{ status: "RECORDED", subscriptionId: sub.id }]);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).syncDueAt).toEqual(T0);
    expect(fake.calls).toEqual([]);
  });
});

describe("UnmatchedEventResolver — kept, never dropped, never guessed", () => {
  it("a subscription with no Kizunia notes is UNMATCHED with UNMATCHED_PROVIDER_SUBSCRIPTION", async () => {
    const psub = psubId();
    fake.seed({ providerSubscriptionId: psub, rawStatus: "active", notes: {} });
    await deliver(psub);

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("UNMATCHED");
    expect(await eventsFor(psub)).toMatchObject([{ status: "UNMATCHED", subscriptionId: null }]);
    expect(await anomalyFor(psub)).toMatchObject({ type: "UNMATCHED_PROVIDER_SUBSCRIPTION", providerSubscriptionId: psub });
  });

  it("notes naming the other mode raise PROVIDER_MODE_MISMATCH", async () => {
    const { sub } = await provisioning();
    const psub = psubId();
    fake.seed({ providerSubscriptionId: psub, rawStatus: "active", notes: { kz_sub: sub.id, kz_env: "LIVE" } });
    await deliver(psub);

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("UNMATCHED");
    expect(await anomalyFor(psub)).toMatchObject({ type: "PROVIDER_MODE_MISMATCH" });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).providerSubscriptionId).toBeNull();
  });

  it("notes naming a subscription that is not an unbound PROVISIONING one raise NOTES_CONFLICT", async () => {
    const userId = await createBillingUser(PREFIX);
    const active = await insertBoundSubscription(userId, { phase: "ACTIVE" });
    const psub = psubId();
    fake.seed({ providerSubscriptionId: psub, rawStatus: "active", notes: { kz_sub: active.id, kz_env: "TEST" } });
    await deliver(psub);

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("UNMATCHED");
    expect(await anomalyFor(psub)).toMatchObject({ type: "NOTES_CONFLICT", details: { notedSubscriptionId: active.id } });
  });

  it("a subscription the provider does not recognize is UNMATCHED", async () => {
    const psub = psubId();
    await deliver(psub);

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("UNMATCHED");
    expect(await anomalyFor(psub)).toMatchObject({ type: "UNMATCHED_PROVIDER_SUBSCRIPTION" });
  });

  it("a transient failure leaves the events pending", async () => {
    const psub = psubId();
    await deliver(psub);
    fake.failNext("fetchSubscription", "TIMEOUT");

    expect(await resolver().resolve(psub, ProviderPriority.CONFIRMATION)).toBe("RETRY");
    expect(await eventsFor(psub)).toMatchObject([{ status: "UNMATCHED_PENDING" }]);
    expect(await anomalyFor(psub)).toBeNull();
  });
});

describe("UnmatchedEventResolver.resolvePending — the tick's backstop", () => {
  it("resolves events after() did not, but leaves young ones to their own request", async () => {
    const old = psubId();
    fake.seed({ providerSubscriptionId: old, rawStatus: "active", notes: {} });
    await deliver(old);

    clock = new Date(T0.getTime() + 10 * 60_000);
    const young = psubId();
    await deliver(young);

    const counts = await resolver().resolvePending({ mode: "TEST", now: clock, deadline: new Date(clock.getTime() + 60_000) });

    expect(counts.UNMATCHED).toBeGreaterThanOrEqual(1);
    expect(await eventsFor(old)).toMatchObject([{ status: "UNMATCHED" }]);
    expect(await eventsFor(young)).toMatchObject([{ status: "UNMATCHED_PENDING" }]);
  });

  it("runs as part of billing:sync once nothing is due", async () => {
    const psub = psubId();
    fake.seed({ providerSubscriptionId: psub, rawStatus: "active", notes: {} });
    await deliver(psub);
    clock = new Date(T0.getTime() + 10 * 60_000);

    const task = new BillingSyncTask({
      sync: new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog }),
      health: () => null,
      resolvedMode: () => "TEST",
      now,
      unmatched: resolver(),
    });
    const result = await task.run({ budgetMs: 10_000 });

    expect(result).toMatchObject({ stoppedBy: "EMPTY" });
    expect(result.unmatched).toMatchObject({ UNMATCHED: expect.any(Number) });
    expect(await eventsFor(psub)).toMatchObject([{ status: "UNMATCHED" }]);
  });
});
