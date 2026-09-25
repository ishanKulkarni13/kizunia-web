/**
 * The provider boundary, end to end: the real request budget and the real
 * shared cooldown (Postgres) around a fake provider.
 *
 * Each piece has its own tests; this proves they compose the way the design
 * says: a 429 puts the background priorities to sleep while a customer command
 * still gets through, a rejected key stops everything until it changes, the
 * budget caps a burst, and a disabled deployment touches nothing at all.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/prisma";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";

import { ProviderBudget } from "../backend/budget/provider-budget";
import { ProviderHealthTracker, keyFingerprint } from "../backend/budget/provider-health";
import { FakeBillingProvider } from "./fake-provider";
import { buildBillingProvider, getBillingProvider, resetBillingProviderForTests } from "./provider-factory";
import {
  resetProviderConfigurationForTests,
  validateBillingConfigurationAtBoot,
  type ProviderConfiguration,
} from "./provider-mode";
import { ProviderPriority } from "./types";

const KEY_ID = "rzp_test_FactoryKey001";

const enabled: ProviderConfiguration = {
  mode: "TEST",
  razorpay: {
    keyId: KEY_ID,
    keySecret: "factory-key-secret",
    webhookSecret: "factory-webhook-secret",
    accountId: "acc_Factory",
    previousWebhookSecret: null,
    previousWebhookSecretUntil: null,
  },
};

const T0 = new Date("2031-04-01T10:00:00.000Z");

/** A window far from any real one, so nothing here collides with a running app. */
function build(
  inner: FakeBillingProvider,
  priority: ProviderPriority,
  budgetSettings = { windowSeconds: 60, limit: 10, headroomForPriority1: 3, headroomForPriority2: 3, orphanCeiling: 2 },
) {
  const store = new PostgresRateLimitStore();

  return buildBillingProvider(enabled, priority, {
    inner,
    budget: new ProviderBudget("TEST", { store, settings: budgetSettings, now: () => T0 }),
    health: new ProviderHealthTracker("TEST", keyFingerprint(KEY_ID), {
      settings: { baseSeconds: 30, capSeconds: 900, consecutiveFailureThreshold: 5 },
      // Cooldown time is real time here; the budget window is frozen above.
    }),
  });
}

async function cleanup() {
  await prisma.billingProviderState.deleteMany();
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "razorpay-outbound:" } } });
}

beforeEach(cleanup);
afterEach(async () => {
  vi.unstubAllEnvs();
  resetProviderConfigurationForTests();
  resetBillingProviderForTests();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("a rate limit puts background work to sleep, but not a waiting customer", () => {
  it("refuses priorities 2-4 without reaching the provider, and still lets a command through", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });
    inner.seed({ providerSubscriptionId: "sub_a", rawStatus: "active" });
    inner.failNext("fetchSubscription", "RATE_LIMITED");

    // A confirmation-priority read is answered 429 by the provider.
    expect(await build(inner, ProviderPriority.CONFIRMATION).fetchSubscription("sub_a")).toMatchObject({
      kind: "FAILURE",
      failureClass: "RATE_LIMITED",
    });
    expect(inner.calls).toHaveLength(1);

    // Every background priority is now refused, and none of them reaches the provider.
    for (const priority of [
      ProviderPriority.CONFIRMATION,
      ProviderPriority.RECONCILIATION,
      ProviderPriority.ORPHAN_DISCOVERY,
    ]) {
      expect(await build(inner, priority).fetchSubscription("sub_a")).toEqual({
        kind: "FAILURE",
        failureClass: "BUDGET_EXHAUSTED",
      });
    }
    expect(inner.calls).toHaveLength(1);

    // A customer command still gets a real answer.
    expect(await build(inner, ProviderPriority.COMMAND).fetchSubscription("sub_a")).toMatchObject({
      kind: "SUCCESS",
    });
    expect(inner.calls).toHaveLength(2);
  });

  it("does not resend or mark anything as failed for a refused background call", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });
    inner.failNext("fetchSubscription", "RATE_LIMITED");
    await build(inner, ProviderPriority.RECONCILIATION).fetchSubscription("sub_a");

    const refused = await build(inner, ProviderPriority.RECONCILIATION).cancelSubscription("sub_a", {
      atCycleEnd: false,
    });

    // Nothing left the process, so it is a plain "not applied", never an unknown outcome.
    expect(refused).not.toHaveProperty("requestSentAt");
  });
});

describe("a rejected key stops everything until it changes", () => {
  it("refuses every priority once a call is answered 401", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });
    inner.failNext("fetchSubscription", "AUTH_FAILURE");

    await build(inner, ProviderPriority.COMMAND).fetchSubscription("sub_a");

    for (const priority of Object.values(ProviderPriority)) {
      expect(await build(inner, priority).fetchSubscription("sub_a")).toEqual({
        kind: "FAILURE",
        failureClass: "AUTH_FAILURE",
      });
    }

    // Only the first call ever reached the provider.
    expect(inner.calls).toHaveLength(1);
  });

  it("lifts for a rotated key, without touching the database by hand", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });
    inner.failNext("fetchSubscription", "AUTH_FAILURE");
    await build(inner, ProviderPriority.COMMAND).fetchSubscription("sub_a");

    const rotated = buildBillingProvider(
      { ...enabled, razorpay: { ...enabled.razorpay, keyId: "rzp_test_FactoryKey002" } },
      ProviderPriority.COMMAND,
      { inner, store: new PostgresRateLimitStore() },
    );

    expect(await rotated.fetchSubscription("sub_missing")).toMatchObject({ failureClass: "NOT_FOUND" });
    expect(inner.calls).toHaveLength(2);
  });
});

describe("the budget caps a burst", () => {
  it("admits a ceiling's worth of calls, then refuses without sending", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });
    const outcomes: string[] = [];

    for (let i = 0; i < 6; i += 1) {
      const outcome = await build(inner, ProviderPriority.RECONCILIATION).fetchSubscription("sub_a");
      outcomes.push(outcome.kind === "FAILURE" ? outcome.failureClass : outcome.kind);
    }

    // P3's ceiling is 4 of 10.
    expect(outcomes).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED"]);
    expect(inner.calls).toHaveLength(4);
  });

  it("keeps the customer's share available while a backlog is being held back", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });

    for (let i = 0; i < 8; i += 1) await build(inner, ProviderPriority.RECONCILIATION).fetchSubscription("sub_a");

    const command = await build(inner, ProviderPriority.COMMAND).cancelSubscription("sub_a", { atCycleEnd: false });

    expect(command).toMatchObject({ kind: "FAILURE", failureClass: "NOT_FOUND" });
    expect(command).toHaveProperty("requestSentAt");
  });

  it("a failed call still spends its unit: the provider was asked", async () => {
    const inner = new FakeBillingProvider({ now: () => T0 });
    inner.failNext("*", "TIMEOUT", { times: 4 });

    for (let i = 0; i < 4; i += 1) await build(inner, ProviderPriority.RECONCILIATION).fetchSubscription("sub_a");

    expect(await build(inner, ProviderPriority.RECONCILIATION).fetchSubscription("sub_a")).toEqual({
      kind: "FAILURE",
      failureClass: "BUDGET_EXHAUSTED",
    });
  });
});

describe("a disabled deployment touches nothing", () => {
  it("answers PROVIDER_DISABLED to every operation with no budget, no cooldown and no rows", async () => {
    const provider = buildBillingProvider({ mode: "DISABLED" }, ProviderPriority.COMMAND);

    expect(await provider.fetchSubscription("sub_a")).toEqual({ kind: "PROVIDER_DISABLED" });
    expect(await provider.cancelSubscription("sub_a", { atCycleEnd: false })).toEqual({
      kind: "PROVIDER_DISABLED",
    });
    expect(
      await provider.createSubscription({
        plan: "PRO",
        cycle: "MONTHLY",
        totalCount: 600,
        expireBy: T0,
        notes: { kz_sub: "s", kz_op: "o", kz_env: "TEST" },
      }),
    ).toEqual({ kind: "PROVIDER_DISABLED" });
    expect(await provider.listSubscriptions({ from: T0, to: T0 }, { count: 1, skip: 0 })).toEqual({
      kind: "PROVIDER_DISABLED",
    });

    expect(await prisma.billingProviderState.count()).toBe(0);
    expect(await prisma.rateLimit.count({ where: { key: { startsWith: "razorpay-outbound:" } } })).toBe(0);
  });

  it("fails verification closed, since there is no secret to verify with", () => {
    const provider = buildBillingProvider({ mode: "DISABLED" }, ProviderPriority.COMMAND);

    expect(provider.verifyWebhookSignature("{}", "anything")).toEqual({ valid: false });
    expect(provider.verifyCheckoutSignature("pay_1", "sub_1", "anything")).toBe(false);
  });

  it("is what getBillingProvider returns when no credentials are configured", async () => {
    for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ACCOUNT_ID"]) {
      vi.stubEnv(name, "");
    }
    validateBillingConfigurationAtBoot();

    expect(await getBillingProvider(ProviderPriority.COMMAND).fetchSubscription("sub_a")).toEqual({
      kind: "PROVIDER_DISABLED",
    });
  });
});

describe("the real Razorpay provider is wrapped, never bare", () => {
  it("getBillingProvider returns a budgeted provider for an enabled configuration", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", KEY_ID);
    vi.stubEnv("RAZORPAY_KEY_SECRET", "factory-key-secret");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "factory-webhook-secret");
    vi.stubEnv("RAZORPAY_ACCOUNT_ID", "acc_Factory");
    vi.stubEnv("BILLING_EXPECTED_MODE", "test");
    validateBillingConfigurationAtBoot();

    const provider = getBillingProvider(ProviderPriority.COMMAND);

    // It verifies with the configured webhook secret (the real provider's job)...
    expect(provider.verifyWebhookSignature("{}", "not-a-signature")).toEqual({ valid: false });
    // ...and it is the budgeted decorator, not the bare implementation.
    expect(provider.constructor.name).toBe("BudgetedProvider");
  });
});
