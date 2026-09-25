/**
 * Supersession through the command runner, against real Postgres and the fake
 * provider (multiple-subscriptions.md#supersession, SB-UQ-04, IB-26 item 5):
 * a new subscription for a HALTED or PAUSED user only after the old one is
 * OBSERVED cancelled; never two open subscriptions; CONFIRMING and the next
 * request's continuation; a refused cancel sends the user to recovery.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser } from "@/testing/billing-sync-fixtures";
import { historyOf, lifecycleCatalog, operationsOf, reloadSubscription, seedLive } from "@/testing/billing-lifecycle-fixtures";

import {
  BillingBusyError,
  CheckoutFailedError,
  SupersessionCancelRefusedError,
  SupersessionNotApplicableError,
  SupersessionRequiredError,
} from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { ProviderPriority } from "../../provider/types";
import { SyncService } from "../sync/sync.service";
import { CommandRunner, type CommandRunnerDeps } from "./command-runner";
import type { StartCheckoutResult } from "./create-subscription-step";
import { StartCheckoutCommand } from "./start-checkout";
import { SupersedeCommand } from "./supersede";

const PREFIX = "__vitest_billing_supersede__";
const KEY_ID = "rzp_test_supersede";

let fake: FakeBillingProvider;
let clock: Date;
let providerTick = 0;
let keys = 0;
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (providerTick += 1));

const runner = (deps: CommandRunnerDeps = {}) =>
  new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog: lifecycleCatalog, ...deps });
const key = () => `key_${PREFIX}${Date.now()}_${(keys += 1)}`;

function supersede(userId: string, supersedesSubscriptionId: string, idempotencyKey = key()): Promise<StartCheckoutResult> {
  return runner().run(new SupersedeCommand({ plan: "PRO_PLUS", cycle: "MONTHLY", supersedesSubscriptionId }, { keyId: () => KEY_ID }), {
    actor: { userId, actorKind: "USER", actorUserId: userId },
    idempotencyKey,
  });
}

const methods = () => fake.calls.map((call) => call.method);
const openOf = (userId: string) =>
  prisma.subscription.findMany({ where: { userId, phase: { notIn: ["CANCELLED", "EXPIRED", "COMPLETED", "ABANDONED"] } } });

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("Supersede — confirmed cancellation, then create", () => {
  it.each<SubscriptionPhase>(["HALTED", "PAUSED"])("replaces a %s subscription: re-check, cancel, observe cancelled, link, create", async (phase) => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase, now: clock });

    const result = await supersede(userId, old.id);

    expect(result.status).toBe("CHECKOUT_READY");
    expect(methods()).toEqual(["fetchSubscription", "cancelSubscription", "fetchSubscription", "createSubscription"]);
    expect(fake.calls[1].args[1]).toEqual({ atCycleEnd: false });

    const oldAfter = await reloadSubscription(old.id);
    const [open] = await openOf(userId);

    expect(oldAfter).toMatchObject({ phase: "CANCELLED", supersededById: open.id });
    expect(open).toMatchObject({ phase: "PENDING_AUTHENTICATION", plan: "PRO_PLUS", cycle: "MONTHLY" });
    expect(result.status === "CHECKOUT_READY" && result.checkout.subscriptionId).toBe(open.providerSubscriptionId);

    const operations = await operationsOf(userId);
    const root = operations.find((operation) => operation.parentOperationId === null)!;
    const create = operations.find((operation) => operation.kind === "CREATE_SUBSCRIPTION")!;

    expect(root).toMatchObject({ kind: "SUPERSEDE", status: "SUCCEEDED", subscriptionId: old.id, requestSentAt: null });
    expect(operations.find((operation) => operation.kind === "CANCEL_IMMEDIATELY")).toMatchObject({
      status: "SUCCEEDED",
      parentOperationId: root.id,
      request: { atCycleEnd: false, reason: "SUPERSESSION" },
    });
    expect(create).toMatchObject({ status: "SUCCEEDED", parentOperationId: root.id, subscriptionId: open.id });
    // Binding and orphan discovery find the create through its own operation.
    expect((fake.calls[3].args[0] as { notes: Record<string, string> }).notes).toEqual({ kz_sub: open.id, kz_op: create.id, kz_env: "TEST" });

    expect(await historyOf(old.id)).toContainEqual(
      expect.objectContaining({ change: "SUPERSESSION", toValue: open.id, cause: "KIZUNIA_COMMAND", operationId: root.id }),
    );
  });

  it("returns the recorded checkout for a same-key retry, with no further provider call", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    const idempotencyKey = key();

    const first = await supersede(userId, old.id, idempotencyKey);
    const calls = fake.calls.length;
    const retry = await supersede(userId, old.id, idempotencyKey);

    expect(retry).toEqual(first);
    expect(fake.calls).toHaveLength(calls);
  });
});

describe("Supersede — never creates before the old one is observed cancelled", () => {
  it("refuses the purchase when Razorpay refuses the cancel, and sends the user to recovery", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.failNext("cancelSubscription", "REJECTED", { providerErrorCode: "BAD_REQUEST_ERROR" });

    await expect(supersede(userId, old.id)).rejects.toMatchObject({ code: new SupersessionCancelRefusedError().code, details: { recovery: true } });

    expect(methods()).not.toContain("createSubscription");
    expect(await reloadSubscription(old.id)).toMatchObject({ phase: "HALTED", supersededById: null });
    expect((await operationsOf(userId)).find((operation) => operation.parentOperationId === null)).toMatchObject({
      kind: "SUPERSEDE",
      status: "REJECTED",
      failureClass: "REJECTED",
    });
  });

  it("answers CONFIRMING with no create when the cancel is accepted but the fetch still shows halted", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.acceptWithoutEffect("cancelSubscription");

    const result = await supersede(userId, old.id);

    expect(result.status).toBe("CONFIRMING");
    expect(methods()).not.toContain("createSubscription");
    expect(await openOf(userId)).toHaveLength(1);
    expect((await operationsOf(userId)).find((operation) => operation.parentOperationId === null)).toMatchObject({ status: "SUCCEEDED" });
  });

  it("continues on the next request once the cancellation is observed (no background continuation)", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.acceptWithoutEffect("cancelSubscription");
    await supersede(userId, old.id);

    // Razorpay's cancellation becomes visible; a webhook-driven sync observes it.
    await fake.cancelSubscription(old.providerSubscriptionId!, { atCycleEnd: false });
    await new SyncService({ providerFor: () => fake, resolvedMode: () => "TEST", now, catalog: lifecycleCatalog }).syncTargeted(
      old.id,
      ProviderPriority.CONFIRMATION,
      { trigger: "WEBHOOK" },
    );
    const callsBefore = fake.calls.filter((call) => call.method === "cancelSubscription").length;

    const result = await supersede(userId, old.id);

    expect(result.status).toBe("CHECKOUT_READY");
    // No second cancel: the old one is already observed cancelled.
    expect(fake.calls.filter((call) => call.method === "cancelSubscription")).toHaveLength(callsBefore);
    const [open] = await openOf(userId);
    expect(await reloadSubscription(old.id)).toMatchObject({ phase: "CANCELLED", supersededById: open.id });
  });

  it("continues when the re-check itself observes the cancellation (local state still said HALTED)", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock, provider: { rawStatus: "cancelled" } });

    const result = await supersede(userId, old.id);

    expect(result.status).toBe("CHECKOUT_READY");
    expect(methods()).toEqual(["fetchSubscription", "createSubscription"]);
  });

  it("answers CONFIRMING when the cancel's outcome is unknown, and never re-sends it", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.failNext("cancelSubscription", "TIMEOUT");

    expect((await supersede(userId, old.id)).status).toBe("CONFIRMING");
    expect(methods().filter((method) => method === "cancelSubscription")).toHaveLength(1);
    expect(methods()).not.toContain("createSubscription");
    expect((await operationsOf(userId)).find((operation) => operation.parentOperationId === null)).toMatchObject({ status: "REJECTED", failureClass: null });
  });

  it("never cancels a subscription that recovered on its own before the cancel", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock, provider: { rawStatus: "active" } });

    await expect(supersede(userId, old.id)).rejects.toBeInstanceOf(SupersessionNotApplicableError);

    expect(methods()).toEqual(["fetchSubscription"]);
    expect(await reloadSubscription(old.id)).toMatchObject({ phase: "ACTIVE", supersededById: null });
  });

  it("asks for a retry, cancelling nothing, when the re-check cannot observe", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.failNext("fetchSubscription", "UNAVAILABLE");

    await expect(supersede(userId, old.id)).rejects.toBeInstanceOf(BillingBusyError);
    expect(methods()).not.toContain("cancelSubscription");
  });

  it("keeps the old one cancelled when the new create is refused; the user can buy again", async () => {
    const userId = await createBillingUser(PREFIX);
    const old = await seedLive(fake, userId, { phase: "HALTED", now: clock });
    fake.failNext("createSubscription", "REJECTED");

    await expect(supersede(userId, old.id)).rejects.toBeInstanceOf(CheckoutFailedError);

    const oldAfter = await reloadSubscription(old.id);
    expect(oldAfter.phase).toBe("CANCELLED");
    expect(await reloadSubscription(oldAfter.supersededById!)).toMatchObject({ phase: "ABANDONED" });
    expect(await openOf(userId)).toHaveLength(0);
  });
});

describe("Supersede — explicit confirmation only", () => {
  it("is refused without the confirmation: a plain checkout on hold needs supersession", async () => {
    const userId = await createBillingUser(PREFIX);
    await seedLive(fake, userId, { phase: "HALTED", now: clock });

    await expect(
      runner().run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY" }, { keyId: () => KEY_ID }), {
        actor: { userId, actorKind: "USER", actorUserId: userId },
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(SupersessionRequiredError);
    expect(fake.calls).toHaveLength(0);
  });

  it.each<SubscriptionPhase>(["ACTIVE", "PAST_DUE", "PENDING_AUTHENTICATION"])("refuses to supersede a %s subscription", async (phase) => {
    const userId = await createBillingUser(PREFIX);
    const current = await seedLive(fake, userId, { phase, now: clock });

    await expect(supersede(userId, current.id)).rejects.toBeInstanceOf(SupersessionNotApplicableError);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses to name another user's subscription", async () => {
    const userId = await createBillingUser(PREFIX);
    const other = await createBillingUser(PREFIX, "other");
    await seedLive(fake, userId, { phase: "HALTED", now: clock });
    const theirs = await seedLive(fake, other, { phase: "HALTED", now: clock });

    await expect(supersede(userId, theirs.id)).rejects.toBeInstanceOf(SupersessionNotApplicableError);
    expect(await reloadSubscription(theirs.id)).toMatchObject({ phase: "HALTED" });
    expect(fake.calls).toHaveLength(0);
  });
});
