import { describe, expect, it } from "vitest";

import { NO_BILLING_HISTORY } from "./code-eligibility";
import { isTrialEligible } from "./trial-eligibility";
import { trialFunnelEvent } from "./trial-funnel";

describe("isTrialEligible — one trial per account (SB-LC-11)", () => {
  it("is eligible until a TRIAL subscription reached TRIALING", () => {
    expect(isTrialEligible(NO_BILLING_HISTORY)).toBe(true);
    expect(isTrialEligible({ trialConsumed: false })).toBe(true);
  });

  it("is not eligible once one did (cancelled, converted or failed all count)", () => {
    expect(isTrialEligible({ trialConsumed: true })).toBe(false);
  });

  it("is not affected by ordinary paid history: a subscriber who never trialed may still trial", () => {
    const paidBefore = { ...NO_BILLING_HISTORY, hadQualifyingSubscription: true };

    expect(isTrialEligible(paidBefore)).toBe(true);
  });
});

describe("trialFunnelEvent", () => {
  it("names each transition of a TRIAL subscription", () => {
    expect(trialFunnelEvent("TRIAL", "PENDING_AUTHENTICATION", "TRIALING")).toBe("trial.started");
    expect(trialFunnelEvent("TRIAL", "TRIALING", "ACTIVE")).toBe("trial.converted");
    expect(trialFunnelEvent("TRIAL", "TRIALING", "PAST_DUE")).toBe("trial.first_charge_failed");
    expect(trialFunnelEvent("TRIAL", "TRIALING", "CANCELLED")).toBe("trial.cancelled");
    expect(trialFunnelEvent("TRIAL", "TRIALING", "PENDING_AUTHENTICATION")).toBe("trial.ended");
  });

  it("is silent for a STANDARD subscription, a non-transition, and transitions that are not the funnel", () => {
    expect(trialFunnelEvent("STANDARD", "PENDING_AUTHENTICATION", "TRIALING")).toBeNull();
    expect(trialFunnelEvent("TRIAL", "TRIALING", "TRIALING")).toBeNull();
    expect(trialFunnelEvent("TRIAL", "PENDING_AUTHENTICATION", "CANCELLED")).toBeNull();
    expect(trialFunnelEvent("TRIAL", "ACTIVE", "PAST_DUE")).toBeNull();
  });
});
