/**
 * Admin immediate cancel (SB-LC-05, IB-6 item 3, IB-15, IB-26 item 9):
 * MANAGE_BILLING only, a reason recorded on the operation, the customer's own
 * operation slot (409 while one of theirs is in flight), still available while
 * a multiple-subscriptions anomaly blocks the customer, and an answer carrying
 * no provider identifier.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlatformRole } from "@/authorization";
import type { SubscriptionPhase } from "@/generated/prisma";
import { resolveEffectiveAccess } from "@/lib/entitlements/resolver";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertOperation } from "@/testing/billing-sync-fixtures";
import { lifecycleCatalog, operationsOf, reloadSubscription, seedLive } from "@/testing/billing-lifecycle-fixtures";

import {
  BillingContactSupportError,
  BillingOperationInProgressError,
  SubscriptionNotCancellableError,
  SubscriptionNotFoundError,
} from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { AdminCancelService } from "./admin-cancel";
import { CancelSubscriptionCommand } from "./cancel";
import { CommandRunner } from "./command-runner";

const PREFIX = "__vitest_billing_admin_cancel__";

let fake: FakeBillingProvider;
let clock: Date;
let providerTick = 0;
let keys = 0;
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));
const runner = () =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog: lifecycleCatalog });
const service = () => new AdminCancelService(runner());
const key = () => `key_${PREFIX}${Date.now()}_${(keys += 1)}`;

async function actor(role: string) {
  const id = await createBillingUser(PREFIX, role.toLowerCase());
  await prisma.user.update({ where: { id }, data: { role } });

  return { id, role, banned: false };
}

async function customer(phase: SubscriptionPhase = "ACTIVE") {
  const userId = await createBillingUser(PREFIX, "customer");
  const row = await seedLive(fake, userId, { phase, now: clock });

  return { userId, row };
}

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("Admin cancel — authorization (IB-15: MANAGE_BILLING is SUPER_ADMIN only)", () => {
  it.each([PlatformRole.ADMIN, PlatformRole.MODERATOR, PlatformRole.USER])("refuses %s, writing and sending nothing", async (role) => {
    const admin = await actor(role);
    const { userId, row } = await customer();

    await expect(service().cancel(admin, row.id, { reason: "support case" }, key())).rejects.toMatchObject({ status: 403 });

    expect(fake.calls).toHaveLength(0);
    expect(await operationsOf(userId)).toHaveLength(0);
  });
});

describe("Admin cancel — a recorded immediate cancel", () => {
  it.each<SubscriptionPhase>(["ACTIVE", "TRIALING", "PAST_DUE", "HALTED", "PAUSED", "PENDING_AUTHENTICATION"])(
    "cancels a %s subscription immediately, observed, with the reason on the operation",
    async (phase) => {
      const admin = await actor(PlatformRole.SUPER_ADMIN);
      const { userId, row } = await customer(phase);

      const result = await service().cancel(admin, row.id, { reason: "chargeback, customer request" }, key());

      expect(result).toEqual({ status: "CANCELLED", operationId: expect.any(String), subscriptionId: row.id, phase: "CANCELLED" });
      expect(fake.calls.find((call) => call.method === "cancelSubscription")?.args[1]).toEqual({ atCycleEnd: false });
      expect((await operationsOf(userId))[0]).toMatchObject({
        userId,
        kind: "CANCEL_IMMEDIATELY",
        status: "SUCCEEDED",
        actorKind: "ADMIN",
        actorUserId: admin.id,
        request: { atCycleEnd: false, reason: "ADMIN_CANCEL", note: "chargeback, customer request" },
      });
      expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED" });
      expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: clock })).plan).toBe("FREE");
    },
  );

  it("overrides a requested cycle-end cancellation, clearing the flag on the observed cancellation", async () => {
    const admin = await actor(PlatformRole.SUPER_ADMIN);
    const { row } = await customer();
    await prisma.subscription.update({ where: { id: row.id }, data: { cancelAtPeriodEnd: true, cancelRequestedAt: clock } });

    await service().cancel(admin, row.id, { reason: "immediate refund agreed" }, key());

    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED", cancelAtPeriodEnd: false });
  });

  it("stays available while a multiple-subscriptions anomaly blocks the customer (SB-UQ-05)", async () => {
    const admin = await actor(PlatformRole.SUPER_ADMIN);
    const { userId, row } = await customer();
    await prisma.billingAnomaly.create({
      data: { type: "MULTIPLE_OPEN_SUBSCRIPTIONS", providerMode: "TEST", userId, subjectKey: AnomalySubject.user(userId), details: {} },
    });

    await expect(
      runner().run(new CancelSubscriptionCommand("CYCLE_END"), { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey: key() }),
    ).rejects.toBeInstanceOf(BillingContactSupportError);
    expect((await service().cancel(admin, row.id, { reason: "resolving duplicate" }, key())).status).toBe("CANCELLED");
  });

  it("gets 409 while the customer's own operation is in flight (the same slot, IB-6 item 3)", async () => {
    const admin = await actor(PlatformRole.SUPER_ADMIN);
    const { userId, row } = await customer();
    await insertOperation(userId, { kind: "CHANGE_PLAN", status: "IN_FLIGHT", leaseUntil: new Date(clock.getTime() + 60_000), createdAt: clock });

    await expect(service().cancel(admin, row.id, { reason: "support" }, key())).rejects.toBeInstanceOf(BillingOperationInProgressError);
    expect(fake.calls).toHaveLength(0);
  });

  it("returns the recorded result for a same-key retry, sending once", async () => {
    const admin = await actor(PlatformRole.SUPER_ADMIN);
    const { row } = await customer();
    const idempotencyKey = key();

    const first = await service().cancel(admin, row.id, { reason: "support" }, idempotencyKey);
    const retry = await service().cancel(admin, row.id, { reason: "support" }, idempotencyKey);

    expect(retry).toEqual(first);
    expect(fake.calls.filter((call) => call.method === "cancelSubscription")).toHaveLength(1);
  });

  it("refuses a subscription still being set up, an ended one, and an unknown ID", async () => {
    const admin = await actor(PlatformRole.SUPER_ADMIN);
    const { userId } = await customer("CANCELLED");
    const ended = await prisma.subscription.findFirstOrThrow({ where: { userId } });
    const provisioning = await prisma.subscription.create({
      data: { userId, kind: "STANDARD", providerMode: "TEST", plan: "PRO", cycle: "MONTHLY", phase: "PROVISIONING" },
    });

    await expect(service().cancel(admin, ended.id, { reason: "support" }, key())).rejects.toBeInstanceOf(SubscriptionNotCancellableError);
    await expect(service().cancel(admin, provisioning.id, { reason: "support" }, key())).rejects.toBeInstanceOf(SubscriptionNotCancellableError);
    await expect(service().cancel(admin, "no-such-subscription", { reason: "support" }, key())).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    expect(fake.calls).toHaveLength(0);
  });

  it("answers without any provider identifier", async () => {
    const admin = await actor(PlatformRole.SUPER_ADMIN);
    const { row } = await customer();

    const result = await service().cancel(admin, row.id, { reason: "support" }, key());

    expect(JSON.stringify(result)).not.toContain(row.providerSubscriptionId!);
  });
});
