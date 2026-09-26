import { describe, expect, it } from "vitest";

import { CreateSubscriptionRequestSchema, MarketingCodeSchema, StartCheckoutSchema } from "./checkout";

const base = { plan: "PRO", cycle: "MONTHLY" } as const;

describe("StartCheckoutSchema — the only acquisition intents a client sends are a trial flag and a code", () => {
  it("accepts a plain checkout, a trial, and a code", () => {
    expect(StartCheckoutSchema.safeParse(base).success).toBe(true);
    expect(StartCheckoutSchema.safeParse({ ...base, trial: true }).success).toBe(true);
    expect(StartCheckoutSchema.safeParse({ ...base, code: "WELCOME-10" }).success).toBe(true);
  });

  it("trims a code, leaving normalization (case) to the server", () => {
    expect(StartCheckoutSchema.parse({ ...base, code: "  welcome_10 " }).code).toBe("welcome_10");
  });

  it("refuses a code that is empty, too long, or has characters a code never has", () => {
    for (const code of ["", "   ", "a".repeat(65), "WELCOME 10", "WELCOME!", "50%", "<script>"]) {
      expect(StartCheckoutSchema.safeParse({ ...base, code }).success).toBe(false);
    }
  });

  it("refuses every field that would let a client decide a commercial term, rather than ignoring it", () => {
    const tampered: Record<string, unknown>[] = [
      { price: 1 },
      { amount: 100 },
      { discount: 99 },
      { discountPercent: 100 },
      { offerId: "offer_abc" },
      { offer_id: "offer_abc" },
      { providerPlanId: "plan_abc" },
      { plan_id: "plan_abc" },
      { startAt: "2026-10-01T00:00:00Z" },
      { start_at: 1_790_000_000 },
      { kind: "TRIAL" },
      { trialEligible: true },
      { eligible: true },
      { promotionId: "promo_1" },
      { userId: "someone-else" },
      { trialDays: 365 },
    ];

    for (const extra of tampered) {
      expect(StartCheckoutSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("does not decide the trial-with-code rule itself: the precondition policy refuses it, in one place", () => {
    expect(StartCheckoutSchema.safeParse({ ...base, trial: true, code: "WELCOME" }).success).toBe(true);
  });

  it("refuses a non-boolean trial flag", () => {
    expect(StartCheckoutSchema.safeParse({ ...base, trial: "yes" }).success).toBe(false);
    expect(StartCheckoutSchema.safeParse({ ...base, trial: 1 }).success).toBe(false);
  });

  it("keeps the supersession pairing rule", () => {
    expect(StartCheckoutSchema.safeParse({ ...base, supersedesSubscriptionId: "abc123" }).success).toBe(false);
    expect(StartCheckoutSchema.safeParse({ ...base, supersedesSubscriptionId: "abc123", confirmSupersession: true, trial: true }).success).toBe(true);
  });
});

describe("MarketingCodeSchema", () => {
  it("accepts letters, digits, '-' and '_'", () => {
    expect(MarketingCodeSchema.safeParse("Spring-2026_A").success).toBe(true);
  });
});

describe("CreateSubscriptionRequestSchema — what an operation records", () => {
  it("carries the kind and the normalized code beside the plan and cycle", () => {
    expect(CreateSubscriptionRequestSchema.parse({ ...base, kind: "TRIAL" })).toEqual({ ...base, kind: "TRIAL" });
    expect(CreateSubscriptionRequestSchema.parse({ ...base, kind: "STANDARD", code: "WELCOME" })).toEqual({ ...base, kind: "STANDARD", code: "WELCOME" });
  });
});
