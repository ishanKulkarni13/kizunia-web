import { describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";

import { planChangeDirection, planChangeStrategy, type PaymentMethodAdvisory } from "./plan-change-strategy";

const INTL: PaymentMethodAdvisory = { advisoryPaymentMethod: "card", advisoryInternationalCard: true };
const UNKNOWN: PaymentMethodAdvisory = { advisoryPaymentMethod: null, advisoryInternationalCard: null };

/** The TEST verification prices (IB-24 item 13), in paise. */
const PRICE = { proM: 1000, proY: 1200, plusM: 2000, plusY: 2200 };

describe("planChangeDirection — by price (SB-LC-02/03, IB-26 item 6)", () => {
  it.each([
    ["Pro monthly → Pro+ monthly", PRICE.proM, PRICE.plusM, "UPGRADE"],
    ["Pro monthly → Pro yearly", PRICE.proM, PRICE.proY, "UPGRADE"],
    ["Pro yearly → Pro+ monthly (mixed: the price decides)", PRICE.proY, PRICE.plusM, "UPGRADE"],
    ["Pro+ monthly → Pro yearly (mixed: the price decides)", PRICE.plusM, PRICE.proY, "DOWNGRADE"],
    ["Pro+ yearly → Pro+ monthly", PRICE.plusY, PRICE.plusM, "DOWNGRADE"],
    ["Pro+ monthly → Pro monthly", PRICE.plusM, PRICE.proM, "DOWNGRADE"],
  ])("%s", (_label, current, target, expected) => {
    expect(planChangeDirection(current, target)).toBe(expected);
  });

  it("cannot decide without both prices, and never guesses", () => {
    expect(planChangeDirection(undefined, 1000)).toBeNull();
    expect(planChangeDirection(1000, undefined)).toBeNull();
  });

  it("calls an equal price neither", () => {
    expect(planChangeDirection(1000, 1000)).toBe("SAME_PRICE");
  });
});

describe("planChangeStrategy — the one strategy policy (IB-21)", () => {
  const strategy = (phase: SubscriptionPhase, advisory: PaymentMethodAdvisory, current: number | undefined, target: number | undefined) =>
    planChangeStrategy({ phase, advisory, currentPriceMinor: current, targetPriceMinor: target });

  it("upgrades an ACTIVE international-card subscription now", () => {
    expect(strategy("ACTIVE", INTL, PRICE.proM, PRICE.plusM)).toEqual({ kind: "NATIVE_UPDATE", direction: "UPGRADE", scheduleChangeAt: "NOW" });
  });

  it("downgrades an ACTIVE international-card subscription at cycle end", () => {
    expect(strategy("ACTIVE", INTL, PRICE.plusM, PRICE.proM)).toEqual({
      kind: "NATIVE_UPDATE",
      direction: "DOWNGRADE",
      scheduleChangeAt: "CYCLE_END",
    });
  });

  it("allows an upgrade while TRIALING, but no downgrade (Razorpay updates `authenticated`; SB-LC-03)", () => {
    expect(strategy("TRIALING", INTL, PRICE.proM, PRICE.plusM).kind).toBe("NATIVE_UPDATE");
    expect(strategy("TRIALING", INTL, PRICE.plusM, PRICE.proM)).toEqual({ kind: "UNAVAILABLE", reason: "SUBSCRIPTION_STATE" });
  });

  it.each<SubscriptionPhase>(["PAST_DUE", "HALTED", "PAUSED", "PENDING_AUTHENTICATION", "PROVISIONING", "CANCELLED"])(
    "is unavailable while %s (Razorpay refuses updates there)",
    (phase) => {
      expect(strategy(phase, INTL, PRICE.proM, PRICE.plusM)).toEqual({ kind: "UNAVAILABLE", reason: "SUBSCRIPTION_STATE" });
    },
  );

  it.each<[string, PaymentMethodAdvisory]>([
    ["UPI", { advisoryPaymentMethod: "upi", advisoryInternationalCard: null }],
    ["e-mandate", { advisoryPaymentMethod: "emandate", advisoryInternationalCard: null }],
    ["NACH", { advisoryPaymentMethod: "nach", advisoryInternationalCard: null }],
    ["a domestic card", { advisoryPaymentMethod: "card", advisoryInternationalCard: false }],
    ["a subscription whose earlier update Razorpay refused", { advisoryPaymentMethod: null, advisoryInternationalCard: false }],
  ])("is the V1 limitation for %s, in both directions", (_label, advisory) => {
    expect(strategy("ACTIVE", advisory, PRICE.proM, PRICE.plusM)).toEqual({ kind: "UNAVAILABLE", reason: "PAYMENT_METHOD" });
    expect(strategy("ACTIVE", advisory, PRICE.plusM, PRICE.proM)).toEqual({ kind: "UNAVAILABLE", reason: "PAYMENT_METHOD" });
  });

  it("sends the update when the method is unknown: Razorpay's answer is the authoritative check", () => {
    expect(strategy("ACTIVE", UNKNOWN, PRICE.proM, PRICE.plusM).kind).toBe("NATIVE_UPDATE");
    expect(strategy("ACTIVE", { advisoryPaymentMethod: "card", advisoryInternationalCard: null }, PRICE.proM, PRICE.plusM).kind).toBe(
      "NATIVE_UPDATE",
    );
  });

  it("is unavailable with a missing or equal price", () => {
    expect(strategy("ACTIVE", INTL, undefined, PRICE.plusM)).toEqual({ kind: "UNAVAILABLE", reason: "PRICE_UNKNOWN" });
    expect(strategy("ACTIVE", INTL, 1000, 1000)).toEqual({ kind: "UNAVAILABLE", reason: "SAME_PRICE" });
  });
});
