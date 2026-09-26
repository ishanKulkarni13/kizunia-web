/**
 * ConfirmCheckout and the `/me/billing` summary, against real Postgres and the
 * fake provider: the signature is checked against the server-held ID only,
 * a bad one still leads to an authoritative fetch, and access changes only
 * when that fetch shows the subscription paid.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StrictAuthorizationActor } from "@/authorization";
import prisma from "@/lib/prisma";
import { cleanupBillingUsers, createBillingUser, insertBoundSubscription } from "@/testing/billing-sync-fixtures";

import { createPlanCatalog } from "../../config/plan-catalog";
import { BillingUnavailableError, NoPendingCheckoutError } from "../../errors";
import { FakeBillingProvider } from "../../provider/fake-provider";
import { BillingSummaryService } from "../billing-summary.service";
import { CommandRunner } from "./command-runner";
import { ConfirmCheckoutService } from "./confirm-checkout";
import { StartCheckoutCommand } from "./start-checkout";

const PREFIX = "__vitest_billing_confirm__";
const MINUTE = 60_000;

const catalog = createPlanCatalog(
  (["PRO", "PRO_PLUS"] as const).flatMap((plan) =>
    (["MONTHLY", "YEARLY"] as const).map((cycle) => ({ providerPlanId: `plan_fake_${plan}_${cycle}`, plan, cycle })),
  ),
);

let fake: FakeBillingProvider;
let clock: Date;
let tick = 0;
let keys = 0;
const now = () => clock;
const providerNow = () => new Date(clock.getTime() + (tick += 1));

const actor = (id: string): StrictAuthorizationActor => ({ id, role: "USER", banned: false }) as StrictAuthorizationActor;
const summary = () => new BillingSummaryService({ resolvedMode: () => "TEST", now, catalog });
const confirmer = () =>
  new ConfirmCheckoutService({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog });

async function checkout(userId: string) {
  const runner = new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog });
  const result = await runner.run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY" }, { keyId: () => "rzp_test_k" }), {
    actor: { userId, actorKind: "USER", actorUserId: userId },
    idempotencyKey: `key_${PREFIX}${Date.now()}_${(keys += 1)}`,
  });

  if (result.status !== "CHECKOUT_READY") throw new Error(`expected a checkout, got ${result.status}`);

  return result.checkout.subscriptionId;
}

/** What Razorpay reports once the customer authenticated and the first charge went through. */
function paid(psub: string) {
  fake.seed({
    ...fake.peek(psub)!,
    rawStatus: "active",
    currentStart: clock,
    currentEnd: new Date(clock.getTime() + 30 * 24 * 60 * MINUTE),
    paidCount: 1,
  });
}

const localOf = (psub: string) => prisma.subscription.findFirstOrThrow({ where: { providerSubscriptionId: psub } });

beforeEach(() => {
  clock = new Date();
  fake = new FakeBillingProvider({ now: providerNow, idPrefix: `sub_${PREFIX}${Date.now()}_` });
});
afterEach(() => cleanupBillingUsers(PREFIX));
afterAll(async () => {
  await cleanupBillingUsers(PREFIX);
  await prisma.$disconnect();
});

describe("ConfirmCheckout", () => {
  it("verifies against the server-held ID, syncs, and grants exactly the purchased plan once Razorpay reports active", async () => {
    const userId = await createBillingUser(PREFIX);
    const psub = await checkout(userId);
    paid(psub);
    fake.setPaymentMethod("pay_1", { method: "card", international: false });

    const result = await confirmer().confirm(actor(userId), {
      razorpayPaymentId: "pay_1",
      razorpaySignature: fake.signCheckout("pay_1", psub),
    });

    expect(result.signatureValid).toBe(true);
    expect(result.plan).toBe("PRO");
    expect(result.capabilities).toEqual({ portfolio: true, deadlineNotifications: true, recommendations: false, mcp: false });
    expect(result.subscription).toMatchObject({ phase: "ACTIVE", plan: "PRO", cycle: "MONTHLY" });
    expect(await localOf(psub)).toMatchObject({ phase: "ACTIVE", advisoryPaymentMethod: "card", advisoryInternationalCard: false });

    const history = await prisma.subscriptionHistoryEntry.findMany({
      where: { subscription: { providerSubscriptionId: psub }, change: "PHASE", toValue: "ACTIVE" },
    });
    expect(history).toMatchObject([{ trigger: "CHECKOUT_CONFIRM", cause: "PROVIDER_OBSERVED" }]);
  });

  it("grants nothing while Razorpay has not reported the payment, and shows 'finishing up'", async () => {
    const userId = await createBillingUser(PREFIX);
    const psub = await checkout(userId);

    const result = await confirmer().confirm(actor(userId), {
      razorpayPaymentId: "pay_1",
      razorpaySignature: fake.signCheckout("pay_1", psub),
    });

    expect(result.signatureValid).toBe(true);
    expect(result.plan).toBe("FREE");
    expect(result.facets.finishingUp).toBe(true);
    expect((await localOf(psub)).phase).toBe("PENDING_AUTHENTICATION");
  });

  it("with a bad signature: logs, still marks the row due, fetches nothing now, changes nothing", async () => {
    const userId = await createBillingUser(PREFIX);
    const psub = await checkout(userId);
    paid(psub);
    const callsBefore = fake.calls.length;

    const result = await confirmer().confirm(actor(userId), { razorpayPaymentId: "pay_1", razorpaySignature: "forged" });

    expect(result.signatureValid).toBe(false);
    expect(result.plan).toBe("FREE");
    expect(fake.calls.length).toBe(callsBefore);
    const local = await localOf(psub);
    expect(local).toMatchObject({ phase: "PENDING_AUTHENTICATION", syncReason: "CHECKOUT_CONFIRM" });
    expect(local.syncDueAt!.getTime()).toBeLessThanOrEqual(clock.getTime());
  });

  it("never verifies against, binds or touches a provider ID the browser sends", async () => {
    const victimId = await createBillingUser(PREFIX, "victim");
    const victimPsub = await checkout(victimId);
    const attackerId = await createBillingUser(PREFIX, "attacker");
    const attackerPsub = await checkout(attackerId);
    const victimBefore = await localOf(victimPsub);

    // A signature valid for the victim's subscription, sent with the victim's ID.
    const result = await confirmer().confirm(actor(attackerId), {
      razorpayPaymentId: "pay_v",
      razorpaySignature: fake.signCheckout("pay_v", victimPsub),
      razorpaySubscriptionId: victimPsub,
    });

    expect(result.signatureValid).toBe(false);
    expect(await localOf(victimPsub)).toEqual(victimBefore);
    expect((await localOf(attackerPsub)).userId).toBe(attackerId);
    expect(fake.calls.filter((call) => call.method === "fetchSubscription")).toHaveLength(0);
  });

  it("refuses when the caller has no checkout to confirm", async () => {
    const userId = await createBillingUser(PREFIX);

    await expect(confirmer().confirm(actor(userId), { razorpayPaymentId: "pay_1", razorpaySignature: "x" })).rejects.toBeInstanceOf(
      NoPendingCheckoutError,
    );
  });

  it("answers with the summary when the webhook already applied the payment", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase: "ACTIVE" });

    const result = await confirmer().confirm(actor(userId), { razorpayPaymentId: "pay_1", razorpaySignature: "x" });

    expect(result.signatureValid).toBeNull();
    expect(result.plan).toBe("PRO");
  });

  it("refuses with 503 when billing is disabled", async () => {
    const userId = await createBillingUser(PREFIX);
    const disabled = new ConfirmCheckoutService({
      providerFor: () => fake,
      resolvedMode: () => "DISABLED",
      assertEnabled: () => {
        throw new BillingUnavailableError();
      },
      now,
    });

    await expect(disabled.confirm(actor(userId), { razorpayPaymentId: "pay_1", razorpaySignature: "x" })).rejects.toBeInstanceOf(
      BillingUnavailableError,
    );
  });
});

describe("GET /me/billing — the summary", () => {
  it("offers every plan to a Free user, with no subscription and no facets", async () => {
    const userId = await createBillingUser(PREFIX);

    const result = await summary().getForUser(actor(userId));

    expect(result).toMatchObject({
      billingAvailable: true,
      plan: "FREE",
      subscription: null,
      facets: { finishingUp: false, confirming: false, onHold: false },
      allowedActions: { resumeCheckout: null, refusal: null },
    });
    expect(result.allowedActions.startCheckout).toHaveLength(4);
  });

  it("reports billing unavailable in disabled mode, still answering", async () => {
    const userId = await createBillingUser(PREFIX);

    const result = await new BillingSummaryService({ resolvedMode: () => "DISABLED", now }).getForUser(actor(userId));

    expect(result).toMatchObject({ billingAvailable: false, plan: "FREE", allowedActions: { startCheckout: [] } });
  });

  it("offers a pending checkout to resume, and carries no provider identifier", async () => {
    const userId = await createBillingUser(PREFIX);
    const psub = await checkout(userId);

    const result = await summary().getForUser(actor(userId));

    expect(result.subscription).toMatchObject({ phase: "PENDING_AUTHENTICATION", plan: "PRO", cycle: "MONTHLY" });
    expect(result.subscription?.expireBy).not.toBeNull();
    expect(result.allowedActions.resumeCheckout).toEqual({ plan: "PRO", cycle: "MONTHLY", kind: "STANDARD", code: null });
    expect(result.facets.finishingUp).toBe(false);
    expect(JSON.stringify(result)).not.toContain(psub);
  });

  it("shows 'confirming' and offers nothing while a create's outcome is unknown", async () => {
    const userId = await createBillingUser(PREFIX);
    fake.failNext("createSubscription", "TIMEOUT");
    const runner = new CommandRunner({ providerFor: () => fake, resolvedMode: () => "TEST", assertEnabled: () => {}, now, catalog });
    await runner.run(new StartCheckoutCommand({ plan: "PRO", cycle: "MONTHLY" }, { keyId: () => "k" }), {
      actor: { userId, actorKind: "USER", actorUserId: userId },
      idempotencyKey: `key_${PREFIX}unknown_${Date.now()}`,
    });

    const result = await summary().getForUser(actor(userId));

    expect(result.facets.confirming).toBe(true);
    expect(result.allowedActions.startCheckout).toEqual([]);
  });

  it("explains a refusal for a live subscription, with the advisory", async () => {
    const userId = await createBillingUser(PREFIX);
    await insertBoundSubscription(userId, { phase: "HALTED" });

    const result = await summary().getForUser(actor(userId));

    expect(result.facets.onHold).toBe(true);
    expect(result.allowedActions).toMatchObject({ startCheckout: [], refusal: "SUPERSESSION_REQUIRED" });
  });
});
