import { describe, expect, it } from "vitest";

import type { SubscriptionPhase } from "@/generated/prisma";

import {
  allowedBillingActions,
  evaluateCancelPreconditions,
  evaluateCheckoutPreconditions,
  evaluatePlanChangePreconditions,
  NO_BILLING_ACTIONS,
  planChangeAdvisory,
  requiredCancelTiming,
  type CheckoutIntent,
  type OpenSubscriptionView,
  type PlanPrices,
  type PredecessorView,
} from "./command-preconditions";

const NOW = new Date("2026-09-25T12:00:00Z");
const MINUTE = 60_000;
const PRO_MONTHLY: CheckoutIntent = { plan: "PRO", cycle: "MONTHLY" };
const PRO_YEARLY: CheckoutIntent = { plan: "PRO", cycle: "YEARLY" };
const PRO_PLUS_MONTHLY: CheckoutIntent = { plan: "PRO_PLUS", cycle: "MONTHLY" };
const PRO_PLUS_YEARLY: CheckoutIntent = { plan: "PRO_PLUS", cycle: "YEARLY" };
const ALL: CheckoutIntent[] = [PRO_MONTHLY, PRO_YEARLY, PRO_PLUS_MONTHLY, PRO_PLUS_YEARLY];

/** The TEST verification prices (IB-24 item 13), in paise. */
const PRICE: Record<string, number> = { "PRO/MONTHLY": 1000, "PRO/YEARLY": 1200, "PRO_PLUS/MONTHLY": 2000, "PRO_PLUS/YEARLY": 2200 };

function pricesFor(current: CheckoutIntent | undefined, table: Record<string, number> = PRICE): PlanPrices {
  return {
    current: current ? table[`${current.plan}/${current.cycle}`] : undefined,
    of: (intent) => table[`${intent.plan}/${intent.cycle}`],
  };
}

function sub(phase: SubscriptionPhase, overrides: Partial<OpenSubscriptionView> = {}): OpenSubscriptionView {
  return {
    id: `sub-${phase}`,
    phase,
    plan: "PRO",
    cycle: "MONTHLY",
    expireBy: new Date(NOW.getTime() + 20 * MINUTE),
    advisoryPaymentMethod: null,
    advisoryInternationalCard: null,
    cancelAtPeriodEnd: false,
    scheduledPlan: null,
    scheduledCycle: null,
    hasScheduledChange: false,
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
    expect(decide([sub("PROVISIONING")], PRO_YEARLY)).toEqual({ kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" });
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

  it.each<SubscriptionPhase>(["HALTED", "PAUSED"])("routes %s to supersession when no supersession is confirmed", (phase) => {
    expect(decide([sub(phase)])).toEqual({ kind: "REFUSE", reason: "SUPERSESSION_REQUIRED" });
  });

  it("refuses with 'contact support' when more than one subscription is open", () => {
    expect(decide([sub("ACTIVE"), sub("PENDING_AUTHENTICATION")])).toEqual({ kind: "REFUSE", reason: "CONTACT_SUPPORT" });
  });

  it("refuses with 'contact support' while a multiple-subscriptions anomaly is open, whatever else is true", () => {
    expect(decide([], PRO_MONTHLY, true)).toEqual({ kind: "REFUSE", reason: "CONTACT_SUPPORT" });
  });
});

describe("evaluateCheckoutPreconditions — supersession (SB-UQ-04, IB-26 item 5)", () => {
  function supersede(open: OpenSubscriptionView[], subscriptionId: string, predecessor: PredecessorView | null, hasOpenAnomaly = false) {
    return evaluateCheckoutPreconditions({
      open,
      hasOpenAnomaly,
      intent: PRO_PLUS_MONTHLY,
      now: NOW,
      reuseMinRemainingSeconds: 300,
      supersedes: { subscriptionId, predecessor },
    });
  }

  it.each<SubscriptionPhase>(["HALTED", "PAUSED"])("cancels then creates when the confirmed subscription is %s", (phase) => {
    const old = sub(phase);

    expect(supersede([old], old.id, { id: old.id, phase, supersededById: null })).toEqual({ kind: "SUPERSEDE_THEN_CREATE", subscription: old });
  });

  it("continues with a create linked to the old one once it is observed cancelled", () => {
    expect(supersede([], "old", { id: "old", phase: "CANCELLED", supersededById: null })).toEqual({ kind: "CREATE", linkPredecessor: "old" });
  });

  it("refuses a continuation when the old one is already superseded", () => {
    expect(supersede([], "old", { id: "old", phase: "CANCELLED", supersededById: "new" })).toEqual({
      kind: "REFUSE",
      reason: "SUPERSESSION_NOT_APPLICABLE",
    });
  });

  it.each<SubscriptionPhase>(["EXPIRED", "COMPLETED", "ABANDONED"])("refuses a continuation from %s: only an observed cancellation supersedes", (phase) => {
    expect(supersede([], "old", { id: "old", phase, supersededById: null }).kind).toBe("REFUSE");
  });

  it("refuses when the named subscription is not the caller's own", () => {
    expect(supersede([], "someone-elses", null)).toEqual({ kind: "REFUSE", reason: "SUPERSESSION_NOT_APPLICABLE" });
  });

  it.each<SubscriptionPhase>(["ACTIVE", "PAST_DUE", "TRIALING", "PENDING_AUTHENTICATION", "PROVISIONING"])(
    "never cancels a %s subscription through supersession (it recovered, or is not on hold)",
    (phase) => {
      const current = sub(phase);

      expect(supersede([current], current.id, { id: current.id, phase, supersededById: null })).toEqual({
        kind: "REFUSE",
        reason: "SUPERSESSION_NOT_APPLICABLE",
      });
    },
  );

  it("refuses when the confirmed ID is not the on-hold subscription", () => {
    expect(supersede([sub("HALTED")], "other", null).kind).toBe("REFUSE");
  });

  it("still refuses with 'contact support' while a multiple-subscriptions anomaly is open", () => {
    const old = sub("HALTED");

    expect(supersede([old], old.id, { id: old.id, phase: "HALTED", supersededById: null }, true)).toEqual({
      kind: "REFUSE",
      reason: "CONTACT_SUPPORT",
    });
  });
});

describe("evaluateCancelPreconditions — the cancel matrix (cancellation.md, IB-1)", () => {
  const cancel = (open: OpenSubscriptionView[], acknowledged: "CYCLE_END" | "IMMEDIATE" | null = null, hasOpenAnomaly = false) =>
    evaluateCancelPreconditions({ open, hasOpenAnomaly, acknowledged });

  it("cancels ACTIVE at cycle end", () => {
    expect(cancel([sub("ACTIVE")], "CYCLE_END")).toMatchObject({ kind: "CANCEL_AT_CYCLE_END", cancelScheduledFirst: false });
  });

  it("cancels a pending scheduled change first (SB-LC-08)", () => {
    expect(cancel([sub("ACTIVE", { hasScheduledChange: true })], "CYCLE_END")).toMatchObject({
      kind: "CANCEL_AT_CYCLE_END",
      cancelScheduledFirst: true,
    });
  });

  it("cancels PAST_DUE immediately (IB-1), never at cycle end", () => {
    expect(cancel([sub("PAST_DUE")], "IMMEDIATE")).toMatchObject({ kind: "CANCEL_IMMEDIATELY", abandon: false });
    expect(requiredCancelTiming("PAST_DUE")).toBe("IMMEDIATE");
  });

  it.each<SubscriptionPhase>(["TRIALING", "HALTED", "PAUSED"])("cancels %s immediately", (phase) => {
    expect(cancel([sub(phase)], "IMMEDIATE")).toMatchObject({ kind: "CANCEL_IMMEDIATELY", abandon: false });
  });

  it("abandons a pending checkout", () => {
    expect(cancel([sub("PENDING_AUTHENTICATION")], "IMMEDIATE")).toMatchObject({ kind: "CANCEL_IMMEDIATELY", abandon: true });
  });

  it.each<SubscriptionPhase>(["TRIALING", "PAST_DUE", "HALTED", "PAUSED", "PENDING_AUTHENTICATION", "PROVISIONING"])(
    "never decides a cycle-end cancel for %s (I-2)",
    (phase) => {
      expect(requiredCancelTiming(phase)).not.toBe("CYCLE_END");
      expect(cancel([sub(phase)], null).kind).not.toBe("CANCEL_AT_CYCLE_END");
    },
  );

  it("does not clear a scheduled change before an immediate cancel (it ends the subscription anyway)", () => {
    expect(cancel([sub("PAST_DUE", { hasScheduledChange: true })], "IMMEDIATE")).toMatchObject({ kind: "CANCEL_IMMEDIATELY" });
  });

  it("answers an already requested cycle-end cancel from local state", () => {
    const active = sub("ACTIVE", { cancelAtPeriodEnd: true });

    expect(cancel([active], "CYCLE_END")).toEqual({ kind: "ALREADY_REQUESTED", subscription: active });
  });

  it("cancels immediately a PAST_DUE subscription whose earlier cycle-end request is still flagged", () => {
    expect(cancel([sub("PAST_DUE", { cancelAtPeriodEnd: true })], "IMMEDIATE").kind).toBe("CANCEL_IMMEDIATELY");
  });

  it("refuses when the acknowledged timing is not the one that applies now (IB-26 item 2)", () => {
    expect(cancel([sub("PAST_DUE")], "CYCLE_END")).toEqual({ kind: "REFUSE", reason: "TIMING_CHANGED", requiredTiming: "IMMEDIATE" });
    expect(cancel([sub("ACTIVE")], "IMMEDIATE")).toEqual({ kind: "REFUSE", reason: "TIMING_CHANGED", requiredTiming: "CYCLE_END" });
  });

  it("refuses when there is nothing to cancel", () => {
    expect(cancel([], "IMMEDIATE")).toEqual({ kind: "REFUSE", reason: "NO_SUBSCRIPTION" });
    expect(requiredCancelTiming("CANCELLED")).toBeNull();
  });

  it("refuses while a checkout is still being set up", () => {
    expect(cancel([sub("PROVISIONING")], "IMMEDIATE")).toEqual({ kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" });
  });

  it("refuses with 'contact support' for more than one open subscription or an open anomaly", () => {
    expect(cancel([sub("ACTIVE"), sub("HALTED")], "CYCLE_END").kind).toBe("REFUSE");
    expect(cancel([sub("ACTIVE")], "CYCLE_END", true)).toEqual({ kind: "REFUSE", reason: "CONTACT_SUPPORT" });
  });
});

describe("evaluatePlanChangePreconditions — upgrade-downgrade.md", () => {
  const change = (current: OpenSubscriptionView | null, target: CheckoutIntent, prices = pricesFor(current ?? undefined)) =>
    evaluatePlanChangePreconditions({ open: current ? [current] : [], hasOpenAnomaly: false, target, prices });

  const intl = { advisoryPaymentMethod: "card", advisoryInternationalCard: true } as const;

  it("upgrades an ACTIVE subscription now", () => {
    expect(change(sub("ACTIVE", intl), PRO_PLUS_MONTHLY)).toMatchObject({ kind: "CHANGE", scheduleChangeAt: "NOW", cancelScheduledFirst: false });
  });

  it("downgrades at cycle end", () => {
    expect(change(sub("ACTIVE", { ...intl, plan: "PRO_PLUS" }), PRO_MONTHLY)).toMatchObject({ kind: "CHANGE", scheduleChangeAt: "CYCLE_END" });
  });

  it("cancels a pending change first (SB-LC-08)", () => {
    const current = sub("ACTIVE", { ...intl, plan: "PRO_PLUS", scheduledPlan: "PRO", scheduledCycle: "MONTHLY", hasScheduledChange: true });

    expect(change(current, PRO_PLUS_YEARLY)).toMatchObject({ kind: "CHANGE", cancelScheduledFirst: true });
  });

  it("answers the same scheduled change from local state", () => {
    const current = sub("ACTIVE", { ...intl, plan: "PRO_PLUS", scheduledPlan: "PRO", scheduledCycle: "MONTHLY", hasScheduledChange: true });

    expect(change(current, PRO_MONTHLY)).toEqual({ kind: "ALREADY_SCHEDULED", subscription: current });
  });

  it("refuses a change after a cycle-end cancel was requested", () => {
    expect(change(sub("ACTIVE", { ...intl, cancelAtPeriodEnd: true }), PRO_PLUS_MONTHLY)).toEqual({ kind: "REFUSE", reason: "CANCELLATION_REQUESTED" });
  });

  it("refuses the plan the subscription is already on", () => {
    expect(change(sub("ACTIVE", intl), PRO_MONTHLY)).toEqual({ kind: "REFUSE", reason: "SAME_PLAN" });
  });

  it.each<SubscriptionPhase>(["PROVISIONING", "PENDING_AUTHENTICATION"])("has nothing to change while %s", (phase) => {
    expect(change(sub(phase), PRO_PLUS_MONTHLY)).toEqual({ kind: "REFUSE", reason: "NO_SUBSCRIPTION" });
  });

  it("has nothing to change with no subscription", () => {
    expect(change(null, PRO_PLUS_MONTHLY)).toEqual({ kind: "REFUSE", reason: "NO_SUBSCRIPTION" });
  });

  it("is unavailable, and sends nothing, for UPI (the V1 limitation)", () => {
    expect(change(sub("ACTIVE", { advisoryPaymentMethod: "upi" }), PRO_PLUS_MONTHLY)).toEqual({
      kind: "REFUSE",
      reason: "UNAVAILABLE",
      unavailable: "PAYMENT_METHOD",
    });
  });

  it("is unavailable when a price is not configured (never guessed)", () => {
    expect(change(sub("ACTIVE", intl), PRO_PLUS_MONTHLY, pricesFor(PRO_MONTHLY, { "PRO/MONTHLY": 1000 }))).toEqual({
      kind: "REFUSE",
      reason: "UNAVAILABLE",
      unavailable: "PRICE_UNKNOWN",
    });
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

  it("treats a refusal's correction as the limitation whatever the method (IB-26 item 7)", () => {
    expect(planChangeAdvisory({ advisoryPaymentMethod: null, advisoryInternationalCard: false })).toBe("V1_LIMITATION");
  });
});

describe("allowedBillingActions — the summary view of the same rules", () => {
  const base = { hasOpenAnomaly: false, now: NOW, reuseMinRemainingSeconds: 300, purchasable: ALL, operationPending: false };
  const actionsFor = (open: OpenSubscriptionView[], extra: Partial<typeof base> = {}) =>
    allowedBillingActions({ ...base, ...extra, billingAvailable: true, open, prices: pricesFor(open.length === 1 ? open[0] : undefined) });

  it("offers every plan to a Free user, and nothing else", () => {
    const actions = actionsFor([]);

    expect(actions.startCheckout).toEqual(ALL);
    expect(actions.resumeCheckout).toBeNull();
    expect(actions.refusal).toBeNull();
    expect(actions).toMatchObject({ cancel: null, changePlan: null, supersede: null, recover: false });
  });

  it("offers nothing when billing is unavailable", () => {
    const actions = allowedBillingActions({ ...base, billingAvailable: false, open: [], prices: pricesFor(undefined) });

    expect(actions).toEqual(NO_BILLING_ACTIONS);
  });

  it("offers the pending checkout to resume, other plans through abandon-then-create, and its abandonment", () => {
    const actions = actionsFor([sub("PENDING_AUTHENTICATION")]);

    expect(actions.resumeCheckout).toEqual(PRO_MONTHLY);
    expect(actions.startCheckout).toEqual(ALL);
    expect(actions.cancel).toEqual({ timing: "IMMEDIATE", abandon: true });
  });

  it("offers nothing while a creation is being set up", () => {
    const actions = actionsFor([sub("PROVISIONING")]);

    expect(actions.startCheckout).toEqual([]);
    expect(actions.cancel).toBeNull();
  });

  it("offers nothing while an operation is pending", () => {
    const actions = actionsFor([sub("ACTIVE")], { operationPending: true });

    expect(actions).toMatchObject({ startCheckout: [], cancel: null, changePlan: null, supersede: null });
  });

  it("offers a cycle-end cancel and every native change to an ACTIVE international-card subscriber", () => {
    const actions = actionsFor([sub("ACTIVE", { advisoryPaymentMethod: "card", advisoryInternationalCard: true })]);

    expect(actions.startCheckout).toEqual([]);
    expect(actions.refusal).toBe("SUBSCRIPTION_EXISTS");
    expect(actions.planChange).toBe("NATIVE_UPDATE_POSSIBLE");
    expect(actions.cancel).toEqual({ timing: "CYCLE_END", abandon: false });
    expect(actions.changePlan).toEqual({
      options: [
        { ...PRO_YEARLY, scheduleChangeAt: "NOW" },
        { ...PRO_PLUS_MONTHLY, scheduleChangeAt: "NOW" },
        { ...PRO_PLUS_YEARLY, scheduleChangeAt: "NOW" },
      ],
      unavailable: null,
    });
  });

  it("shows the V1 limitation, not options, for a UPI subscriber", () => {
    expect(actionsFor([sub("ACTIVE", { advisoryPaymentMethod: "upi" })]).changePlan).toEqual({ options: [], unavailable: "PAYMENT_METHOD" });
  });

  it("offers no change and no second cancel once a cycle-end cancel is requested", () => {
    const actions = actionsFor([sub("ACTIVE", { cancelAtPeriodEnd: true })]);

    expect(actions.cancel).toBeNull();
    expect(actions.changePlan).toBeNull();
  });

  it("offers an immediate cancel and no plan change while PAST_DUE", () => {
    const actions = actionsFor([sub("PAST_DUE")]);

    expect(actions.cancel).toEqual({ timing: "IMMEDIATE", abandon: false });
    expect(actions.changePlan).toEqual({ options: [], unavailable: "SUBSCRIPTION_STATE" });
  });

  it.each<SubscriptionPhase>(["HALTED", "PAUSED"])("offers recovery, supersession and an immediate cancel while %s", (phase) => {
    const actions = actionsFor([sub(phase)]);

    expect(actions).toMatchObject({ recover: true, supersede: { subscriptionId: `sub-${phase}` }, cancel: { timing: "IMMEDIATE" } });
    expect(actions.refusal).toBe("SUPERSESSION_REQUIRED");
  });

  it("offers nothing self-serve while a multiple-subscriptions anomaly is open", () => {
    const actions = actionsFor([sub("HALTED")], { hasOpenAnomaly: true });

    expect(actions).toMatchObject({ cancel: null, changePlan: null, supersede: null, recover: false, refusal: "CONTACT_SUPPORT" });
  });
});
