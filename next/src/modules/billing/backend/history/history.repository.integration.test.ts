import { afterAll, afterEach, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { deleteGrantsForUsers } from "@/testing/entitlement-fixtures";

import { historyTriggerFor, SubscriptionHistoryRepository } from "./history.repository";

const PREFIX = "__vitest_billing_history__";
const T = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes));

async function createSubscription() {
  const id = `${PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await prisma.user.create({ data: { id, name: "History Test", email: `${id}@example.test` } });

  return prisma.subscription.create({
    data: { userId: id, kind: "STANDARD", providerMode: "TEST", plan: "PRO", cycle: "MONTHLY", phase: "ACTIVE" },
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } });
  await deleteGrantsForUsers(users.map((u) => u.id));
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("SubscriptionHistoryRepository", () => {
  it("records entries, and finds when the current phase was entered", async () => {
    const sub = await createSubscription();
    const base = { subscriptionId: sub.id, userId: sub.userId, change: "PHASE" as const, cause: "PROVIDER_OBSERVED" as const };

    await SubscriptionHistoryRepository.record(prisma, [
      { ...base, fromValue: "PENDING_AUTHENTICATION", toValue: "ACTIVE", trigger: "WEBHOOK", observationAt: T(1) },
      { ...base, fromValue: "ACTIVE", toValue: "HALTED", trigger: "CHECKPOINT", observationAt: T(2) },
    ]);
    // Recorded later, so it is the latest entry to HALTED.
    await SubscriptionHistoryRepository.record(prisma, [
      { ...base, fromValue: "HALTED", toValue: "ACTIVE", trigger: "WEBHOOK", observationAt: T(3) },
      { ...base, fromValue: "ACTIVE", toValue: "HALTED", trigger: "HEARTBEAT", observationAt: T(4) },
    ]);

    expect(await prisma.subscriptionHistoryEntry.count({ where: { subscriptionId: sub.id } })).toBe(4);
    expect(await SubscriptionHistoryRepository.phaseEnteredAt(prisma, sub.id, "HALTED")).toEqual(T(4));
    expect(await SubscriptionHistoryRepository.phaseEnteredAt(prisma, sub.id, "PAUSED")).toBeNull();
  });

  it("finds the event behind a webhook-triggered sync: the latest received no later than the observation", async () => {
    const sub = await createSubscription();
    const event = (key: string, receivedAt: Date) =>
      prisma.billingEvent.create({
        data: {
          provider: "RAZORPAY",
          providerMode: "TEST",
          dedupeKey: `${PREFIX}${key}-${sub.id}`,
          dedupeSource: "HEADER",
          eventType: "subscription.halted",
          matchedSecret: "CURRENT",
          status: "RECORDED",
          subscriptionId: sub.id,
          receivedAt,
        },
      });

    const early = await event("a", T(1));
    const late = await event("b", T(5));

    expect(await SubscriptionHistoryRepository.triggeringEventId(prisma, sub.id, T(3))).toBe(early.id);
    expect(await SubscriptionHistoryRepository.triggeringEventId(prisma, sub.id, T(5))).toBe(late.id);
    expect(await SubscriptionHistoryRepository.triggeringEventId(prisma, sub.id, T(0))).toBeNull();
  });

  it("does nothing for an empty batch", async () => {
    await expect(SubscriptionHistoryRepository.record(prisma, [])).resolves.toBeUndefined();
  });
});

describe("historyTriggerFor", () => {
  it("maps each sync reason to how Kizunia found out", () => {
    expect(historyTriggerFor("WEBHOOK")).toBe("WEBHOOK");
    expect(historyTriggerFor("ADMIN")).toBe("ADMIN_SYNC");
    expect(historyTriggerFor("CHECKPOINT")).toBe("CHECKPOINT");
    expect(historyTriggerFor("HEARTBEAT")).toBe("HEARTBEAT");
    expect(historyTriggerFor("RETRY")).toBe("RETRY");
    expect(historyTriggerFor(null)).toBe("SYSTEM");
  });
});
