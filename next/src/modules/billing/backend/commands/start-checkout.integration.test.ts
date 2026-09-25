/**
 * StartCheckout through the command runner, against real Postgres and the
 * fake provider: exactly one provider subscription per intent under retries,
 * tabs, timeouts and crashes; access only from an observation.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BillingCycle, MembershipPlan } from "@/generated/prisma";
import { resolveEffectiveAccess } from "@/lib/entitlements/resolver";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import {
  BillingBusyError,
  BillingConfirmingError,
  BillingContactSupportError,
  BillingUnavailableError,
  CheckoutFailedError,
  CheckoutInProgressError,
  IdempotencyKeyRequiredError,
  SubscriptionExistsError,
  SupersessionRequiredError,
} from "../../errors";
import { BudgetedProvider } from "../../provider/budgeted-provider";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority, type BillingProvider } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { BillingSyncTask } from "../reconciliation/billing-sync.task";
import { SyncService } from "../sync/sync.service";
import { UnmatchedEventResolver } from "../webhooks/unmatched-resolver";
import { WebhookService } from "../webhooks/webhook.service";
import { CommandRunner, type CommandRunnerDeps } from "./command-runner";
import { StartCheckoutCommand, type StartCheckoutResult } from "./start-checkout";

const PREFIX = "__vitest_billing_checkout__";
const MINUTE = 60_000;
const KEY_ID = "rzp_test_checkoutkey";

const catalog = createPlanCatalog(
  (["PRO", "PRO_PLUS"] as const).flatMap((plan) =>
    (["MONTHLY", "YEARLY"] as const).map((cycle) => ({ providerPlanId: `plan_fake_${plan}_${cycle}`, plan, cycle })),
  ),
);

let fake: FakeBillingProvider;
let clock: Date;
let keySequence = 0;
let providerTick = 0;
const now = () => clock;
/** Real provider calls are strictly ordered in time; the fake's clock moves 1 ms per call so the stale guard sees that. */
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const runner = (deps: CommandRunnerDeps = {}) =>
  new CommandRunner({
    providerFor: () => fake,
    resolvedMode: () => "TEST",
    assertEnabled: () => {},
    now,
    catalog,
    ...deps,
  });

const key = () => `key-${PREFIX}-${Date.now()}-${(keySequence += 1)}`.replace(/[^A-Za-z0-9_-]/g, "_");

function start(
  userId: string,
  idempotencyKey = key(),
  intent: { plan: MembershipPlan; cycle: BillingCycle } = { plan: "PRO", cycle: "MONTHLY" },
  commandRunner = runner(),
): Promise<StartCheckoutResult> {
  return commandRunner.run(new StartCheckoutCommand(intent, { keyId: () => KEY_ID }), {
    actor: { userId, actorKind: "USER", actorUserId: userId },
    idempotencyKey,
  });
}

const creates = () => fake.calls.filter((call) => call.method === "createSubscription");
const subscriptionsOf = (userId: string) => prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const operationsOf = (userId: string) => prisma.billingOperation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("StartCheckout — the happy create", () => {
  it("creates one provider subscription with Kizunia's notes, expire_by and total_count, bound and applied", async () => {
    const userId = await createBillingUser(PREFIX);

    const result = await start(userId);

    expect(result.status).toBe("CHECKOUT_READY");
    if (result.status !== "CHECKOUT_READY") return;

    const [subscription] = await subscriptionsOf(userId);
    const [operation] = await operationsOf(userId);

    expect(result.checkout).toMatchObject({ keyId: KEY_ID, subscriptionId: subscription.providerSubscriptionId, plan: "PRO", cycle: "MONTHLY" });
    expect(subscription).toMatchObject({ phase: "PENDING_AUTHENTICATION", plan: "PRO", cycle: "MONTHLY", providerMode: "TEST" });
    expect(operation).toMatchObject({
      kind: "CREATE_SUBSCRIPTION",
      status: "SUCCEEDED",
      subscriptionId: subscription.id,
      request: { plan: "PRO", cycle: "MONTHLY", kind: "STANDARD" },
    });
    expect(operation.requestSentAt!.getTime()).toBeGreaterThan(clock.getTime());

    expect(creates()).toHaveLength(1);
    const [input] = creates()[0].args as [Record<string, unknown>];
    expect(input).toMatchObject({
      plan: "PRO",
      cycle: "MONTHLY",
      totalCount: 1200,
      expireBy: new Date(clock.getTime() + 30 * MINUTE),
      notes: { kz_sub: subscription.id, kz_op: operation.id, kz_env: "TEST" },
    });

    const history = await prisma.subscriptionHistoryEntry.findMany({ where: { subscriptionId: subscription.id } });
    expect(history.map((entry) => entry.change).sort()).toEqual(["BINDING", "PHASE"]);
    expect(history.every((entry) => entry.cause === "KIZUNIA_COMMAND" && entry.operationId === operation.id)).toBe(true);
  });

  it("uses the yearly total_count for a yearly plan", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId, key(), { plan: "PRO_PLUS", cycle: "YEARLY" });

    expect((creates()[0].args[0] as { totalCount: number }).totalCount).toBe(100);
  });

  it("grants no access: a pending checkout is not a paid subscription", async () => {
    const userId = await createBillingUser(PREFIX);

    await start(userId);

    expect((await resolveEffectiveAccess(userId, { expectedMode: "TEST" })).plan).toBe("FREE");
  });
});

describe("StartCheckout — idempotency and concurrency", () => {
  it("returns the recorded result for a same-key retry, without a second create", async () => {
    const userId = await createBillingUser(PREFIX);
    const idempotencyKey = key();

    const first = await start(userId, idempotencyKey);
    const second = await start(userId, idempotencyKey);

    expect(second).toEqual(first);
    expect(creates()).toHaveLength(1);
    expect(await operationsOf(userId)).toHaveLength(1);
  });

  it("creates exactly one provider subscription for concurrent checkouts from several tabs", async () => {
    const userId = await createBillingUser(PREFIX);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => start(userId)));

    expect(creates()).toHaveLength(1);
    expect(await subscriptionsOf(userId)).toHaveLength(1);

    for (const result of results) {
      if (result.status === "fulfilled") {
        expect(["CHECKOUT_READY", "IN_PROGRESS"]).toContain(result.value.status);
      } else {
        expect(result.reason).toMatchObject({ code: "BILLING_OPERATION_IN_PROGRESS" });
      }
    }
  });

  it("reuses an unexpired pending checkout for the same plan: no provider call, no new operation", async () => {
    const userId = await createBillingUser(PREFIX);

    const first = await start(userId);
    const second = await start(userId);

    expect(second.status).toBe("CHECKOUT_READY");
    if (first.status !== "CHECKOUT_READY" || second.status !== "CHECKOUT_READY") return;
    expect(second.checkout.subscriptionId).toBe(first.checkout.subscriptionId);
    expect(fake.calls).toHaveLength(1);
    expect(await operationsOf(userId)).toHaveLength(1);
  });

  it("requires a valid Idempotency-Key", async () => {
    const userId = await createBillingUser(PREFIX);

    await expect(start(userId, "short")).rejects.toBeInstanceOf(IdempotencyKeyRequiredError);
    await expect(start(userId, "has a space in it")).rejects.toBeInstanceOf(IdempotencyKeyRequiredError);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("StartCheckout — refusals and failures", () => {
  it("sends nothing when the budget is exhausted: operation REJECTED(BUDGET_EXHAUSTED), subscription ABANDONED", async () => {
    const userId = await createBillingUser(PREFIX);
    const refusingBudget = new BudgetedProvider(
      fake,
      { acquire: async () => false },
      { verdict: async () => "CLEAR", record: async () => {} },
      ProviderPriority.COMMAND,
    );
    const idempotencyKey = key();

    await expect(start(userId, idempotencyKey, undefined, runner({ providerFor: () => refusingBudget }))).rejects.toBeInstanceOf(
      BillingBusyError,
    );

    expect(fake.calls).toHaveLength(0);
    const [operation] = await operationsOf(userId);
    expect(operation).toMatchObject({ status: "REJECTED", failureClass: "BUDGET_EXHAUSTED", requestSentAt: null });
    expect((await subscriptionsOf(userId))[0].phase).toBe("ABANDONED");

    // A retry of the same request is answered from the record.
    await expect(start(userId, idempotencyKey)).rejects.toBeInstanceOf(BillingBusyError);
    expect(fake.calls).toHaveLength(0);
  });

  it("abandons the record when the provider refuses the create", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });

    await expect(start(userId)).rejects.toBeInstanceOf(CheckoutFailedError);

    const [operation] = await operationsOf(userId);
    expect(operation).toMatchObject({ status: "REJECTED", failureClass: "REJECTED", providerErrorCode: "BAD_REQUEST_ERROR" });
    expect(operation.requestSentAt).not.toBeNull();
    expect((await subscriptionsOf(userId))[0].phase).toBe("ABANDONED");
  });

  it.each(["TRIALING", "ACTIVE", "PAST_DUE"] as const)("refuses a purchase while %s, recorded, with the advisory", async (phase) => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase, advisoryPaymentMethod: "upi" });
    const idempotencyKey = key();

    const refusal = await start(userId, idempotencyKey).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(SubscriptionExistsError);
    expect(refusal).toMatchObject({ details: { planChange: "V1_LIMITATION" } });
    expect(await operationsOf(userId)).toMatchObject([{ status: "REJECTED", failureClass: null, requestSentAt: null }]);
    await expect(start(userId, idempotencyKey)).rejects.toBeInstanceOf(SubscriptionExistsError);
    expect(fake.calls).toHaveLength(0);
  });

  it.each(["HALTED", "PAUSED"] as const)("refuses %s until supersession exists (Phase VI)", async (phase) => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase });

    await expect(start(userId)).rejects.toBeInstanceOf(SupersessionRequiredError);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses while a multiple-subscriptions anomaly is open, writing nothing", async () => {
    const userId = await createBillingUser(PREFIX);
    await prisma.billingAnomaly.create({
      data: {
        type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
        providerMode: "TEST",
        userId,
        subjectKey: AnomalySubject.user(userId),
        subscriptionIds: [],
        details: {},
      },
    });

    await expect(start(userId)).rejects.toBeInstanceOf(BillingContactSupportError);
    expect(await operationsOf(userId)).toHaveLength(0);
  });

  it("refuses with 503 and writes nothing when billing is disabled", async () => {
    const userId = await createBillingUser(PREFIX);
    const disabled = runner({
      assertEnabled: () => {
        throw new BillingUnavailableError();
      },
    });

    await expect(start(userId, key(), undefined, disabled)).rejects.toBeInstanceOf(BillingUnavailableError);
    expect(await operationsOf(userId)).toHaveLength(0);
    expect(await subscriptionsOf(userId)).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("StartCheckout — unknown outcomes are never re-sent (SB-CM-03)", () => {
  it("leaves a timed-out create OUTCOME_UNKNOWN and PROVISIONING, and never sends it again", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT");

    expect((await start(userId)).status).toBe("CONFIRMING");

    const [operation] = await operationsOf(userId);
    expect(operation).toMatchObject({ status: "OUTCOME_UNKNOWN", failureClass: "TIMEOUT" });
    expect(operation.requestSentAt).not.toBeNull();
    expect(await subscriptionsOf(userId)).toMatchObject([{ phase: "PROVISIONING", providerSubscriptionId: null }]);

    // While young: "still being confirmed".
    await expect(start(userId)).rejects.toBeInstanceOf(BillingConfirmingError);

    // Once the window passes: the same plan is "still being set up", another is refused. Never a second create.
    advance(31 * MINUTE);
    expect((await start(userId)).status).toBe("IN_PROGRESS");
    await expect(start(userId, key(), { plan: "PRO_PLUS", cycle: "YEARLY" })).rejects.toBeInstanceOf(CheckoutInProgressError);

    expect(creates()).toHaveLength(1);
  });

  it("recovers a create whose response was lost through the webhook's notes", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT", { afterApplying: true });

    await start(userId);

    const [subscription] = await subscriptionsOf(userId);
    const [operation] = await operationsOf(userId);
    const listed = await fake.listSubscriptions({ from: new Date(0), to: new Date(clock.getTime() + MINUTE) }, { count: 10, skip: 0 });
    if (listed.kind !== "SUCCESS") throw new Error("expected a listing");
    const psub = listed.value.items[0].providerSubscriptionId;

    const resolver = new UnmatchedEventResolver({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog });
    const webhooks = new WebhookService({
      provider: () => fake,
      mode: () => "TEST",
      accountId: () => "acc_fake",
      unmatched: resolver,
      sync: new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog }),
    });
    const body = fake.webhookBody({ eventType: "subscription.authenticated", providerSubscriptionId: psub });
    await webhooks.ingest({ rawBody: Buffer.from(body), signature: fake.signWebhook(body), eventId: `evt_${psub}`, receivedAt: clock });
    advance(1_000);
    await resolver.resolve(psub, ProviderPriority.CONFIRMATION);

    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).toMatchObject({
      providerSubscriptionId: psub,
      phase: "PENDING_AUTHENTICATION",
    });
    expect(await prisma.billingOperation.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(creates()).toHaveLength(1);
  });

  it("a crash between the call and tx B leaves IN_FLIGHT; the lease lapses to OUTCOME_UNKNOWN in the next command", async () => {
    const userId = await createBillingUser(PREFIX);
    const crashing = runner({
      beforeSettle: async () => {
        throw new Error("process died");
      },
    });

    await expect(start(userId, key(), undefined, crashing)).rejects.toThrow("process died");

    expect(await operationsOf(userId)).toMatchObject([{ status: "IN_FLIGHT", requestSentAt: null }]);
    expect(await subscriptionsOf(userId)).toMatchObject([{ phase: "PROVISIONING", providerSubscriptionId: null }]);

    // Inside the lease the slot is still held.
    await expect(start(userId)).rejects.toMatchObject({ code: "BILLING_OPERATION_IN_PROGRESS" });

    // After it, the next command's tx A self-heals the root to OUTCOME_UNKNOWN, and refuses as "confirming".
    advance(61_000);
    await expect(start(userId)).rejects.toBeInstanceOf(BillingConfirmingError);
    expect(await operationsOf(userId)).toMatchObject([{ status: "OUTCOME_UNKNOWN" }]);
    expect(creates()).toHaveLength(1);
  });

  it("the tick also expires a lapsed root to OUTCOME_UNKNOWN", async () => {
    const userId = await createBillingUser(PREFIX);
    const crashing = runner({
      beforeSettle: async () => {
        throw new Error("process died");
      },
    });
    await expect(start(userId, key(), undefined, crashing)).rejects.toThrow("process died");

    advance(61_000);
    const summary = await new BillingSyncTask({
      now,
      resolvedMode: () => "TEST",
      health: () => null,
      sync: new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog }),
      unmatched: { resolvePending: async () => ({}) },
    }).run();

    expect(summary.operationsExpired).toBeGreaterThanOrEqual(1);
    expect(await operationsOf(userId)).toMatchObject([{ status: "OUTCOME_UNKNOWN" }]);
  });
});

describe("StartCheckout — abandon, then create (composed)", () => {
  it("cancels a pending checkout for another plan, confirms it by sync, then creates the new one", async () => {
    const userId = await createBillingUser(PREFIX);
    const first = await start(userId);
    advance(1_000);

    const second = await start(userId, key(), { plan: "PRO_PLUS", cycle: "YEARLY" });

    expect(second.status).toBe("CHECKOUT_READY");
    if (first.status !== "CHECKOUT_READY" || second.status !== "CHECKOUT_READY") return;
    expect(second.checkout.subscriptionId).not.toBe(first.checkout.subscriptionId);
    expect(fake.calls.map((call) => call.method)).toEqual([
      "createSubscription",
      "cancelSubscription",
      "fetchSubscription",
      "createSubscription",
    ]);

    const [old, current] = await subscriptionsOf(userId);
    expect(old.phase).toBe("CANCELLED");
    expect(current).toMatchObject({ phase: "PENDING_AUTHENTICATION", plan: "PRO_PLUS", cycle: "YEARLY" });

    const operations = await operationsOf(userId);
    const root = operations.find((op) => op.subscriptionId === current.id && op.parentOperationId === null)!;
    const child = operations.find((op) => op.parentOperationId === root.id)!;
    expect(root.status).toBe("SUCCEEDED");
    expect(child).toMatchObject({ kind: "CANCEL_IMMEDIATELY", status: "SUCCEEDED", subscriptionId: old.id });
  });

  it("recreates after an expired checkout: a refused cancel, then the sync observes expired", async () => {
    const userId = await createBillingUser(PREFIX);
    const first = await start(userId);
    if (first.status !== "CHECKOUT_READY") throw new Error("expected a checkout");
    advance(31 * MINUTE);
    fake.seed({ ...fake.peek(first.checkout.subscriptionId)!, rawStatus: "expired" });

    const second = await start(userId);

    expect(second.status).toBe("CHECKOUT_READY");
    const [old, current] = await subscriptionsOf(userId);
    expect(old.phase).toBe("EXPIRED");
    expect(current.phase).toBe("PENDING_AUTHENTICATION");
    const child = (await operationsOf(userId)).find((op) => op.parentOperationId !== null)!;
    expect(child).toMatchObject({ kind: "CANCEL_IMMEDIATELY", status: "REJECTED" });
  });

  it("answers CONFIRMING and creates nothing when the old checkout is not yet observed terminal", async () => {
    const userId = await createBillingUser(PREFIX);
    await start(userId);
    advance(1_000);
    fake.failNext("cancelSubscription", "TIMEOUT");
    const idempotencyKey = key();

    const second = await start(userId, idempotencyKey, { plan: "PRO_PLUS", cycle: "YEARLY" });

    expect(second.status).toBe("CONFIRMING");
    expect(creates()).toHaveLength(1);
    const [old, ...rest] = await subscriptionsOf(userId);
    expect(old.phase).toBe("PENDING_AUTHENTICATION");
    expect(rest).toHaveLength(0);

    const root = (await operationsOf(userId)).find((op) => op.idempotencyKey === idempotencyKey)!;
    expect(root).toMatchObject({ status: "REJECTED", failureClass: null, subscriptionId: null });
    expect(await start(userId, idempotencyKey)).toEqual({ status: "CONFIRMING", operationId: root.id });
  });
});

describe("StartCheckout — no provider for the wrong reasons", () => {
  it("never calls a provider other than the one it was given", async () => {
    const userId = await createBillingUser(PREFIX);
    const seen: string[] = [];
    const spying: BillingProvider = new Proxy(fake, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);

        if (typeof value === "function") seen.push(String(property));

        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await start(userId, key(), undefined, runner({ providerFor: () => spying }));

    expect(seen).toEqual(["createSubscription"]);
  });
});
