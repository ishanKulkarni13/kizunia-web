import { describe, expect, it } from "vitest";

import { CreatePromotionSchema, RedeemPromotionSchema } from "./promotion";

const valid = { code: "SPRING-2026", plan: "PRO", durationDays: 30, maxRedemptions: 100, validUntil: null } as const;

describe("CreatePromotionSchema", () => {
  it("accepts a promotion with explicit limits, defaulting the eligibility rule", () => {
    const parsed = CreatePromotionSchema.parse(valid);

    expect(parsed).toMatchObject({ code: "SPRING-2026", plan: "PRO", durationDays: 30, maxRedemptions: 100, validUntil: null, eligibility: "ANY_USER" });
    expect(parsed.validFrom).toBeUndefined();
  });

  it("makes every limit a deliberate choice: an unlimited or open-ended promotion is null, never an omission", () => {
    expect(CreatePromotionSchema.safeParse({ ...valid, maxRedemptions: null }).success).toBe(true);

    const without = (key: string) => Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
    const noMax = without("maxRedemptions");
    const noUntil = without("validUntil");

    expect(CreatePromotionSchema.safeParse(noMax).success).toBe(false);
    expect(CreatePromotionSchema.safeParse(noUntil).success).toBe(false);
  });

  it("parses the window's ISO instants to Dates and refuses one that ends before it starts", () => {
    const parsed = CreatePromotionSchema.parse({ ...valid, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-11-01T00:00:00Z" });

    expect(parsed.validFrom).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(parsed.validUntil).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(CreatePromotionSchema.safeParse({ ...valid, validFrom: "2026-11-01T00:00:00Z", validUntil: "2026-10-01T00:00:00Z" }).success).toBe(false);
  });

  it("bounds the duration and the redemption limit, and allows only the paid plans", () => {
    for (const bad of [{ durationDays: 0 }, { durationDays: 3651 }, { durationDays: 1.5 }, { maxRedemptions: 0 }, { maxRedemptions: 1_000_001 }, { plan: "FREE" }, { eligibility: "EVERYONE" }]) {
      expect(CreatePromotionSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses fields it does not define, so nothing can be smuggled into a promotion", () => {
    for (const extra of [{ remainingRedemptions: 5 }, { source: "ADMIN_GRANT" }, { offerId: "offer_1" }, { createdByUserId: "someone" }]) {
      expect(CreatePromotionSchema.safeParse({ ...valid, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("RedeemPromotionSchema", () => {
  it("is a code and nothing else: the user, plan, duration and eligibility come from the server", () => {
    expect(RedeemPromotionSchema.safeParse({ code: "SPRING-2026" }).success).toBe(true);

    for (const extra of [{ userId: "x" }, { plan: "PRO_PLUS" }, { durationDays: 9999 }, { promotionId: "p" }, { eligible: true }]) {
      expect(RedeemPromotionSchema.safeParse({ code: "SPRING-2026", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("trims the code and refuses an empty, over-long or malformed one", () => {
    expect(RedeemPromotionSchema.parse({ code: "  spring-2026 " }).code).toBe("spring-2026");

    for (const code of ["", "   ", "x".repeat(65), "a b", "a!", 5, null, undefined]) {
      expect(RedeemPromotionSchema.safeParse({ code }).success, String(code)).toBe(false);
    }
  });
});
