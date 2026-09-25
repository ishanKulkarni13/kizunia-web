import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderFailureClass } from "@/generated/prisma";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";

import {
  BudgetedProvider,
  type ProviderBudgetGate,
  type ProviderHealth,
  type ProviderVerdict,
} from "./budgeted-provider";
import { FakeBillingProvider } from "./fake-provider";
import { ProviderPriority, type CreateSubscriptionInput } from "./types";

const T0 = new Date("2026-09-25T10:00:00.000Z");

const createInput: CreateSubscriptionInput = {
  plan: "PRO",
  cycle: "MONTHLY",
  totalCount: 600,
  expireBy: new Date("2026-09-26T10:00:00.000Z"),
  notes: { kz_sub: "ksub_1", kz_op: "kop_1", kz_env: "TEST" },
};

class ScriptedGate implements ProviderBudgetGate {
  readonly acquired: ProviderPriority[] = [];
  allow = true;
  throwOnAcquire = false;

  async acquire(priority: ProviderPriority): Promise<boolean> {
    if (this.throwOnAcquire) throw new Error("store down");
    if (!this.allow) return false;

    this.acquired.push(priority);

    return true;
  }
}

class ScriptedHealth implements ProviderHealth {
  readonly recorded: Array<ProviderFailureClass | "SUCCESS"> = [];
  verdictToReturn: ProviderVerdict = "CLEAR";
  verdictCalls = 0;
  throwOnVerdict = false;
  throwOnRecord = false;

  async verdict(): Promise<ProviderVerdict> {
    this.verdictCalls += 1;
    if (this.throwOnVerdict) throw new Error("store down");

    return this.verdictToReturn;
  }

  async record(result: ProviderFailureClass | "SUCCESS"): Promise<void> {
    if (this.throwOnRecord) throw new Error("store down");
    this.recorded.push(result);
  }
}

function setup(priority: ProviderPriority = ProviderPriority.COMMAND) {
  const inner = new FakeBillingProvider({ now: () => T0 });
  const gate = new ScriptedGate();
  const health = new ScriptedHealth();

  return { inner, gate, health, provider: new BudgetedProvider(inner, gate, health, priority) };
}

let records: LogRecord[];

beforeEach(() => {
  records = [];
  setLogSink((record) => {
    records.push(record);
  });
});
afterEach(resetLogSink);

describe("BudgetedProvider — a call that is allowed", () => {
  it("acquires one unit at the caller's priority, sends the call and returns its outcome untouched", async () => {
    for (const priority of Object.values(ProviderPriority)) {
      const { provider, inner, gate } = setup(priority);

      const outcome = await provider.createSubscription(createInput);

      expect(gate.acquired).toEqual([priority]);
      expect(inner.calls.map((call) => call.method)).toEqual(["createSubscription"]);
      // observationAt is the inner provider's send time, passed through as is.
      expect(outcome).toMatchObject({ kind: "SUCCESS", observationAt: T0 });
    }
  });

  it("records a success", async () => {
    const { provider, health } = setup();

    await provider.createSubscription(createInput);

    expect(health.recorded).toEqual(["SUCCESS"]);
  });

  it("records each failure class the provider returns, and returns the failure unchanged", async () => {
    const classes: ProviderFailureClass[] = [
      "TIMEOUT",
      "UNAVAILABLE",
      "RATE_LIMITED",
      "CONCURRENT_OPERATION",
      "REJECTED",
      "NOT_FOUND",
      "AUTH_FAILURE",
      "MALFORMED",
    ];

    for (const failureClass of classes) {
      const { provider, inner, health } = setup();
      inner.failNext("fetchSubscription", failureClass);

      const outcome = await provider.fetchSubscription("sub_x");

      expect(outcome).toMatchObject({ kind: "FAILURE", failureClass, requestSentAt: T0 });
      expect(health.recorded).toEqual([failureClass]);
    }
  });

  it("does not resend a mutation whose outcome is unknown", async () => {
    const { provider, inner } = setup();
    inner.failNext("cancelSubscription", "TIMEOUT");

    const outcome = await provider.cancelSubscription("sub_x", { atCycleEnd: false });

    expect(outcome).toMatchObject({ failureClass: "TIMEOUT", requestSentAt: T0 });
    expect(inner.calls.filter((call) => call.method === "cancelSubscription")).toHaveLength(1);
  });

  it("records nothing when the provider is disabled: nothing was attempted", async () => {
    const { provider, inner, health } = setup();
    inner.disable();

    expect(await provider.fetchSubscription("sub_x")).toEqual({ kind: "PROVIDER_DISABLED" });
    expect(health.recorded).toEqual([]);
  });
});

describe("BudgetedProvider — every network operation is guarded", () => {
  const operations: Array<[string, (p: BudgetedProvider) => Promise<unknown>]> = [
    ["createSubscription", (p) => p.createSubscription(createInput)],
    [
      "updateSubscriptionPlan",
      (p) => p.updateSubscriptionPlan("sub_x", { plan: "PRO", cycle: "MONTHLY", scheduleChangeAt: "NOW" }),
    ],
    ["cancelScheduledChange", (p) => p.cancelScheduledChange("sub_x")],
    ["cancelSubscription", (p) => p.cancelSubscription("sub_x", { atCycleEnd: true })],
    ["fetchSubscription", (p) => p.fetchSubscription("sub_x")],
    ["listSubscriptions", (p) => p.listSubscriptions({ from: T0, to: T0 }, { count: 10, skip: 0 })],
    ["fetchAuthorizationPaymentMethod", (p) => p.fetchAuthorizationPaymentMethod("pay_x")],
  ];

  it.each(operations)("%s is refused, and never sent, when there is no budget", async (_name, call) => {
    const { provider, inner, gate, health } = setup();
    gate.allow = false;

    const outcome = await call(provider);

    expect(outcome).toEqual({ kind: "FAILURE", failureClass: "BUDGET_EXHAUSTED" });
    expect(inner.calls).toHaveLength(0);
    expect(health.recorded).toEqual([]);
  });

  it.each(operations)("%s is refused when the credentials are pinned as failing", async (_name, call) => {
    const { provider, inner, health } = setup();
    health.verdictToReturn = "AUTH_PINNED";

    expect(await call(provider)).toEqual({ kind: "FAILURE", failureClass: "AUTH_FAILURE" });
    expect(inner.calls).toHaveLength(0);
  });
});

describe("BudgetedProvider — a refusal is not an unknown outcome", () => {
  it("carries no requestSentAt, whatever the reason", async () => {
    const budget = setup();
    budget.gate.allow = false;

    const pinned = setup();
    pinned.health.verdictToReturn = "AUTH_PINNED";

    const cooling = setup(ProviderPriority.RECONCILIATION);
    cooling.health.verdictToReturn = "COOLING_DOWN";

    for (const { provider } of [budget, pinned, cooling]) {
      expect(await provider.cancelSubscription("sub_x", { atCycleEnd: false })).not.toHaveProperty(
        "requestSentAt",
      );
    }
  });
});

describe("BudgetedProvider — the auth pin", () => {
  it("refuses every priority, including commands, before spending any budget", async () => {
    for (const priority of Object.values(ProviderPriority)) {
      const { provider, gate, health, inner } = setup(priority);
      health.verdictToReturn = "AUTH_PINNED";

      expect(await provider.fetchSubscription("sub_x")).toMatchObject({ failureClass: "AUTH_FAILURE" });
      expect(gate.acquired).toEqual([]);
      expect(inner.calls).toHaveLength(0);
    }
  });
});

describe("BudgetedProvider — the global cooldown", () => {
  it("keeps priorities 2, 3 and 4 off the provider entirely, without spending budget", async () => {
    for (const priority of [
      ProviderPriority.CONFIRMATION,
      ProviderPriority.RECONCILIATION,
      ProviderPriority.ORPHAN_DISCOVERY,
    ]) {
      const { provider, gate, health, inner } = setup(priority);
      health.verdictToReturn = "COOLING_DOWN";

      expect(await provider.fetchSubscription("sub_x")).toEqual({
        kind: "FAILURE",
        failureClass: "BUDGET_EXHAUSTED",
      });
      expect(gate.acquired).toEqual([]);
      expect(inner.calls).toHaveLength(0);
    }
  });

  it("still lets a customer command try: they should get a real answer if the provider has recovered", async () => {
    const { provider, gate, health, inner } = setup(ProviderPriority.COMMAND);
    health.verdictToReturn = "COOLING_DOWN";

    expect(await provider.cancelSubscription("sub_x", { atCycleEnd: false })).toMatchObject({
      failureClass: "NOT_FOUND",
    });
    // It still spends budget like any other call.
    expect(gate.acquired).toEqual([ProviderPriority.COMMAND]);
    expect(inner.calls).toHaveLength(1);
  });

  it("logs why a call was refused", async () => {
    const cooling = setup(ProviderPriority.RECONCILIATION);
    cooling.health.verdictToReturn = "COOLING_DOWN";
    await cooling.provider.fetchSubscription("sub_x");

    const pinned = setup();
    pinned.health.verdictToReturn = "AUTH_PINNED";
    await pinned.provider.fetchSubscription("sub_x");

    expect(records.filter((r) => r.event === "budget.refused").map((r) => r.fields.reason)).toEqual([
      "COOLDOWN",
      "AUTH_PINNED",
    ]);
  });
});

describe("BudgetedProvider — the state store failing", () => {
  it("fails closed when the budget cannot be read: nothing is sent without a unit", async () => {
    const { provider, gate, inner } = setup();
    gate.throwOnAcquire = true;

    expect(await provider.fetchSubscription("sub_x")).toEqual({
      kind: "FAILURE",
      failureClass: "BUDGET_EXHAUSTED",
    });
    expect(inner.calls).toHaveLength(0);
    expect(records.some((r) => r.event === "budget.refused" && r.fields.reason === "STORE_ERROR")).toBe(true);
  });

  it("proceeds to the budget check when the verdict cannot be read", async () => {
    const { provider, health, gate, inner } = setup();
    health.throwOnVerdict = true;

    expect(await provider.fetchSubscription("sub_x")).toMatchObject({ failureClass: "NOT_FOUND" });
    expect(gate.acquired).toEqual([ProviderPriority.COMMAND]);
    expect(inner.calls).toHaveLength(1);
  });

  it("never turns a completed call into an error because recording it failed", async () => {
    const { provider, health, inner } = setup();
    health.throwOnRecord = true;

    // The mutation reached the provider; its result must survive.
    const outcome = await provider.createSubscription(createInput);

    expect(outcome).toMatchObject({ kind: "SUCCESS" });
    expect(inner.calls).toHaveLength(1);
    expect(records.some((r) => r.event === "health.record_failed")).toBe(true);
  });
});

describe("BudgetedProvider — verification is not a network operation", () => {
  it("passes straight through with no budget, no verdict and no recording", () => {
    const { provider, inner, gate, health } = setup();
    gate.allow = false;
    health.verdictToReturn = "AUTH_PINNED";

    const body = '{"event":"subscription.charged"}';

    expect(provider.verifyWebhookSignature(body, inner.signWebhook(body))).toEqual({
      valid: true,
      matchedSecret: "CURRENT",
    });
    expect(provider.verifyCheckoutSignature("pay_1", "sub_1", inner.signCheckout("pay_1", "sub_1"))).toBe(true);
    expect(health.verdictCalls).toBe(0);
    expect(gate.acquired).toEqual([]);
  });
});
