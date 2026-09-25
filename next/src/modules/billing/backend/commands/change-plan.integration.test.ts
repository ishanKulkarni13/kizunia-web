/**
 * ChangePlan through the command runner, against real Postgres and the fake
 * provider (upgrade-downgrade.md, IB-21, IB-26 items 6 and 7): upgrades now,
 * downgrades at cycle end, a pending change cancelled first, access only from
 * the observed plan, the V1 limitation sending nothing, and Razorpay's
 * refusal authoritative: nothing changes, it is never retried, and it
 * corrects the advisory.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";
import { resolveEffectiveAccess } from "@/lib/entitlements/resolver";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser } from "@/testing/billing-sync-fixtures";
import { historyOf, lifecycleCatalog, operationsOf, reloadSubscription, seedLive, type SeedLiveOptions } from "@/testing/billing-lifecycle-fixtures";

import {
  BillingBusyError,
  CancellationRequestedError,
  NoSubscriptionError,
  PlanChangeUnavailableError,
  SamePlanError,
} from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority } from "../../provider/types";
import { SyncService } from "../sync/sync.service";
import { ChangePlanCommand, type ChangePlanResult } from "./change-plan";
import { CommandRunner } from "./command-runner";

const PREFIX = "__vitest_billing_change_plan__";
const INTL = { advisoryPaymentMethod: "card", advisoryInternationalCard: true } as const;

let fake: FakeBillingProvider;
let clock: Date;
let providerTick = 0;
let keys = 0;
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));

const runner = () =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog: lifecycleCatalog });
const key = () => `key_${PREFIX}${Date.now()}_${(keys += 1)}`;

function change(userId: string, plan: "PRO" | "PRO_PLUS", cycle: "MONTHLY" | "YEARLY", idempotencyKey = key()): Promise<ChangePlanResult> {
  return runner().run(new ChangePlanCommand({ plan, cycle }), { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey });
}

async function live(options: Omit<SeedLiveOptions, "now">) {
  const userId = await createBillingUser(PREFIX);
  const row = await seedLive(fake, userId, { now: clock, ...options });

  return { userId, row };
}

const methods = () => fake.calls.map((call) => call.method);
const access = async (userId: string) => (await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: clock })).plan;
const sync = () => new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog: lifecycleCatalog });

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("ChangePlan — native update where Razorpay allows it", () => {
  it("upgrades now; access follows the observed plan", async () => {
    const { userId, row } = await live({ phase: "ACTIVE", ...INTL });

    const result = await change(userId, "PRO_PLUS", "MONTHLY");

    expect(result).toMatchObject({ status: "UPGRADED", plan: "PRO_PLUS", cycle: "MONTHLY" });
    expect(methods()).toEqual(["updateSubscriptionPlan", "fetchSubscription"]);
    expect(fake.calls[0].args[1]).toEqual({ plan: "PRO_PLUS", cycle: "MONTHLY", scheduleChangeAt: "NOW" });
    expect(await reloadSubscription(row.id)).toMatchObject({ plan: "PRO_PLUS", cycle: "MONTHLY" });
    expect(await access(userId)).toBe("PRO_PLUS");

    const operations = await operationsOf(userId);
    const root = operations.find((operation) => operation.parentOperationId === null)!;

    expect(root).toMatchObject({ kind: "CHANGE_PLAN", status: "SUCCEEDED", subscriptionId: row.id, request: { plan: "PRO_PLUS", cycle: "MONTHLY" } });
    expect(operations.find((operation) => operation.kind === "UPDATE_PLAN")).toMatchObject({
      status: "SUCCEEDED",
      parentOperationId: root.id,
      request: { plan: "PRO_PLUS", cycle: "MONTHLY", scheduleChangeAt: "NOW" },
    });
    expect(await historyOf(row.id)).toContainEqual(
      expect.objectContaining({ change: "PLAN", fromValue: "PRO/MONTHLY", toValue: "PRO_PLUS/MONTHLY", cause: "KIZUNIA_COMMAND" }),
    );
  });

  it("treats a longer cycle at a higher price as an upgrade (SB-LC-02)", async () => {
    const { userId } = await live({ phase: "ACTIVE", ...INTL });

    await change(userId, "PRO", "YEARLY");

    expect(fake.calls[0].args[1]).toMatchObject({ scheduleChangeAt: "NOW" });
  });

  it("allows an upgrade while TRIALING", async () => {
    const { userId } = await live({ phase: "TRIALING", ...INTL });

    expect((await change(userId, "PRO_PLUS", "MONTHLY")).status).toBe("UPGRADED");
  });

  it("schedules a downgrade at cycle end, mirrored on the subscription; access is unchanged until then", async () => {
    const { userId, row } = await live({ phase: "ACTIVE", plan: "PRO_PLUS", ...INTL });

    const result = await change(userId, "PRO", "MONTHLY");

    expect(result).toMatchObject({ status: "SCHEDULED", plan: "PRO", cycle: "MONTHLY", effectiveAt: row.currentPeriodEnd!.toISOString() });
    expect(fake.calls[0].args[1]).toEqual({ plan: "PRO", cycle: "MONTHLY", scheduleChangeAt: "CYCLE_END" });

    const after = await reloadSubscription(row.id);
    const update = (await operationsOf(userId)).find((operation) => operation.kind === "UPDATE_PLAN")!;

    expect(after).toMatchObject({ plan: "PRO_PLUS", scheduledPlan: "PRO", scheduledCycle: "MONTHLY", scheduledByOperationId: update.id });
    expect(await access(userId)).toBe("PRO_PLUS");
    expect((await historyOf(row.id)).filter((entry) => entry.change === "SCHEDULED_CHANGE")).toEqual([
      expect.objectContaining({ fromValue: null, toValue: "PRO/MONTHLY", cause: "KIZUNIA_COMMAND" }),
    ]);
  });

  it("answers the same scheduled change from local state, with no provider call", async () => {
    const { userId } = await live({ phase: "ACTIVE", plan: "PRO_PLUS", ...INTL });

    await change(userId, "PRO", "MONTHLY");
    const calls = fake.calls.length;

    expect((await change(userId, "PRO", "MONTHLY")).status).toBe("SCHEDULED");
    expect(fake.calls).toHaveLength(calls);
  });

  it("cancels a pending change first, confirmed by sync, then upgrades (SB-LC-08)", async () => {
    const { userId, row } = await live({
      phase: "ACTIVE",
      plan: "PRO_PLUS",
      ...INTL,
      provider: { hasScheduledChanges: true },
      row: { scheduledPlan: "PRO", scheduledCycle: "MONTHLY", providerSnapshot: { hasScheduledChanges: true } },
    });

    const result = await change(userId, "PRO_PLUS", "YEARLY");

    expect(result.status).toBe("UPGRADED");
    expect(methods()).toEqual(["cancelScheduledChange", "fetchSubscription", "updateSubscriptionPlan", "fetchSubscription"]);
    expect(await reloadSubscription(row.id)).toMatchObject({ plan: "PRO_PLUS", cycle: "YEARLY", scheduledPlan: null });

    const kinds = (await operationsOf(userId)).map((operation) => [operation.kind, operation.status]);
    expect(kinds).toEqual([
      ["CHANGE_PLAN", "SUCCEEDED"],
      ["CANCEL_SCHEDULED_CHANGE", "SUCCEEDED"],
      ["UPDATE_PLAN", "SUCCEEDED"],
    ]);
  });

  it("sends no update when the cleared change is not visible yet", async () => {
    const { userId } = await live({
      phase: "ACTIVE",
      plan: "PRO_PLUS",
      ...INTL,
      provider: { hasScheduledChanges: true },
      row: { scheduledPlan: "PRO", scheduledCycle: "MONTHLY", providerSnapshot: { hasScheduledChanges: true } },
    });
    fake.acceptWithoutEffect("cancelScheduledChange");

    expect((await change(userId, "PRO_PLUS", "YEARLY")).status).toBe("CONFIRMING");
    expect(methods()).not.toContain("updateSubscriptionPlan");
  });
});

describe("ChangePlan — refused, unavailable, unknown", () => {
  it("treats Razorpay's refusal as authoritative: nothing changes, never retried, and the advisory is corrected", async () => {
    const { userId, row } = await live({ phase: "ACTIVE", advisoryPaymentMethod: "card", advisoryInternationalCard: null });
    fake.failNext("updateSubscriptionPlan", "REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });

    await expect(change(userId, "PRO_PLUS", "MONTHLY")).rejects.toMatchObject({
      code: new PlanChangeUnavailableError("PROVIDER_REFUSED").code,
      details: { reason: "PROVIDER_REFUSED" },
    });

    expect(await reloadSubscription(row.id)).toMatchObject({ plan: "PRO", cycle: "MONTHLY", scheduledPlan: null, advisoryInternationalCard: false });
    expect(fake.calls.filter((call) => call.method === "updateSubscriptionPlan")).toHaveLength(1);
    expect((await operationsOf(userId)).find((operation) => operation.parentOperationId === null)).toMatchObject({ status: "REJECTED", failureClass: "REJECTED" });

    // Corrected: the next request is answered locally with the V1 limitation, and nothing is sent.
    await expect(change(userId, "PRO_PLUS", "YEARLY")).rejects.toMatchObject({ details: { reason: "PAYMENT_METHOD" } });
    expect(fake.calls.filter((call) => call.method === "updateSubscriptionPlan")).toHaveLength(1);
  });

  it("answers 'another operation in progress' with a retry and changes nothing, not even the advisory", async () => {
    const { userId, row } = await live({ phase: "ACTIVE", ...INTL });
    fake.failNext("updateSubscriptionPlan", "CONCURRENT_OPERATION");

    await expect(change(userId, "PRO_PLUS", "MONTHLY")).rejects.toBeInstanceOf(BillingBusyError);
    expect(await reloadSubscription(row.id)).toMatchObject({ plan: "PRO", advisoryInternationalCard: true });
  });

  it.each([
    ["UPI", { advisoryPaymentMethod: "upi" }],
    ["e-mandate", { advisoryPaymentMethod: "emandate" }],
    ["a domestic card", { advisoryPaymentMethod: "card", advisoryInternationalCard: false }],
  ] as const)("sends nothing for %s: the documented V1 limitation", async (_label, advisory) => {
    const { userId } = await live({ phase: "ACTIVE", ...advisory });

    await expect(change(userId, "PRO_PLUS", "MONTHLY")).rejects.toMatchObject({ details: { reason: "PAYMENT_METHOD" } });
    expect(fake.calls).toHaveLength(0);
    expect((await operationsOf(userId))[0]).toMatchObject({ kind: "CHANGE_PLAN", status: "REJECTED", failureClass: null });
  });

  it.each<SubscriptionPhase>(["PAST_DUE", "HALTED", "PAUSED"])("is unavailable while %s (Razorpay would refuse too)", async (phase) => {
    const { userId } = await live({ phase, ...INTL });

    await expect(change(userId, "PRO_PLUS", "MONTHLY")).rejects.toMatchObject({ details: { reason: "SUBSCRIPTION_STATE" } });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a change after a cycle-end cancellation was requested", async () => {
    const { userId } = await live({ phase: "ACTIVE", ...INTL, row: { cancelAtPeriodEnd: true } });

    await expect(change(userId, "PRO_PLUS", "MONTHLY")).rejects.toBeInstanceOf(CancellationRequestedError);
  });

  it("refuses the current plan, and a user with nothing paid", async () => {
    const { userId } = await live({ phase: "ACTIVE", ...INTL });
    const free = await createBillingUser(PREFIX, "free");

    await expect(change(userId, "PRO", "MONTHLY")).rejects.toBeInstanceOf(SamePlanError);
    await expect(change(free, "PRO", "MONTHLY")).rejects.toBeInstanceOf(NoSubscriptionError);
  });

  it("settles an unknown upgrade by the next observation, never re-sending it", async () => {
    const { userId, row } = await live({ phase: "ACTIVE", ...INTL });
    fake.failNext("updateSubscriptionPlan", "TIMEOUT", { afterApplying: true });

    expect((await change(userId, "PRO_PLUS", "MONTHLY")).status).toBe("CONFIRMING");
    expect(await access(userId)).toBe("PRO");

    clock = new Date(clock.getTime() + 1000);
    await sync().syncTargeted(row.id, ProviderPriority.RECONCILIATION, { trigger: "RETRY" });

    expect((await operationsOf(userId)).find((operation) => operation.kind === "UPDATE_PLAN")).toMatchObject({ status: "SUCCEEDED" });
    expect(await access(userId)).toBe("PRO_PLUS");
    expect(fake.calls.filter((call) => call.method === "updateSubscriptionPlan")).toHaveLength(1);
  });

  it("settles an unknown downgrade by the provider flag, adopting its target", async () => {
    const { userId, row } = await live({ phase: "ACTIVE", plan: "PRO_PLUS", ...INTL });
    fake.failNext("updateSubscriptionPlan", "TIMEOUT", { afterApplying: true });

    await change(userId, "PRO", "YEARLY");
    clock = new Date(clock.getTime() + 1000);
    await sync().syncTargeted(row.id, ProviderPriority.RECONCILIATION, { trigger: "RETRY" });

    expect(await reloadSubscription(row.id)).toMatchObject({ plan: "PRO_PLUS", scheduledPlan: "PRO", scheduledCycle: "YEARLY" });
  });
});
