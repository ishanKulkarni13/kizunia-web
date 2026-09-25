/**
 * Billing persistence (Phase III) — the database facts the later phases rely on.
 *
 * The partial unique indexes and CHECKs are hand-written in migration
 * 20260925000000_add_billing_persistence, so the Prisma client does not know
 * about them. These tests prove they exist and do what the design says:
 *
 * - one IN_FLIGHT *root* operation per user; children run under it (IB-6);
 * - `(userId, idempotencyKey)` and `(providerMode, providerSubscriptionId)`;
 * - one open anomaly per `(type, subjectKey)`;
 * - a terminal subscription is never due;
 * - a user with any billing row cannot be hard-deleted (IB-14, Restrict).
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

const PREFIX = "__vitest_billing_schema__";

function unique(name: string): string {
  return `${PREFIX}-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(suffix: string): Promise<string> {
  const id = unique(suffix);
  await prisma.user.create({ data: { id, name: "Billing Schema Test", email: `${id}@example.test` } });
  return id;
}

async function cleanup() {
  const users = { startsWith: PREFIX };

  await prisma.subscriptionHistoryEntry.deleteMany({
    where: { OR: [{ userId: users }, { subscription: { userId: users } }, { subscription: { subjectPseudonym: users } }] },
  });
  await prisma.billingMoneyFact.deleteMany({ where: { providerObjectId: users } });
  await prisma.billingEvent.deleteMany({ where: { dedupeKey: users } });
  // Children before their roots: the self-FK is Restrict.
  await prisma.billingOperation.deleteMany({ where: { userId: users, parentOperationId: { not: null } } });
  await prisma.billingOperation.deleteMany({ where: { userId: users } });
  await prisma.billingAnomaly.deleteMany({ where: { subjectKey: users } });
  await prisma.subscription.deleteMany({ where: { OR: [{ userId: users }, { subjectPseudonym: users }] } });
  await prisma.user.deleteMany({ where: { id: users } });
}

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function subscriptionData(userId: string, overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  return {
    userId,
    kind: "STANDARD",
    providerMode: "TEST",
    plan: "PRO",
    cycle: "MONTHLY",
    ...overrides,
  } satisfies Prisma.SubscriptionUncheckedCreateInput;
}

function operationData(userId: string, overrides: Partial<Prisma.BillingOperationUncheckedCreateInput> = {}) {
  return {
    userId,
    kind: "CREATE_SUBSCRIPTION",
    providerMode: "TEST",
    actorKind: "USER",
    idempotencyKey: unique("key"),
    request: { plan: "PRO", cycle: "MONTHLY" },
    ...overrides,
  } satisfies Prisma.BillingOperationUncheckedCreateInput;
}

function anomalyData(subjectKey: string, overrides: Partial<Prisma.BillingAnomalyUncheckedCreateInput> = {}) {
  return {
    type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
    providerMode: "TEST",
    subjectKey,
    details: {},
    ...overrides,
  } satisfies Prisma.BillingAnomalyUncheckedCreateInput;
}

async function expectPrismaCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  expect((error as Prisma.PrismaClientKnownRequestError).code).toBe(code);
}

/** CHECK violations surface without a stable Prisma code; the constraint name is in the message. */
async function expectCheckViolation(promise: Promise<unknown>, constraint: string) {
  await expect(promise).rejects.toThrow(constraint);
}

describe("billing_operation: the per-user in-flight slot (IB-6)", () => {
  it("refuses a second IN_FLIGHT root operation for the same user", async () => {
    const user = await createUser("slot");
    await prisma.billingOperation.create({ data: operationData(user) });

    await expectPrismaCode(prisma.billingOperation.create({ data: operationData(user) }), "P2002");
  });

  it("accepts a child operation under the root's slot", async () => {
    const user = await createUser("child");
    const root = await prisma.billingOperation.create({ data: operationData(user, { kind: "SUPERSEDE" }) });

    const child = await prisma.billingOperation.create({
      data: operationData(user, { kind: "CANCEL_IMMEDIATELY", parentOperationId: root.id }),
    });

    expect(child.status).toBe("IN_FLIGHT");
  });

  it("frees the slot once the root is no longer IN_FLIGHT", async () => {
    const user = await createUser("freed");
    await prisma.billingOperation.create({ data: operationData(user, { status: "SUCCEEDED" }) });

    await expect(prisma.billingOperation.create({ data: operationData(user) })).resolves.toBeDefined();
  });

  it("does not couple different users", async () => {
    const first = await createUser("first");
    const second = await createUser("second");
    await prisma.billingOperation.create({ data: operationData(first) });

    await expect(prisma.billingOperation.create({ data: operationData(second) })).resolves.toBeDefined();
  });

  it("keeps idempotency keys unique per user", async () => {
    const user = await createUser("idem");
    const idempotencyKey = unique("same-key");
    await prisma.billingOperation.create({ data: operationData(user, { idempotencyKey, status: "SUCCEEDED" }) });

    await expectPrismaCode(
      prisma.billingOperation.create({ data: operationData(user, { idempotencyKey, status: "SUCCEEDED" }) }),
      "P2002",
    );
  });
});

describe("subscription", () => {
  it("binds a provider subscription id once per mode (SB-UQ-01)", async () => {
    const user = await createUser("bind");
    const providerSubscriptionId = unique("sub");
    await prisma.subscription.create({ data: subscriptionData(user, { providerSubscriptionId }) });

    await expectPrismaCode(
      prisma.subscription.create({ data: subscriptionData(user, { providerSubscriptionId }) }),
      "P2002",
    );
    // The same provider id in the other mode is a different object.
    await expect(
      prisma.subscription.create({ data: subscriptionData(user, { providerSubscriptionId, providerMode: "LIVE" }) }),
    ).resolves.toBeDefined();
  });

  it("allows many unbound (PROVISIONING) rows, and several open subscriptions per user", async () => {
    const user = await createUser("unbound");
    await prisma.subscription.create({ data: subscriptionData(user) });
    await prisma.subscription.create({ data: subscriptionData(user) });

    // SB-UQ-02 is a creation rule enforced in Phase V, not a DB constraint.
    expect(await prisma.subscription.count({ where: { userId: user } })).toBe(2);
  });

  it("refuses a terminal subscription that is still due for sync", async () => {
    const user = await createUser("terminal");

    for (const phase of ["CANCELLED", "EXPIRED", "COMPLETED", "ABANDONED"] as const) {
      await expectCheckViolation(
        prisma.subscription.create({ data: subscriptionData(user, { phase, syncDueAt: new Date() }) }),
        "subscription_terminal_not_due_check",
      );
    }

    await expect(
      prisma.subscription.create({ data: subscriptionData(user, { phase: "ACTIVE", syncDueAt: new Date() }) }),
    ).resolves.toBeDefined();
  });

  it("refuses a negative sync attempt counter", async () => {
    const user = await createUser("attempts");

    await expectCheckViolation(
      prisma.subscription.create({ data: subscriptionData(user, { syncAttempts: -1 }) }),
      "subscription_syncAttempts_non_negative_check",
    );
  });
});

describe("billing_anomaly: one open row per (type, subjectKey)", () => {
  it("refuses a second open anomaly and allows one after resolution", async () => {
    const subjectKey = unique("user");
    const first = await prisma.billingAnomaly.create({ data: anomalyData(subjectKey) });

    await expectPrismaCode(prisma.billingAnomaly.create({ data: anomalyData(subjectKey) }), "P2002");

    // A different type on the same subject is a different anomaly.
    await expect(
      prisma.billingAnomaly.create({ data: anomalyData(subjectKey, { type: "NOTES_CONFLICT" }) }),
    ).resolves.toBeDefined();

    await prisma.billingAnomaly.update({ where: { id: first.id }, data: { resolvedAt: new Date() } });
    await expect(prisma.billingAnomaly.create({ data: anomalyData(subjectKey) })).resolves.toBeDefined();
  });
});

describe("billing_event and money facts", () => {
  it("dedupes events per provider and facts per (mode, kind, object)", async () => {
    const dedupeKey = unique("evt");
    const event = {
      provider: "RAZORPAY",
      providerMode: "TEST",
      dedupeKey,
      dedupeSource: "HEADER",
      eventType: "subscription.charged",
      matchedSecret: "CURRENT",
      status: "RECORDED",
    } satisfies Prisma.BillingEventUncheckedCreateInput;
    await prisma.billingEvent.create({ data: event });

    await expectPrismaCode(prisma.billingEvent.create({ data: event }), "P2002");

    const fact = {
      kind: "CHARGE",
      providerMode: "TEST",
      providerObjectId: unique("pay"),
      amountMinor: 49900,
      currency: "INR",
      occurredAt: new Date(),
    } satisfies Prisma.BillingMoneyFactUncheckedCreateInput;
    await prisma.billingMoneyFact.create({ data: fact });

    await expectPrismaCode(prisma.billingMoneyFact.create({ data: fact }), "P2002");
  });

  it("restricts the dedupe source and matched secret to their value sets", async () => {
    const base = {
      provider: "RAZORPAY",
      providerMode: "TEST",
      eventType: "subscription.charged",
      status: "RECORDED",
    } as const;

    await expectCheckViolation(
      prisma.billingEvent.create({
        data: { ...base, dedupeKey: unique("evt"), dedupeSource: "GUESS", matchedSecret: "CURRENT" },
      }),
      "billing_event_dedupeSource_check",
    );
    await expectCheckViolation(
      prisma.billingEvent.create({
        data: { ...base, dedupeKey: unique("evt"), dedupeSource: "BODY_SHA256", matchedSecret: "OTHER" },
      }),
      "billing_event_matchedSecret_check",
    );
  });
});

describe("a user with billing rows cannot be hard-deleted (IB-14)", () => {
  const holders: Record<string, (userId: string) => Promise<unknown>> = {
    subscription: (userId) => prisma.subscription.create({ data: subscriptionData(userId) }),
    billing_operation: (userId) => prisma.billingOperation.create({ data: operationData(userId) }),
    billing_anomaly: (userId) =>
      prisma.billingAnomaly.create({ data: anomalyData(unique("anomaly"), { userId }) }),
    billing_money_fact: (userId) =>
      prisma.billingMoneyFact.create({
        data: {
          kind: "CHARGE",
          providerMode: "TEST",
          providerObjectId: unique("pay"),
          userId,
          amountMinor: 100,
          currency: "INR",
          occurredAt: new Date(),
        },
      }),
    subscription_history_entry: async (userId) => {
      // A pseudonymized subscription, so only the history entry references the user.
      const subscription = await prisma.subscription.create({
        data: subscriptionData(userId, { userId: null, subjectPseudonym: unique("pseudonym") }),
      });

      return prisma.subscriptionHistoryEntry.create({
        data: {
          subscriptionId: subscription.id,
          userId,
          change: "PHASE",
          cause: "LOCAL",
          trigger: "SYSTEM",
        },
      });
    },
  };

  for (const [table, hold] of Object.entries(holders)) {
    it(`refuses the delete while a ${table} row references the user`, async () => {
      const user = await createUser(table);
      await hold(user);

      // Postgres raises 23001 (restrict_violation) for `ON DELETE RESTRICT`,
      // which Prisma reports as an unknown request error rather than P2003.
      // Naming the constraint proves this table's own FK is what refused.
      await expect(prisma.user.delete({ where: { id: user } })).rejects.toThrow(
        new RegExp(String.raw`violates RESTRICT setting of foreign key constraint \W*${table}_userId_fkey`),
      );
      expect(await prisma.user.count({ where: { id: user } })).toBe(1);
    });
  }
});
