import { describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";

import {
  allowedBillingActions,
  evaluateCheckoutPreconditions,
  planChangeAdvisory,
  type CheckoutIntent,
  type OpenSubscriptionView,
} from "./command-preconditions";

const NOW = new Date("2026-09-25T12:00:00Z");
const MINUTE = 60_000;
const PRO_MONTHLY: CheckoutIntent = { plan: "PRO", cycle: "MONTHLY" };
const PRO_PLUS_YEARLY: CheckoutIntent = { plan: "PRO_PLUS", cycle: "YEARLY" };
const ALL: CheckoutIntent[] = [
  PRO_MONTHLY,
  { plan: "PRO", cycle: "YEARLY" },
  { plan: "PRO_PLUS", cycle: "MONTHLY" },
  PRO_PLUS_YEARLY,
];

function sub(phase: SubscriptionPhase, overrides: Partial<OpenSubscriptionView> = {}): OpenSubscriptionView {
  return {
    id: `sub-${phase}`,
    phase,
    plan: "PRO",
    cycle: "MONTHLY",
    expireBy: new Date(NOW.getTime() + 20 * MINUTE),
    advisoryPaymentMethod: null,
    advisoryInternationalCard: null,
    ...overrides,
  };
}

function decide(open: OpenSubscriptionView[], intent = PRO_MONTHLY, hasOpenAnomaly = false) {
  return evaluateCheckoutPreconditions({ open, hasOpenAnomaly, intent, now: NOW, reuseMinRemainingSeconds: 300 });
}

describe("evaluateCheckoutPreconditions — the reuse and uniqueness table (SB-UQ-03)", () => {
  it("creates when the user has no open subscription", () => {
    expect(decide([])).toEqual({ kind: "CREATE" });
  });

  it("returns the in-flight creation for PROVISIONING with the same plan and cycle", () => {
    expect(decide([sub("PROVISIONING")]).kind).toBe("RETURN_PROVISIONING");
  });

  it("refuses PROVISIONING with another plan or cycle, never creating a second", () => {
    expect(decide([sub("PROVISIONING")], PRO_PLUS_YEARLY)).toEqual({ kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" });
    expect(decide([sub("PROVISIONING")], { plan: "PRO", cycle: "YEARLY" })).toEqual({
      kind: "REFUSE",
      reason: "CHECKOUT_IN_PROGRESS",
    });
  });

  it("reuses an unexpired pending checkout for the same plan and cycle", () => {
    expect(decide([sub("PENDING_AUTHENTICATION")]).kind).toBe("REUSE_PENDING");
  });

  it("abandons then creates for a pending checkout with another plan or cycle", () => {
    expect(decide([sub("PENDING_AUTHENTICATION")], PRO_PLUS_YEARLY).kind).toBe("ABANDON_THEN_CREATE");
  });

  it("abandons then creates for an expired pending checkout, even for the same plan", () => {
    const expired = sub("PENDING_AUTHENTICATION", { expireBy: new Date(NOW.getTime() - MINUTE) });

    expect(decide([expired]).kind).toBe("ABANDON_THEN_CREATE");
  });

  it("treats a checkout with less than the reuse margin left as expired (IB-25 item 5)", () => {
    const nearlyExpired = sub("PENDING_AUTHENTICATION", { expireBy: new Date(NOW.getTime() + 4 * MINUTE) });
    const justEnough = sub("PENDING_AUTHENTICATION", { expireBy: new Date(NOW.getTime() + 5 * MINUTE) });

    expect(decide([nearlyExpired]).kind).toBe("ABANDON_THEN_CREATE");
    expect(decide([justEnough]).kind).toBe("REUSE_PENDING");
  });

  it("treats a pending checkout with no known expire_by as not reusable", () => {
    expect(decide([sub("PENDING_AUTHENTICATION", { expireBy: null })]).kind).toBe("ABANDON_THEN_CREATE");
  });

  it.each<SubscriptionPhase>(["TRIALING", "ACTIVE", "PAST_DUE"])("refuses a purchase while %s, with the advisory", (phase) => {
    const decision = decide([sub(phase, { advisoryPaymentMethod: "upi" })], PRO_PLUS_YEARLY);

    expect(decision).toEqual({ kind: "REFUSE", reason: "SUBSCRIPTION_EXISTS", planChange: "V1_LIMITATION" });
  });

  it.each<SubscriptionPhase>(["HALTED", "PAUSED"])("routes %s to supersession, refused until Phase VI", (phase) => {
    expect(decide([sub(phase)])).toEqual({ kind: "REFUSE", reason: "SUPERSESSION_REQUIRED" });
  });

  it("refuses with 'contact support' when more than one subscription is open", () => {
    expect(decide([sub("ACTIVE"), sub("PENDING_AUTHENTICATION")])).toEqual({ kind: "REFUSE", reason: "CONTACT_SUPPORT" });
  });

  it("refuses with 'contact support' while a multiple-subscriptions anomaly is open, whatever else is true", () => {
    expect(decide([], PRO_MONTHLY, true)).toEqual({ kind: "REFUSE", reason: "CONTACT_SUPPORT" });
  });
});

describe("planChangeAdvisory (SB-LC-07, advisory only)", () => {
  it("expects a native change only for an international card", () => {
    expect(planChangeAdvisory({ advisoryPaymentMethod: "card", advisoryInternationalCard: true })).toBe("NATIVE_UPDATE_POSSIBLE");
    expect(planChangeAdvisory({ advisoryPaymentMethod: "card", advisoryInternationalCard: false })).toBe("V1_LIMITATION");
  });

  it("names the V1 limitation for UPI and e-mandate", () => {
    expect(planChangeAdvisory({ advisoryPaymentMethod: "upi", advisoryInternationalCard: null })).toBe("V1_LIMITATION");
    expect(planChangeAdvisory({ advisoryPaymentMethod: "emandate", advisoryInternationalCard: null })).toBe("V1_LIMITATION");
  });

  it("says unknown when the method (or a card's origin) is unknown", () => {
    expect(planChangeAdvisory({ advisoryPaymentMethod: null, advisoryInternationalCard: null })).toBe("UNKNOWN");
    expect(planChangeAdvisory({ advisoryPaymentMethod: "card", advisoryInternationalCard: null })).toBe("UNKNOWN");
  });
});

describe("allowedBillingActions — the summary view of the same rule", () => {
  const base = { hasOpenAnomaly: false, now: NOW, reuseMinRemainingSeconds: 300, purchasable: ALL, operationPending: false };

  it("offers every plan to a Free user", () => {
    const actions = allowedBillingActions({ ...base, billingAvailable: true, open: [] });

    expect(actions.startCheckout).toEqual(ALL);
    expect(actions.resumeCheckout).toBeNull();
    expect(actions.refusal).toBeNull();
  });

  it("offers nothing when billing is unavailable", () => {
    const actions = allowedBillingActions({ ...base, billingAvailable: false, open: [] });

    expect(actions).toEqual({ startCheckout: [], resumeCheckout: null, refusal: null, planChange: null });
  });

  it("offers the pending checkout to resume, and other plans through abandon-then-create", () => {
    const actions = allowedBillingActions({ ...base, billingAvailable: true, open: [sub("PENDING_AUTHENTICATION")] });

    expect(actions.resumeCheckout).toEqual(PRO_MONTHLY);
    expect(actions.startCheckout).toEqual(ALL);
  });

  it("offers nothing while a creation is being set up", () => {
    const actions = allowedBillingActions({ ...base, billingAvailable: true, open: [sub("PROVISIONING")] });

    expect(actions.startCheckout).toEqual([]);
  });

  it("offers nothing while an operation is pending", () => {
    const actions = allowedBillingActions({ ...base, billingAvailable: true, open: [], operationPending: true });

    expect(actions.startCheckout).toEqual([]);
  });

  it("reports the common refusal and the advisory for a live subscription", () => {
    const actions = allowedBillingActions({
      ...base,
      billingAvailable: true,
      open: [sub("ACTIVE", { advisoryPaymentMethod: "card", advisoryInternationalCard: true })],
    });

    expect(actions.startCheckout).toEqual([]);
    expect(actions.refusal).toBe("SUBSCRIPTION_EXISTS");
    expect(actions.planChange).toBe("NATIVE_UPDATE_POSSIBLE");
  });
});
