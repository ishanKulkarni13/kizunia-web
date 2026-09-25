import { describe, expect, it } from "vitest";

import { SubscriptionPhase } from "@/generated/prisma";

import {
  CONTRIBUTING_PHASES,
  isSubscriptionContributing,
  subscriptionContribution,
} from "./subscription-contribution";

describe("CONTRIBUTING_PHASES", () => {
  it("are exactly TRIALING, ACTIVE and PAST_DUE (SB-EA-06)", () => {
    expect([...CONTRIBUTING_PHASES].sort()).toEqual(["ACTIVE", "PAST_DUE", "TRIALING"]);
  });
});

describe("subscriptionContribution — every phase, in the expected mode", () => {
  const expected = {
    PROVISIONING: false,
    PENDING_AUTHENTICATION: false,
    TRIALING: true,
    ACTIVE: true,
    PAST_DUE: true,
    HALTED: false,
    PAUSED: false,
    CANCELLED: false,
    EXPIRED: false,
    COMPLETED: false,
    ABANDONED: false,
  } as const satisfies Record<SubscriptionPhase, boolean>;

  it("decides every phase the schema defines, so a new phase forces a decision here", () => {
    expect(Object.keys(expected).sort()).toEqual(Object.values(SubscriptionPhase).sort());
  });

  it.each(Object.entries(expected))("%s contributes: %s", (phase, contributes) => {
    const facts = { phase: phase as SubscriptionPhase, providerMode: "LIVE" as const };

    expect(isSubscriptionContributing(facts, "LIVE")).toBe(contributes);
    expect(subscriptionContribution(facts, "LIVE")).toBe(contributes ? "CONTRIBUTING" : "NON_CONTRIBUTING_PHASE");
  });

  it("keeps PAST_DUE contributing: a payment retry in progress must not cost access", () => {
    expect(isSubscriptionContributing({ phase: "PAST_DUE", providerMode: "TEST" }, "TEST")).toBe(true);
  });
});

describe("subscriptionContribution — TEST/LIVE isolation (SB-EA-07)", () => {
  it("never lets a TEST subscription contribute in a LIVE-expected deployment", () => {
    for (const phase of Object.values(SubscriptionPhase)) {
      expect(isSubscriptionContributing({ phase, providerMode: "TEST" }, "LIVE")).toBe(false);
    }
  });

  it("never lets a LIVE subscription contribute in a TEST-expected deployment", () => {
    for (const phase of Object.values(SubscriptionPhase)) {
      expect(isSubscriptionContributing({ phase, providerMode: "LIVE" }, "TEST")).toBe(false);
    }
  });

  it("names the mode as the reason, ahead of the phase", () => {
    // A row from the wrong mode is not this deployment's subscription at all,
    // so "wrong mode" is the answer even when its phase would also grant nothing.
    expect(subscriptionContribution({ phase: "ACTIVE", providerMode: "TEST" }, "LIVE")).toBe("MODE_MISMATCH");
    expect(subscriptionContribution({ phase: "CANCELLED", providerMode: "TEST" }, "LIVE")).toBe("MODE_MISMATCH");
  });

  it("contributes in each mode when the mode matches", () => {
    expect(isSubscriptionContributing({ phase: "ACTIVE", providerMode: "TEST" }, "TEST")).toBe(true);
    expect(isSubscriptionContributing({ phase: "ACTIVE", providerMode: "LIVE" }, "LIVE")).toBe(true);
  });
});
