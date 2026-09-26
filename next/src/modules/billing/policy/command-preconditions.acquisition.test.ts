/**
 * The trial and Offer-code rules of the checkout precondition policy
 * (Phase VII, IB-27): evaluated after the open-subscription table, whose
 * refusals always win, on every decision that would start or hand back a checkout.
 */
import { describe, expect, it } from "vitest";

import type { SubscriptionKind, SubscriptionPhase } from "@/generated/prisma";

import { NO_BILLING_HISTORY, type BillingHistory, type OfferCodeDefinition } from "./code-eligibility";
import {
  allowedBillingActions,
  evaluateCheckoutPreconditions,
  STANDARD_ACQUISITION,
  type CheckoutAcquisition,
  type CheckoutIntent,
  type OpenSubscriptionView,
} from "./command-preconditions";

const NOW = new Date("2026-09-26T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PRO_MONTHLY: CheckoutIntent = { plan: "PRO", cycle: "MONTHLY" };
const PRO_YEARLY: CheckoutIntent = { plan: "PRO", cycle: "YEARLY" };
const PRO_PLUS_MONTHLY: CheckoutIntent = { plan: "PRO_PLUS", cycle: "MONTHLY" };

const OFFER: OfferCodeDefinition = {
  code: "WELCOME",
  offerRef: "offer_opaque",
  appliesTo: [PRO_MONTHLY],
  eligibility: "ANY_USER",
  validFrom: null,
  validUntil: null,
  description: "Half off your first month",
};

function sub(phase: SubscriptionPhase, overrides: Partial<OpenSubscriptionView> = {}): OpenSubscriptionView {
  return {
    id: `sub-${phase}`,
    phase,
    plan: "PRO",
    cycle: "MONTHLY",
    kind: "STANDARD",
    marketingCode: null,
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

function acquisition(overrides: Partial<CheckoutAcquisition> = {}): CheckoutAcquisition {
  return { ...STANDARD_ACQUISITION, ...overrides };
}

const trial = (history: Partial<BillingHistory> = {}) => acquisition({ kind: "TRIAL", history: { ...NO_BILLING_HISTORY, ...history } });
const withCode = (offer: OfferCodeDefinition | null, history: Partial<BillingHistory> = {}, code: string | null = "WELCOME") =>
  acquisition({ code, offer, history: { ...NO_BILLING_HISTORY, ...history } });

function decide(open: OpenSubscriptionView[], acq: CheckoutAcquisition | undefined, intent = PRO_MONTHLY) {
  return evaluateCheckoutPreconditions({ open, hasOpenAnomaly: false, intent, now: NOW, reuseMinRemainingSeconds: 300, acquisition: acq });
}

describe("a trial checkout — one per account (SB-LC-11)", () => {
  it("creates for an eligible user", () => {
    expect(decide([], trial())).toEqual({ kind: "CREATE" });
  });

  it("is refused once a trial was consumed, before anything is sent", () => {
    expect(decide([], trial({ trialConsumed: true }))).toEqual({ kind: "REFUSE", reason: "TRIAL_NOT_ELIGIBLE" });
  });

  it("is not blocked by ordinary paid history", () => {
    expect(decide([], trial({ hadQualifyingSubscription: true }))).toEqual({ kind: "CREATE" });
  });

  it("is available on any paid plan and cycle (owner decision, IB-27 item 2)", () => {
    for (const intent of [PRO_MONTHLY, PRO_YEARLY, PRO_PLUS_MONTHLY]) {
      expect(decide([], trial(), intent).kind).toBe("CREATE");
    }
  });

  it("is refused with a code, a rule of its own: a code never combines with a trial (IB-27 item 3)", () => {
    const decision = decide([], acquisition({ kind: "TRIAL", code: "WELCOME", offer: OFFER }));

    expect(decision).toEqual({ kind: "REFUSE", reason: "CODE_NOT_ALLOWED_ON_TRIAL" });
  });

  it("refuses the code-on-trial combination before it looks at eligibility", () => {
    const decision = decide([], acquisition({ kind: "TRIAL", code: "WELCOME", offer: OFFER, history: { ...NO_BILLING_HISTORY, trialConsumed: true } }));

    expect(decision).toEqual({ kind: "REFUSE", reason: "CODE_NOT_ALLOWED_ON_TRIAL" });
  });

  it("is refused while a subscription is live: the open-subscription table wins over eligibility", () => {
    for (const phase of ["TRIALING", "ACTIVE", "PAST_DUE"] as const) {
      const decision = decide([sub(phase)], trial());

      expect(decision).toMatchObject({ kind: "REFUSE", reason: "SUBSCRIPTION_EXISTS" });
    }
  });

  it("is refused for an on-hold subscription without a supersession, whatever the trial", () => {
    expect(decide([sub("HALTED")], trial())).toEqual({ kind: "REFUSE", reason: "SUPERSESSION_REQUIRED" });
  });

  it("returns the open-subscription table's answer, not a trial refusal, when a checkout is in progress for another intent", () => {
    expect(decide([sub("PROVISIONING")], trial({ trialConsumed: true }))).toEqual({ kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" });
  });
});

describe("the same intent: plan, cycle, kind and code (IB-27 item 10)", () => {
  it("reuses a pending trial checkout for the same trial", () => {
    expect(decide([sub("PENDING_AUTHENTICATION", { kind: "TRIAL" })], trial()).kind).toBe("REUSE_PENDING");
  });

  it("abandons a pending standard checkout to start a trial, and a pending trial to go standard", () => {
    expect(decide([sub("PENDING_AUTHENTICATION")], trial()).kind).toBe("ABANDON_THEN_CREATE");
    expect(decide([sub("PENDING_AUTHENTICATION", { kind: "TRIAL" })], undefined).kind).toBe("ABANDON_THEN_CREATE");
  });

  it("reuses a pending checkout with the same code, and abandons it for a different code or none", () => {
    const pending = sub("PENDING_AUTHENTICATION", { marketingCode: "WELCOME" });

    expect(decide([pending], withCode(OFFER)).kind).toBe("REUSE_PENDING");
    expect(decide([pending], undefined).kind).toBe("ABANDON_THEN_CREATE");
    expect(decide([pending], withCode({ ...OFFER, code: "OTHER" }, {}, "OTHER")).kind).toBe("ABANDON_THEN_CREATE");
  });

  it("returns a provisioning record only for the same intent, and never creates a second", () => {
    expect(decide([sub("PROVISIONING", { kind: "TRIAL" })], trial()).kind).toBe("RETURN_PROVISIONING");
    expect(decide([sub("PROVISIONING", { kind: "TRIAL" })], undefined)).toEqual({ kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" });
    expect(decide([sub("PROVISIONING", { marketingCode: "WELCOME" })], undefined)).toEqual({ kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" });
  });

  it("does not hand back a pending trial checkout to a user whose trial has since been consumed", () => {
    expect(decide([sub("PENDING_AUTHENTICATION", { kind: "TRIAL" })], trial({ trialConsumed: true }))).toEqual({
      kind: "REFUSE",
      reason: "TRIAL_NOT_ELIGIBLE",
    });
  });
});

describe("an Offer code checkout", () => {
  it("creates and carries the code's definition for the create step", () => {
    expect(decide([], withCode(OFFER))).toEqual({ kind: "CREATE", offer: OFFER });
  });

  it("refuses an unknown code before any provider call", () => {
    expect(decide([], withCode(null))).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
  });

  it("refuses an expired and a not-yet-valid code", () => {
    expect(decide([], withCode({ ...OFFER, validUntil: new Date(NOW.getTime() - HOUR) }))).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
    expect(decide([], withCode({ ...OFFER, validFrom: new Date(NOW.getTime() + HOUR) }))).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
  });

  it("refuses another plan and another cycle", () => {
    expect(decide([], withCode(OFFER), PRO_PLUS_MONTHLY)).toEqual({ kind: "REFUSE", reason: "CODE_NOT_APPLICABLE" });
    expect(decide([], withCode(OFFER), PRO_YEARLY)).toEqual({ kind: "REFUSE", reason: "CODE_NOT_APPLICABLE" });
  });

  it("refuses an ineligible user: FIRST_PAID_SUBSCRIPTION_ONLY after a qualifying subscription", () => {
    const firstOnly = { ...OFFER, eligibility: "FIRST_PAID_SUBSCRIPTION_ONLY" } as const;

    expect(decide([], withCode(firstOnly, { hadQualifyingSubscription: true }))).toEqual({ kind: "REFUSE", reason: "CODE_NOT_ELIGIBLE" });
    expect(decide([], withCode(firstOnly, { hadQualifyingSubscription: false }))).toEqual({ kind: "CREATE", offer: firstOnly });
  });

  it("refuses ONCE_PER_USER after a contributing subscription carried the code, not after another code", () => {
    const once = { ...OFFER, eligibility: "ONCE_PER_USER" } as const;

    expect(decide([], withCode(once, { contributedCodes: new Set(["WELCOME"]) }))).toEqual({ kind: "REFUSE", reason: "CODE_NOT_ELIGIBLE" });
    expect(decide([], withCode(once, { contributedCodes: new Set(["OTHER"]) })).kind).toBe("CREATE");
  });

  it("refuses when a subscription is live: the table wins, and a code never gets around SB-UQ-03", () => {
    expect(decide([sub("ACTIVE")], withCode(OFFER))).toMatchObject({ kind: "REFUSE", reason: "SUBSCRIPTION_EXISTS" });
  });

  it("evaluates a code on an abandon-then-create decision too: an ineligible code is refused before the old checkout is touched", () => {
    const pending = sub("PENDING_AUTHENTICATION", { plan: "PRO_PLUS" });

    expect(decide([pending], withCode(null))).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
  });

  it("evaluates a code on a supersession, before anything is cancelled", () => {
    const halted = sub("HALTED");
    const supersedes = { subscriptionId: halted.id, predecessor: { id: halted.id, phase: "HALTED", supersededById: null } } as const;
    const refused = evaluateCheckoutPreconditions({
      open: [halted],
      hasOpenAnomaly: false,
      intent: PRO_MONTHLY,
      now: NOW,
      reuseMinRemainingSeconds: 300,
      supersedes,
      acquisition: withCode(null),
    });
    const allowed = evaluateCheckoutPreconditions({
      open: [halted],
      hasOpenAnomaly: false,
      intent: PRO_MONTHLY,
      now: NOW,
      reuseMinRemainingSeconds: 300,
      supersedes,
      acquisition: trial(),
    });

    expect(refused).toEqual({ kind: "REFUSE", reason: "CODE_INVALID" });
    expect(allowed.kind).toBe("SUPERSEDE_THEN_CREATE");
  });
});

describe("allowedBillingActions — the server-computed trial flag", () => {
  const base = {
    billingAvailable: true,
    open: [] as OpenSubscriptionView[],
    hasOpenAnomaly: false,
    now: NOW,
    reuseMinRemainingSeconds: 300,
    purchasable: [PRO_MONTHLY, PRO_YEARLY, PRO_PLUS_MONTHLY],
    operationPending: false,
    prices: { current: undefined, of: () => undefined },
    trialLengthDays: 14,
  };
  const history = (overrides: Partial<BillingHistory>): BillingHistory => ({ ...NO_BILLING_HISTORY, ...overrides });

  it("offers a trial on every purchasable plan to an eligible user with nothing open", () => {
    expect(allowedBillingActions(base).trial).toEqual({ lengthDays: 14, plans: [PRO_MONTHLY, PRO_YEARLY, PRO_PLUS_MONTHLY] });
  });

  it("offers none once a trial was consumed", () => {
    expect(allowedBillingActions({ ...base, history: history({ trialConsumed: true }) }).trial).toBeNull();
  });

  it("offers none while a subscription is live, or an operation is pending, or billing is unavailable", () => {
    expect(allowedBillingActions({ ...base, open: [sub("ACTIVE")] }).trial).toBeNull();
    expect(allowedBillingActions({ ...base, operationPending: true }).trial).toBeNull();
    expect(allowedBillingActions({ ...base, billingAvailable: false }).trial).toBeNull();
  });

  it("offers none when no trial length is configured to offer", () => {
    expect(allowedBillingActions({ ...base, trialLengthDays: undefined }).trial).toBeNull();
  });

  it("still offers a trial over a pending standard checkout (it is abandoned then replaced)", () => {
    expect(allowedBillingActions({ ...base, open: [sub("PENDING_AUTHENTICATION")] }).trial?.plans).toContainEqual(PRO_MONTHLY);
  });

  it("reports a resumable pending checkout with the intent it was created with, a trial or a code included", () => {
    const pending = sub("PENDING_AUTHENTICATION", { kind: "TRIAL" as SubscriptionKind, marketingCode: null });

    expect(allowedBillingActions({ ...base, open: [pending] }).resumeCheckout).toEqual({ ...PRO_MONTHLY, kind: "TRIAL", code: null });
  });
});
