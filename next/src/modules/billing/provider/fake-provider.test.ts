import { describe, expect, it } from "vitest";

import { ProviderFailureClass as ProviderFailureClassEnum, type ProviderFailureClass } from "@/generated/prisma";

import { FakeBillingProvider, type FakeNetworkMethod } from "./fake-provider";
import type { CreateSubscriptionInput } from "./types";

const T0 = new Date("2026-09-25T10:00:00.000Z");

function fake(now: Date = T0) {
  return new FakeBillingProvider({ now: () => now });
}

const createInput: CreateSubscriptionInput = {
  plan: "PRO",
  cycle: "MONTHLY",
  totalCount: 600,
  expireBy: new Date("2026-09-26T10:00:00.000Z"),
  notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
};

/** One call of every network method, against a subscription that exists. */
function callEveryMethod(provider: FakeBillingProvider): Record<FakeNetworkMethod, () => Promise<unknown>> {
  return {
    createSubscription: () => provider.createSubscription(createInput),
    updateSubscriptionPlan: () =>
      provider.updateSubscriptionPlan("sub_x", { plan: "PRO_PLUS", cycle: "MONTHLY", scheduleChangeAt: "NOW" }),
    cancelScheduledChange: () => provider.cancelScheduledChange("sub_x"),
    cancelSubscription: () => provider.cancelSubscription("sub_x", { atCycleEnd: false }),
    fetchSubscription: () => provider.fetchSubscription("sub_x"),
    listSubscriptions: () => provider.listSubscriptions({ from: T0, to: T0 }, { count: 10, skip: 0 }),
    fetchAuthorizationPaymentMethod: () => provider.fetchAuthorizationPaymentMethod("pay_x"),
  };
}

const ALL_FAILURE_CLASSES: ProviderFailureClass[] = [
  "TIMEOUT",
  "UNAVAILABLE",
  "RATE_LIMITED",
  "CONCURRENT_OPERATION",
  "REJECTED",
  "NOT_FOUND",
  "AUTH_FAILURE",
  "MALFORMED",
  "UNMAPPED_PLAN",
  "BUDGET_EXHAUSTED",
];

describe("FakeBillingProvider — every failure class, on every operation", () => {
  const methods: FakeNetworkMethod[] = [
    "createSubscription",
    "updateSubscriptionPlan",
    "cancelScheduledChange",
    "cancelSubscription",
    "fetchSubscription",
    "listSubscriptions",
    "fetchAuthorizationPaymentMethod",
  ];

  for (const method of methods) {
    it(`${method} can fail as each of the ten classes`, async () => {
      for (const failureClass of ALL_FAILURE_CLASSES) {
        const provider = fake();
        provider.failNext(method, failureClass);

        const outcome = await callEveryMethod(provider)[method]();

        expect(outcome).toMatchObject({ kind: "FAILURE", failureClass });
      }
    });
  }

  it("covers every class of the provider failure taxonomy", () => {
    // Guards the list above against the enum growing a class it does not cover.
    expect([...ALL_FAILURE_CLASSES].sort()).toEqual(Object.values(ProviderFailureClassEnum).sort());
  });
});

describe("FakeBillingProvider — failure semantics", () => {
  it("stamps requestSentAt when a request would have reached the provider", async () => {
    for (const failureClass of ALL_FAILURE_CLASSES) {
      const provider = fake();
      provider.failNext("fetchSubscription", failureClass);

      const outcome = await provider.fetchSubscription("sub_x");

      if (failureClass === "BUDGET_EXHAUSTED" || failureClass === "UNMAPPED_PLAN") {
        // Decided before anything is sent: not an unknown outcome.
        expect(outcome).not.toHaveProperty("requestSentAt");
      } else {
        expect(outcome).toMatchObject({ requestSentAt: T0 });
      }
    }
  });

  it("carries the provider's code and description for diagnosis", async () => {
    const provider = fake();
    provider.failNext("cancelSubscription", "REJECTED", {
      providerErrorCode: "BAD_REQUEST_ERROR",
      providerErrorDescription: "not cancellable",
    });

    expect(await provider.cancelSubscription("sub_x", { atCycleEnd: true })).toMatchObject({
      failureClass: "REJECTED",
      providerErrorCode: "BAD_REQUEST_ERROR",
      providerErrorDescription: "not cancellable",
    });
  });

  it("consumes a scripted failure once, then behaves normally", async () => {
    const provider = fake();
    provider.failNext("createSubscription", "TIMEOUT");

    expect(await provider.createSubscription(createInput)).toMatchObject({ kind: "FAILURE" });
    expect(await provider.createSubscription(createInput)).toMatchObject({ kind: "SUCCESS" });
  });

  it("can fail several calls in a row", async () => {
    const provider = fake();
    provider.failNext("fetchSubscription", "UNAVAILABLE", { times: 3 });

    for (let i = 0; i < 3; i += 1) {
      expect(await provider.fetchSubscription("sub_x")).toMatchObject({ failureClass: "UNAVAILABLE" });
    }
    expect(await provider.fetchSubscription("sub_x")).toMatchObject({ failureClass: "REJECTED" });
  });

  it('fails any method with "*", and only the scripted method otherwise', async () => {
    const provider = fake();
    provider.failNext("cancelSubscription", "REJECTED");

    // A different method is untouched, and does not consume the script.
    expect(await provider.fetchSubscription("sub_x")).toMatchObject({ failureClass: "REJECTED" });
    expect(await provider.cancelSubscription("sub_x", { atCycleEnd: false })).toMatchObject({
      failureClass: "REJECTED",
    });

    provider.failNext("*", "RATE_LIMITED", { times: 2 });
    expect(await provider.fetchSubscription("sub_x")).toMatchObject({ failureClass: "RATE_LIMITED" });
    expect(await provider.listSubscriptions({ from: T0, to: T0 }, { count: 1, skip: 0 })).toMatchObject({
      failureClass: "RATE_LIMITED",
    });
  });

  it("does not change stored state when a mutation fails", async () => {
    const provider = fake();
    const created = await provider.createSubscription(createInput);
    if (created.kind !== "SUCCESS") throw new Error("expected success");
    const id = created.value.providerSubscriptionId;

    provider.failNext("cancelSubscription", "TIMEOUT");
    await provider.cancelSubscription(id, { atCycleEnd: false });

    expect(provider.peek(id)?.rawStatus).toBe("created");
  });
});

describe("FakeBillingProvider — disabled mode", () => {
  it("answers PROVIDER_DISABLED to every network operation, without doing any work", async () => {
    const provider = fake().disable();
    const calls = callEveryMethod(provider);

    for (const call of Object.values(calls)) {
      expect(await call()).toEqual({ kind: "PROVIDER_DISABLED" });
    }

    // Nothing was created behind the refusal.
    expect(provider.peek("sub_fake_1")).toBeUndefined();
  });

  it("works again once re-enabled", async () => {
    const provider = fake().disable().enable();

    expect(await provider.createSubscription(createInput)).toMatchObject({ kind: "SUCCESS" });
  });
});

describe("FakeBillingProvider — the happy path", () => {
  it("creates a subscription, echoing Kizunia's notes, and stamps observationAt from the clock", async () => {
    const provider = fake();
    const outcome = await provider.createSubscription(createInput);

    expect(outcome).toMatchObject({
      kind: "SUCCESS",
      observationAt: T0,
      value: {
        rawStatus: "created",
        notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
        expireBy: createInput.expireBy,
      },
    });
    expect(outcome.kind === "SUCCESS" && outcome.value.shortUrl).toContain("fake.invalid");
  });

  it("fetches what it created, and answers an unknown ID as Razorpay does (REJECTED, D12)", async () => {
    const provider = fake();
    const created = await provider.createSubscription(createInput);
    if (created.kind !== "SUCCESS") throw new Error("expected success");

    expect(await provider.fetchSubscription(created.value.providerSubscriptionId)).toMatchObject({
      kind: "SUCCESS",
      value: { providerSubscriptionId: created.value.providerSubscriptionId },
    });
    expect(await provider.fetchSubscription("sub_missing")).toMatchObject({
      failureClass: "REJECTED",
      providerErrorCode: "BAD_REQUEST_ERROR",
    });
  });

  it("cancels immediately, refuses a second cancel, and leaves a cycle-end cancel unobservable", async () => {
    const provider = fake();
    provider.seed({ providerSubscriptionId: "sub_a", rawStatus: "active" });
    provider.seed({ providerSubscriptionId: "sub_b", rawStatus: "active" });

    // Cycle-end: accepted, and nothing observable changes (A2).
    const atCycleEnd = await provider.cancelSubscription("sub_a", { atCycleEnd: true });
    expect(atCycleEnd).toMatchObject({ kind: "SUCCESS", value: { rawStatus: "active" } });

    const immediate = await provider.cancelSubscription("sub_b", { atCycleEnd: false });
    expect(immediate).toMatchObject({ kind: "SUCCESS", value: { rawStatus: "cancelled" } });
    expect(await provider.cancelSubscription("sub_b", { atCycleEnd: false })).toMatchObject({
      failureClass: "REJECTED",
    });
  });

  it("schedules and cancels a plan change", async () => {
    const provider = fake();
    provider.seed({ providerSubscriptionId: "sub_a", rawStatus: "active" });

    const scheduled = await provider.updateSubscriptionPlan("sub_a", {
      plan: "PRO_PLUS",
      cycle: "MONTHLY",
      scheduleChangeAt: "CYCLE_END",
    });
    expect(scheduled).toMatchObject({ value: { hasScheduledChanges: true } });

    expect(await provider.cancelScheduledChange("sub_a")).toMatchObject({
      value: { hasScheduledChanges: false },
    });
    // Nothing pending any more.
    expect(await provider.cancelScheduledChange("sub_a")).toMatchObject({ failureClass: "REJECTED" });
  });

  it("refuses a plan change on a subscription that is not active or authenticated", async () => {
    const provider = fake();
    provider.seed({ providerSubscriptionId: "sub_a", rawStatus: "created" });

    expect(
      await provider.updateSubscriptionPlan("sub_a", { plan: "PRO", cycle: "YEARLY", scheduleChangeAt: "NOW" }),
    ).toMatchObject({ failureClass: "REJECTED" });
  });

  it("lists by creation time with both bounds inclusive, and pages", async () => {
    const provider = fake();
    const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
    provider.seed({ providerSubscriptionId: "sub_1" }, at(0));
    provider.seed({ providerSubscriptionId: "sub_2" }, at(10));
    provider.seed({ providerSubscriptionId: "sub_3" }, at(20));

    const ids = async (from: Date, to: Date, count = 100, skip = 0) => {
      const outcome = await provider.listSubscriptions({ from, to }, { count, skip });

      return outcome.kind === "SUCCESS" ? outcome.value.items.map((s) => s.providerSubscriptionId) : [];
    };

    expect(await ids(at(0), at(20))).toEqual(["sub_1", "sub_2", "sub_3"]);
    expect(await ids(at(10), at(10))).toEqual(["sub_2"]);
    expect(await ids(at(11), at(19))).toEqual([]);
    expect(await ids(at(0), at(20), 2, 0)).toEqual(["sub_1", "sub_2"]);
    expect(await ids(at(0), at(20), 2, 2)).toEqual(["sub_3"]);
  });

  it("returns a payment method it was told about", async () => {
    const provider = fake().setPaymentMethod("pay_1", { method: "card", international: false });

    expect(await provider.fetchAuthorizationPaymentMethod("pay_1")).toMatchObject({
      value: { method: "card", international: false },
    });
  });

  it("records every network call in order, and not verification calls", async () => {
    const provider = fake();
    await provider.createSubscription(createInput);
    await provider.fetchSubscription("sub_fake_1");
    provider.verifyWebhookSignature("{}", "sig");
    provider.verifyCheckoutSignature("pay", "sub", "sig");

    expect(provider.calls.map((call) => call.method)).toEqual(["createSubscription", "fetchSubscription"]);
  });
});

describe("FakeBillingProvider — verification", () => {
  it("verifies signatures it produced, and only those", () => {
    const provider = fake();
    const body = '{"event":"subscription.charged"}';

    expect(provider.verifyWebhookSignature(body, provider.signWebhook(body))).toEqual({
      valid: true,
      matchedSecret: "CURRENT",
    });
    expect(provider.verifyWebhookSignature(body, "deadbeef")).toEqual({ valid: false });
    expect(provider.verifyWebhookSignature(`${body} `, provider.signWebhook(body))).toEqual({ valid: false });

    expect(provider.verifyCheckoutSignature("pay_1", "sub_1", provider.signCheckout("pay_1", "sub_1"))).toBe(true);
    expect(provider.verifyCheckoutSignature("pay_1", "sub_2", provider.signCheckout("pay_1", "sub_1"))).toBe(false);
  });

  it("accepts a previous webhook secret until its rotation deadline, and says which matched", () => {
    const until = new Date(T0.getTime() + 60_000);
    const provider = new FakeBillingProvider({
      now: () => T0,
      previousWebhookSecret: "old-secret",
      previousWebhookSecretUntil: until,
    });
    const body = provider.webhookBody({ eventType: "subscription.charged", providerSubscriptionId: "sub_1" });
    const old = provider.signWebhookWithPrevious(body);

    expect(provider.verifyWebhookSignature(body, old, T0)).toEqual({ valid: true, matchedSecret: "PREVIOUS" });
    expect(provider.verifyWebhookSignature(body, old, until)).toEqual({ valid: false });
    expect(provider.verifyWebhookSignature(body, provider.signWebhook(body), until)).toEqual({
      valid: true,
      matchedSecret: "CURRENT",
    });
  });

  it("builds Razorpay-shaped events that the real parser reads", () => {
    const provider = fake();
    provider.seed({ providerSubscriptionId: "sub_1", rawStatus: "active", notes: { kz_sub: "k1" } });

    const parsed = provider.parseWebhookEvent(
      provider.webhookBody({
        eventType: "subscription.charged",
        providerSubscriptionId: "sub_1",
        payment: { id: "pay_1", amount: 1000, invoiceId: "inv_1" },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "EVENT",
      category: "SUBSCRIPTION",
      accountId: "acc_fake",
      providerSubscriptionId: "sub_1",
      moneyFact: { kind: "CHARGE", providerObjectId: "pay_1", amountMinor: 1000, providerInvoiceId: "inv_1" },
    });
  });
});
