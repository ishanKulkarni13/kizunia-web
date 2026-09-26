/**
 * Fixtures for the Phase VIII admin billing tool tests.
 *
 * Builds on `billing-sync-fixtures.ts`: users are created with the suite's
 * prefix (so `cleanupBillingUsers(prefix)` removes them and their rows), and
 * every event, fact and anomaly written here carries the prefix in a key that
 * cleanup matches (`dedupeKey`, `providerObjectId`, `subjectKey`).
 */
import type { PlatformRole } from "@/authorization";
import type { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { createBillingUser } from "./billing-sync-fixtures";

/** A user in `role`, as the strict actor a service receives. */
export async function actorWithRole(prefix: string, role: PlatformRole) {
  const id = await createBillingUser(prefix, String(role).toLowerCase());
  await prisma.user.update({ where: { id }, data: { role } });

  return { id, role: String(role), banned: false };
}

function unique(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** A recorded webhook event, TEST mode, with a payload unless overridden. */
export async function insertBillingEvent(
  prefix: string,
  overrides: Partial<Prisma.BillingEventUncheckedCreateInput> = {},
) {
  return prisma.billingEvent.create({
    data: {
      provider: "RAZORPAY",
      providerMode: "TEST",
      dedupeKey: `evt_${unique(prefix)}`,
      dedupeSource: "HEADER",
      eventType: "subscription.charged",
      matchedSecret: "CURRENT",
      status: "RECORDED",
      rawPayload: { event: "subscription.charged" },
      ...overrides,
    },
  });
}

export async function insertMoneyFact(
  prefix: string,
  overrides: Partial<Prisma.BillingMoneyFactUncheckedCreateInput> = {},
) {
  return prisma.billingMoneyFact.create({
    data: {
      kind: "CHARGE",
      providerMode: "TEST",
      providerObjectId: `pay_${unique(prefix)}`,
      amountMinor: 49900,
      currency: "INR",
      occurredAt: new Date(),
      ...overrides,
    },
  });
}

export async function insertHistoryEntry(
  subscriptionId: string,
  userId: string | null,
  overrides: Partial<Prisma.SubscriptionHistoryEntryUncheckedCreateInput> = {},
) {
  return prisma.subscriptionHistoryEntry.create({
    data: {
      subscriptionId,
      userId,
      change: "PHASE",
      fromValue: "PROVISIONING",
      toValue: "ACTIVE",
      cause: "PROVIDER_OBSERVED",
      trigger: "WEBHOOK",
      ...overrides,
    },
  });
}

/** An open anomaly whose subject key carries the prefix. */
export async function insertAnomaly(
  prefix: string,
  overrides: Partial<Prisma.BillingAnomalyUncheckedCreateInput> = {},
) {
  return prisma.billingAnomaly.create({
    data: {
      type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
      providerMode: "TEST",
      subjectKey: `user:${unique(prefix)}`,
      details: { note: "fixture" },
      ...overrides,
    },
  });
}

/**
 * Captures every log record until `stop()`, through the logger's sink seam.
 * `text()` is every record serialized, for "this never appears in a log" checks.
 */
export async function captureLogs() {
  const { resetLogSink, setLogSink } = await import("@/lib/logger");
  const records: { level: string; event: string; fields: Readonly<Record<string, unknown>> }[] = [];

  setLogSink((record) => {
    records.push(record);
  });

  return {
    records,
    text: () => JSON.stringify(records),
    stop: () => resetLogSink(),
  };
}
