/**
 * Customer cancellation through the command runner, against real Postgres and
 * the fake provider: the cancel matrix per phase (IB-1: PAST_DUE is
 * immediate), a cycle-end cancel recorded as a request and never as an
 * observation (I-1), the scheduled change cleared first (SB-LC-08),
 * idempotency, provider refusals and unknown outcomes, and races with
 * webhooks, sync and a second request.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";
import { resolveEffectiveAccess } from "@/lib/entitlements/resolver";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser } from "@/testing/billing-sync-fixtures";
import { historyOf, lifecycleCatalog, operationsOf, reloadSubscription, seedLive } from "@/testing/billing-lifecycle-fixtures";

import {
  BillingBusyError,
  BillingConfirmingError,
  BillingContactSupportError,
  BillingOperationInProgressError,
  BillingUnavailableError,
  CancellationFailedError,
  CancellationTimingChangedError,
  CheckoutInProgressError,
  NoSubscriptionError,
} from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { applyObservation } from "../sync/apply";
import { CancelSubscriptionCommand, type CancelResult } from "./cancel";
import { CommandRunner, type CommandRunnerDeps } from "./command-runner";

const PREFIX = "__vitest_billing_cancel__";
const MINUTE = 60_000;

let fake: FakeBillingProvider;
let clock: Date;
let providerTick = 0;
let keys = 0;
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));

const runner = (deps: CommandRunnerDeps = {}) =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog: lifecycleCatalog, ...deps });

const key = () => `key_${PREFIX}${Date.now()}_${(keys += 1)}`;

function cancel(userId: string, timing: "CYCLE_END" | "IMMEDIATE", idempotencyKey = key(), commandRunner = runner()): Promise<CancelResult> {
  return commandRunner.run(new CancelSubscriptionCommand(timing), { actor: { userId, actorKind: "USER", actorUserId: userId }, idempotencyKey });
}

const cancelCalls = () => fake.calls.filter((call) => call.method === "cancelSubscription");
const access = async (userId: string) => (await resolveEffectiveAccess(userId, { expectedMode: "TEST", now: clock })).plan;

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("Cancel — ACTIVE: at cycle end, recorded as a request (I-1)", () => {
  it("sends the cycle-end form and records Kizunia's request, not an observation; access continues", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "ACTIVE", now: clock });

    const result = await cancel(userId, "CYCLE_END");

    expect(result).toMatchObject({ status: "CANCELLATION_REQUESTED", endsAt: row.currentPeriodEnd!.toISOString() });
    expect(cancelCalls()).toHaveLength(1);
    expect(cancelCalls()[0].args[1]).toEqual({ atCycleEnd: true });

    const [operation] = await operationsOf(userId);
    const after = await reloadSubscription(row.id);

    expect(operation).toMatchObject({
      kind: "CANCEL_AT_CYCLE_END",
      status: "SUCCEEDED",
      subscriptionId: row.id,
      request: { atCycleEnd: true, periodEnd: row.currentPeriodEnd!.toISOString() },
    });
    expect(after).toMatchObject({
      phase: "ACTIVE",
      cancelAtPeriodEnd: true,
      cancelRequestedAt: operation.requestSentAt,
      cancelRequestedByOperationId: operation.id,
    });
    expect(await historyOf(row.id)).toContainEqual(
      expect.objectContaining({ change: "CANCEL_AT_PERIOD_END", fromValue: "false", toValue: "true", cause: "KIZUNIA_COMMAND", operationId: operation.id }),
    );
    expect(await access(userId)).toBe("PRO");
  });

  it("answers a repeated request from local state: no provider call, no new operation (no undo, SB-LC-09)", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "ACTIVE", now: clock });

    const first = await cancel(userId, "CYCLE_END");
    const again = await cancel(userId, "CYCLE_END");

    expect(again).toMatchObject({ status: "CANCELLATION_REQUESTED", operationId: first.operationId });
    expect(cancelCalls()).toHaveLength(1);
    expect(await operationsOf(userId)).toHaveLength(1);
  });

  it("returns the recorded result for a same-key retry, never re-sending", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "ACTIVE", now: clock });
    const idempotencyKey = key();

    const first = await cancel(userId, "CYCLE_END", idempotencyKey);
    const retry = await cancel(userId, "CYCLE_END", idempotencyKey);

    expect(retry).toEqual(first);
    expect(cancelCalls()).toHaveLength(1);
  });

  it("cancels a pending scheduled change first, confirmed by sync (SB-LC-08)", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, {
      phase: "ACTIVE",
      plan: "PRO_PLUS",
      now: clock,
      provider: { hasScheduledChanges: true },
      row: { scheduledPlan: "PRO", scheduledCycle: "MONTHLY", providerSnapshot: { hasScheduledChanges: true } },
    });

    const result = await cancel(userId, "CYCLE_END");

    expect(result.status).toBe("CANCELLATION_REQUESTED");
    expect(fake.calls.map((call) => call.method)).toEqual(["cancelScheduledChange", "fetchSubscription", "cancelSubscription"]);

    const operations = await operationsOf(userId);
    const root = operations.find((operation) => operation.parentOperationId === null)!;

    expect(operations.find((operation) => operation.kind === "CANCEL_SCHEDULED_CHANGE")).toMatchObject({ status: "SUCCEEDED", parentOperationId: root.id });
    expect(await reloadSubscription(row.id)).toMatchObject({ scheduledPlan: null, cancelAtPeriodEnd: true, plan: "PRO_PLUS" });
  });

  it("stops with CONFIRMING, sending no cancel, when the cleared change is not visible yet", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, {
      phase: "ACTIVE",
      now: clock,
      provider: { hasScheduledChanges: true },
      row: { scheduledPlan: "PRO", scheduledCycle: "YEARLY", providerSnapshot: { hasScheduledChanges: true } },
    });
    fake.failNext("cancelScheduledChange", "TIMEOUT");

    const result = await cancel(userId, "CYCLE_END");

    expect(result.status).toBe("CONFIRMING");
    expect(cancelCalls()).toHaveLength(0);
    expect((await operationsOf(userId)).find((operation) => operation.parentOperationId === null)).toMatchObject({ status: "REJECTED", failureClass: null });
  });

  it("does not set the flag when the response shows the subscription left ACTIVE: a no-op by I-2", async () => {
    const userId = await createBillingUser(PREFIX);
    // Local state still says ACTIVE; Razorpay already halted it.
    const row = await seedLive(fake, userId, { phase: "ACTIVE", now: clock, provider: { rawStatus: "halted" } });

    await expect(cancel(userId, "CYCLE_END")).rejects.toMatchObject({ code: new CancellationTimingChangedError("IMMEDIATE").code, details: { timing: "IMMEDIATE" } });

    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "HALTED", cancelAtPeriodEnd: false });
    expect(await prisma.billingAnomaly.findFirst({ where: { subjectKey: AnomalySubject.subscription(row.id) } })).toMatchObject({
      type: "CANCELLATION_NOT_EFFECTIVE",
      details: expect.objectContaining({ reason: "SENT_OUTSIDE_ACTIVE" }),
    });
  });

  it("answers CONFIRMING and sets no flag for an unknown outcome; the user is blocked while it is young", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "ACTIVE", now: clock });
    fake.failNext("cancelSubscription", "TIMEOUT");

    expect((await cancel(userId, "CYCLE_END")).status).toBe("CONFIRMING");
    expect(await reloadSubscription(row.id)).toMatchObject({ cancelAtPeriodEnd: false });
    expect((await operationsOf(userId))[0]).toMatchObject({ status: "OUTCOME_UNKNOWN", failureClass: "TIMEOUT" });

    await expect(cancel(userId, "CYCLE_END")).rejects.toBeInstanceOf(BillingConfirmingError);
    expect(cancelCalls()).toHaveLength(1);
  });

  it("lets the customer re-issue after the resolution window (A14: a repeat is harmless)", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "ACTIVE", now: clock });
    fake.failNext("cancelSubscription", "TIMEOUT");

    await cancel(userId, "CYCLE_END");
    clock = new Date(clock.getTime() + 60 * MINUTE);

    expect((await cancel(userId, "CYCLE_END")).status).toBe("CANCELLATION_REQUESTED");
    expect(await reloadSubscription(row.id)).toMatchObject({ cancelAtPeriodEnd: true });
    expect(cancelCalls()).toHaveLength(2);
  });
});

describe("Cancel — immediate phases", () => {
  it.each<[SubscriptionPhase, string]>([
    ["PAST_DUE", "FREE"],
    ["TRIALING", "FREE"],
    ["HALTED", "FREE"],
    ["PAUSED", "FREE"],
  ])("cancels %s immediately and ends access only once cancellation is observed", async (phase, planAfter) => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase, now: clock });

    const result = await cancel(userId, "IMMEDIATE");

    expect(result.status).toBe("CANCELLED");
    expect(cancelCalls()[0].args[1]).toEqual({ atCycleEnd: false });
    expect((await operationsOf(userId))[0]).toMatchObject({ kind: "CANCEL_IMMEDIATELY", status: "SUCCEEDED", request: { atCycleEnd: false, reason: "CUSTOMER_CANCEL" } });
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED", cancelAtPeriodEnd: false });
    expect(await access(userId)).toBe(planAfter);
    expect(await historyOf(row.id)).toContainEqual(expect.objectContaining({ change: "PHASE", toValue: "CANCELLED", cause: "KIZUNIA_COMMAND" }));
  });

  it("never sends a cycle-end cancel for PAST_DUE: the acknowledged timing must be immediate (IB-1)", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "PAST_DUE", now: clock });

    await expect(cancel(userId, "CYCLE_END")).rejects.toBeInstanceOf(CancellationTimingChangedError);

    expect(cancelCalls()).toHaveLength(0);
    // A local refusal is recorded (IB-25 item 3): nothing was sent.
    expect((await operationsOf(userId))[0]).toMatchObject({ kind: "CANCEL_AT_CYCLE_END", status: "REJECTED", failureClass: null, requestSentAt: null });
  });

  it("abandons a pending checkout", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PENDING_AUTHENTICATION", now: clock });

    expect((await cancel(userId, "IMMEDIATE")).status).toBe("CANCELLED");
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED" });
  });

  it("answers CONFIRMING, and settles by the next observation, when the answer is lost after Razorpay applied it", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PAST_DUE", now: clock });
    fake.failNext("cancelSubscription", "TIMEOUT", { afterApplying: true });

    const result = await cancel(userId, "IMMEDIATE");

    // The confirming fetch already observed `cancelled`, which settles the unknown outcome.
    expect(result.status).toBe("CANCELLED");
    expect((await operationsOf(userId))[0]).toMatchObject({ status: "SUCCEEDED", failureClass: "TIMEOUT" });
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED" });
    expect(cancelCalls()).toHaveLength(1);
  });

  it("never re-sends a cancel whose outcome is unknown; the observation that it did not apply settles it", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PAST_DUE", now: clock });
    fake.failNext("cancelSubscription", "UNAVAILABLE");

    expect((await cancel(userId, "IMMEDIATE")).status).toBe("CONFIRMING");
    expect((await operationsOf(userId))[0]).toMatchObject({ status: "NOT_APPLIED" });
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "PAST_DUE" });
    expect(cancelCalls()).toHaveLength(1);
  });

  it("leaves state unchanged on a refusal and marks the row due", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.failNext("cancelSubscription", "REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });

    await expect(cancel(userId, "IMMEDIATE")).rejects.toBeInstanceOf(CancellationFailedError);

    expect((await operationsOf(userId))[0]).toMatchObject({ status: "REJECTED", failureClass: "REJECTED", providerErrorCode: "BAD_REQUEST_ERROR" });
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "HALTED" });
  });

  it.each(["CONCURRENT_OPERATION", "RATE_LIMITED", "BUDGET_EXHAUSTED"] as const)("asks the customer to retry on %s; nothing changes", async (failureClass) => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PAST_DUE", now: clock });
    fake.failNext("cancelSubscription", failureClass);

    await expect(cancel(userId, "IMMEDIATE")).rejects.toBeInstanceOf(BillingBusyError);

    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "PAST_DUE" });
    expect((await operationsOf(userId))[0]).toMatchObject({ status: "REJECTED", failureClass });
  });

  it("answers from the newer observation when a webhook-driven sync applied the cancellation before tx B", async () => {
    const userId = await createBillingUser(PREFIX);
    const row = await seedLive(fake, userId, { phase: "PAST_DUE", now: clock });
    const commandRunner = runner({
      // Between the call and tx B, a webhook's fetch (sent later) applies `cancelled`.
      beforeSettle: async () => {
        await applyObservation(
          row.id,
          { state: fake.peek(row.providerSubscriptionId!)!, observationAt: new Date(clock.getTime() + 10 * MINUTE) },
          { resolvedMode: "TEST", catalog: lifecycleCatalog, now: clock, trigger: "WEBHOOK" },
        );
      },
    });

    const result = await cancel(userId, "IMMEDIATE", key(), commandRunner);

    expect(result.status).toBe("CANCELLED");
    expect((await operationsOf(userId))[0]).toMatchObject({ status: "SUCCEEDED" });
    expect(await reloadSubscription(row.id)).toMatchObject({ phase: "CANCELLED" });
  });
});

describe("Cancel — refusals, slots and modes", () => {
  it("refuses with no subscription, or only a terminal one", async () => {
    const userId = await createBillingUser(PREFIX);

    await expect(cancel(userId, "IMMEDIATE")).rejects.toBeInstanceOf(NoSubscriptionError);

    await seedLive(fake, userId, { phase: "CANCELLED", now: clock });
    await expect(cancel(userId, "IMMEDIATE")).rejects.toBeInstanceOf(NoSubscriptionError);
    expect(cancelCalls()).toHaveLength(0);
  });

  it("refuses while a checkout is still being set up", async () => {
    const userId = await createBillingUser(PREFIX);
    await prisma.subscription.create({ data: { userId, kind: "STANDARD", providerMode: "TEST", plan: "PRO", cycle: "MONTHLY", phase: "PROVISIONING" } });

    await expect(cancel(userId, "IMMEDIATE")).rejects.toBeInstanceOf(CheckoutInProgressError);
  });

  it("serializes concurrent requests: one provider call, the others refused 409", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "PAST_DUE", now: clock });

    const results = await Promise.allSettled([cancel(userId, "IMMEDIATE"), cancel(userId, "IMMEDIATE"), cancel(userId, "IMMEDIATE")]);
    const refused = results.filter((result) => result.status === "rejected");

    expect(cancelCalls()).toHaveLength(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of refused) {
      expect([BillingOperationInProgressError, NoSubscriptionError].some((type) => (result as PromiseRejectedResult).reason instanceof type)).toBe(true);
    }
  });

  it("refuses self-serve while a multiple-subscriptions anomaly is open, writing nothing", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "ACTIVE", now: clock });
    await prisma.billingAnomaly.create({
      data: { type: "MULTIPLE_OPEN_SUBSCRIPTIONS", providerMode: "TEST", userId, subjectKey: AnomalySubject.user(userId), details: {} },
    });

    await expect(cancel(userId, "CYCLE_END")).rejects.toBeInstanceOf(BillingContactSupportError);
    expect(await operationsOf(userId)).toHaveLength(0);
  });

  it("answers 503 in disabled mode with nothing written", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "ACTIVE", now: clock });

    await expect(cancel(userId, "CYCLE_END", key(), runner({ resolvedMode: () => "DISABLED" }))).rejects.toBeInstanceOf(BillingUnavailableError);
    expect(await operationsOf(userId)).toHaveLength(0);
  });
});
