import { describe, expect, it } from "vitest";

import {
  evaluateOfferCode,
  isWithinWindow,
  normalizeCode,
  NO_BILLING_HISTORY,
  satisfiesEligibility,
  type BillingHistory,
  type OfferCodeDefinition,
} from "./code-eligibility";

const NOW = new Date("2026-09-26T12:00:00Z");
const HOUR = 3_600_000;

const PRO_MONTHLY = { plan: "PRO", cycle: "MONTHLY" } as const;

function definition(overrides: Partial<OfferCodeDefinition> = {}): OfferCodeDefinition {
  return {
    code: "WELCOME",
    offerRef: "offer_opaque",
    appliesTo: [PRO_MONTHLY, { plan: "PRO_PLUS", cycle: "MONTHLY" }],
    eligibility: "ANY_USER",
    validFrom: null,
    validUntil: null,
    description: "Half off your first month",
    ...overrides,
  };
}

function history(overrides: Partial<BillingHistory> = {}): BillingHistory {
  return { ...NO_BILLING_HISTORY, ...overrides };
}

describe("normalizeCode", () => {
  it("trims and upper-cases, so lookup, storage and comparison agree", () => {
    expect(normalizeCode("  welcome-10 ")).toBe("WELCOME-10");
    expect(normalizeCode("Welcome_10")).toBe("WELCOME_10");
  });
});

describe("isWithinWindow — validFrom <= now < validUntil", () => {
  it("is open when either bound is absent", () => {
    expect(isWithinWindow({ validFrom: null, validUntil: null }, NOW)).toBe(true);
    expect(isWithinWindow({ validFrom: new Date(NOW.getTime() - HOUR), validUntil: null }, NOW)).toBe(true);
    expect(isWithinWindow({ validFrom: null, validUntil: new Date(NOW.getTime() + HOUR) }, NOW)).toBe(true);
  });

  it("includes validFrom and excludes validUntil exactly", () => {
    expect(isWithinWindow({ validFrom: NOW, validUntil: null }, NOW)).toBe(true);
    expect(isWithinWindow({ validFrom: null, validUntil: NOW }, NOW)).toBe(false);
    expect(isWithinWindow({ validFrom: new Date(NOW.getTime() + 1), validUntil: null }, NOW)).toBe(false);
    expect(isWithinWindow({ validFrom: null, validUntil: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
  });
});

describe("satisfiesEligibility (SB-CP-04)", () => {
  it("ANY_USER is always eligible", () => {
    expect(satisfiesEligibility("ANY_USER", "WELCOME", history({ hadQualifyingSubscription: true, trialConsumed: true }))).toBe(true);
  });

  describe("FIRST_PAID_SUBSCRIPTION_ONLY", () => {
    it("is eligible with no qualifying subscription", () => {
      expect(satisfiesEligibility("FIRST_PAID_SUBSCRIPTION_ONLY", "WELCOME", history())).toBe(true);
    });

    it("is not eligible once any subscription reached a contributing phase, a trial included", () => {
      expect(satisfiesEligibility("FIRST_PAID_SUBSCRIPTION_ONLY", "WELCOME", history({ hadQualifyingSubscription: true }))).toBe(false);
      expect(
        satisfiesEligibility("FIRST_PAID_SUBSCRIPTION_ONLY", "WELCOME", history({ hadQualifyingSubscription: true, trialConsumed: true })),
      ).toBe(false);
    });

    it("reads only the subscription history: it has no notion of grants or effective access (IB-27 item 9)", () => {
      // The history type carries subscriptions only. A user whose paid access came from an admin grant
      // or a promotion has an empty history here, and stays first-paid eligible.
      expect(Object.keys(NO_BILLING_HISTORY).sort()).toEqual(["contributedCodes", "hadQualifyingSubscription", "trialConsumed"]);
      expect(satisfiesEligibility("FIRST_PAID_SUBSCRIPTION_ONLY", "WELCOME", NO_BILLING_HISTORY)).toBe(true);
    });
  });

  describe("ONCE_PER_USER", () => {
    it("is eligible when no contributing subscription carried the code", () => {
      expect(satisfiesEligibility("ONCE_PER_USER", "WELCOME", history({ contributedCodes: new Set(["OTHER"]) }))).toBe(true);
    });

    it("is not eligible once a contributing subscription carried this code", () => {
      expect(satisfiesEligibility("ONCE_PER_USER", "WELCOME", history({ contributedCodes: new Set(["WELCOME"]) }))).toBe(false);
    });

    it("is unaffected by the user's other history", () => {
      expect(satisfiesEligibility("ONCE_PER_USER", "WELCOME", history({ hadQualifyingSubscription: true, trialConsumed: true }))).toBe(true);
    });
  });
});

describe("evaluateOfferCode", () => {
  it("accepts a known, in-window, applicable, eligible code and hands back its definition", () => {
    const result = evaluateOfferCode(definition(), PRO_MONTHLY, NO_BILLING_HISTORY, NOW);

    expect(result).toEqual({ kind: "OK", definition: definition() });
  });

  it("refuses an unknown code as invalid", () => {
    expect(evaluateOfferCode(null, PRO_MONTHLY, NO_BILLING_HISTORY, NOW)).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
  });

  it("refuses a not-yet-valid and an expired code as invalid, not told apart from unknown", () => {
    const early = definition({ validFrom: new Date(NOW.getTime() + HOUR) });
    const late = definition({ validUntil: new Date(NOW.getTime() - HOUR) });
    const endsNow = definition({ validUntil: NOW });

    for (const expired of [early, late, endsNow]) {
      expect(evaluateOfferCode(expired, PRO_MONTHLY, NO_BILLING_HISTORY, NOW)).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
    }
  });

  it("refuses another plan, and another cycle, as not applicable", () => {
    const proMonthlyOnly = definition({ appliesTo: [PRO_MONTHLY] });

    expect(evaluateOfferCode(proMonthlyOnly, { plan: "PRO_PLUS", cycle: "MONTHLY" }, NO_BILLING_HISTORY, NOW)).toEqual({
      kind: "REFUSE",
      reason: "CODE_NOT_APPLICABLE",
    });
    expect(evaluateOfferCode(proMonthlyOnly, { plan: "PRO", cycle: "YEARLY" }, NO_BILLING_HISTORY, NOW)).toEqual({
      kind: "REFUSE",
      reason: "CODE_NOT_APPLICABLE",
    });
  });

  it("refuses an ineligible user as not eligible", () => {
    const firstOnly = definition({ eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY" });

    expect(evaluateOfferCode(firstOnly, PRO_MONTHLY, history({ hadQualifyingSubscription: true }), NOW)).toEqual({
      kind: "REFUSE",
      reason: "CODE_NOT_ELIGIBLE",
    });
  });

  it("checks in order: window, then applicability, then eligibility", () => {
    const everythingWrong = definition({
      validUntil: new Date(NOW.getTime() - HOUR),
      appliesTo: [{ plan: "PRO_PLUS", cycle: "YEARLY" }],
      eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY",
    });
    const notApplicableAndIneligible = definition({ appliesTo: [{ plan: "PRO_PLUS", cycle: "YEARLY" }], eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY" });

    expect(evaluateOfferCode(everythingWrong, PRO_MONTHLY, history({ hadQualifyingSubscription: true }), NOW)).toEqual({
      kind: "REFUSE",
      reason: "CODE_INVALID",
    });
    expect(evaluateOfferCode(notApplicableAndIneligible, PRO_MONTHLY, history({ hadQualifyingSubscription: true }), NOW)).toEqual({
      kind: "REFUSE",
      reason: "CODE_NOT_APPLICABLE",
    });
  });
});
