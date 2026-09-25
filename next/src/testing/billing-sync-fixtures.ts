/**
 * Fixtures for the billing sync, webhook and reconciliation integration tests.
 *
 * Phase IV's tests need subscriptions *bound* to a provider subscription, in
 * any phase and sync state, plus the users that own them, and a way to remove
 * every billing row they produce. Rows are written directly: these set up the
 * scene, and the code under test writes the rest.
 *
 * Every user this creates has an id and email starting with the suite's
 * prefix, and `cleanupBillingUsers(prefix)` removes them and all their billing
 * rows (through `deleteGrantsForUsers`, which knows the FK order), plus events
 * and anomalies keyed by that prefix that no subscription holds.
 */
import type { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { deleteGrantsForUsers } from "./entitlement-fixtures";

export async function createBillingUser(prefix: string, name = "user"): Promise<string> {
  const id = `${prefix}${name}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  await prisma.user.create({ data: { id, name: "Billing Sync Test", email: `${id}@example.test` } });

  return id;
}

/** A unique provider subscription ID that still reads as one (`sub_…`). */
export function providerSubscriptionIdFor(prefix: string): string {
  return `sub_${prefix}${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}

/**
 * A subscription bound to a provider ID, `ACTIVE` in TEST on a PRO monthly
 * plan unless overridden.
 */
export async function insertBoundSubscription(
  userId: string,
  overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {},
) {
  return prisma.subscription.create({
    data: {
      userId,
      kind: "STANDARD",
      providerMode: "TEST",
      plan: "PRO",
      cycle: "MONTHLY",
      phase: "ACTIVE",
      providerSubscriptionId: providerSubscriptionIdFor(userId.slice(0, 12)),
      ...overrides,
    },
  });
}

export async function insertOperation(
  userId: string,
  overrides: Partial<Prisma.BillingOperationUncheckedCreateInput> = {},
) {
  return prisma.billingOperation.create({
    data: {
      userId,
      kind: "CANCEL_IMMEDIATELY",
      providerMode: "TEST",
      actorKind: "USER",
      idempotencyKey: `key-${Date.now()}-${Math.random()}`,
      request: {},
      ...overrides,
    },
  });
}

/** Removes every user with the prefix and all their billing rows, plus prefixed orphans. */
export async function cleanupBillingUsers(prefix: string): Promise<void> {
  const users = await prisma.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });

  // Events and facts not linked to a subscription (unmatched), keyed by the prefix.
  await prisma.subscriptionHistoryEntry.deleteMany({
    where: { billingEvent: { providerSubscriptionId: { contains: prefix } } },
  });
  await prisma.billingMoneyFact.deleteMany({
    where: {
      OR: [
        { providerObjectId: { contains: prefix } },
        { billingEvent: { providerSubscriptionId: { contains: prefix } } },
      ],
    },
  });
  await deleteGrantsForUsers(users.map((user) => user.id));
  await prisma.billingEvent.deleteMany({
    where: { OR: [{ providerSubscriptionId: { contains: prefix } }, { dedupeKey: { contains: prefix } }] },
  });
  await prisma.billingAnomaly.deleteMany({ where: { subjectKey: { contains: prefix } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
}
