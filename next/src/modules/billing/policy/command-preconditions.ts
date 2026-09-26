/**
 * Billing — The Command Preconditions
 *
 * **The one place** the rules for every self-serve billing command are
 * evaluated against local state, so the UI's "allowed actions" and the
 * server's refusal can never disagree. A later switch or supersession
 * relaxation changes this file alone (IB-21 item 2): callers and the runner
 * do not change.
 *
 * **Checkout — the open-subscription precondition.** "Kizunia never creates a
 * second open subscription for a user" (SB-UQ-02), as the reuse and uniqueness
 * table of docs/architecture/subscription/implementation/checkout-flow.md:
 *
 *   user's open subscriptions                         decision
 *   none                                              CREATE
 *   more than one, or an open multiple-subs anomaly   REFUSE  CONTACT_SUPPORT
 *   PROVISIONING, same plan and cycle                 RETURN_PROVISIONING ("still being set up")
 *   PROVISIONING, other plan or cycle                 REFUSE  CHECKOUT_IN_PROGRESS (never a second create)
 *   PENDING_AUTHENTICATION, same plan and cycle,
 *     enough time left before expire_by               REUSE_PENDING (stored checkout, no provider call)
 *   PENDING_AUTHENTICATION, other plan or cycle,
 *     or (nearly) expired                             ABANDON_THEN_CREATE (composed; confirmed by sync)
 *   TRIALING, ACTIVE, PAST_DUE                        REFUSE  SUBSCRIPTION_EXISTS (+ plan-change advisory)
 *   HALTED, PAUSED                                    REFUSE  SUPERSESSION_REQUIRED
 *
 *   with an explicit supersession (IB-26 item 5; multiple-subscriptions.md):
 *   the named HALTED/PAUSED subscription is open      SUPERSEDE_THEN_CREATE (cancel, observe, create)
 *   none open; the named one is observed CANCELLED
 *     and not superseded yet                          CREATE + link it (the continuation)
 *   anything else                                     REFUSE  SUPERSESSION_NOT_APPLICABLE
 *
 * **Trials and codes** (Phase VII, IB-27). After the table above (whose refusals
 * always win), a decision that would start or hand back a checkout also has to
 * satisfy the acquisition rules, in this order:
 *
 *   a code on a trial checkout                        REFUSE  CODE_NOT_ALLOWED_ON_TRIAL
 *   a trial, and one was already consumed (SB-LC-11)  REFUSE  TRIAL_NOT_ELIGIBLE
 *   a code unknown, outside its window, or not sold
 *     in this mode                                    REFUSE  CODE_INVALID
 *   a code for another plan or cycle                  REFUSE  CODE_NOT_APPLICABLE
 *   a code the user's own history rules out           REFUSE  CODE_NOT_ELIGIBLE
 *
 * "The same plan" in the table means the same intent: plan, cycle, kind and
 * code. A pending checkout of another kind or code is abandoned and recreated
 * (IB-27 item 10). The rules for a code live in `code-eligibility.ts`, for a
 * trial in `trial-eligibility.ts`; both read only the history the caller
 * passes in, so this stays pure.
 *
 * **Cancel** (lifecycle/cancellation.md; IB-1):
 *
 *   ACTIVE                  cycle end (a pending scheduled change is cancelled first, SB-LC-08);
 *                           already requested -> answered from local state, nothing sent
 *   TRIALING, PAST_DUE      immediate (PAST_DUE: IB-1)
 *   HALTED, PAUSED          immediate only (a cycle-end request is a silent no-op there, I-2)
 *   PENDING_AUTHENTICATION  abandon (immediate)
 *   PROVISIONING            REFUSE CHECKOUT_IN_PROGRESS (nothing to cancel yet)
 *   none / terminal         REFUSE NO_SUBSCRIPTION
 *
 *   A cycle-end cancel is never decided outside ACTIVE (I-2). The customer's
 *   acknowledged timing must equal the one required now (IB-26 item 2).
 *
 * **Change plan** (lifecycle/upgrade-downgrade.md): a paid subscription, no
 * cycle-end cancel requested, a different plan, then whatever the one
 * plan-change strategy (`plan-change-strategy.ts`) says.
 *
 * Pure: the caller reads local state inside the transaction that holds the
 * user's operation slot and passes it in.
 */
import type { BillingCycle, MembershipPlan, SubscriptionKind, SubscriptionPhase } from "@/generated/prisma";

import {
  evaluateOfferCode,
  NO_BILLING_HISTORY,
  type BillingHistory,
  type CodeRefusal,
  type OfferCodeDefinition,
} from "./code-eligibility";
import {
  planChangeAdvisory,
  planChangeStrategy,
  type PlanChangeAdvisory,
  type PlanChangeUnavailableReason,
  type ScheduleChangeAt,
} from "./plan-change-strategy";
import { isTrialEligible } from "./trial-eligibility";

export { planChangeAdvisory, type PlanChangeAdvisory };

/** A subscription in an open phase (`isOpenPhase`), as the preconditions see it. */
export interface OpenSubscriptionView {
  readonly id: string;
  readonly phase: SubscriptionPhase;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  /** `STANDARD` or `TRIAL`, as recorded at creation (SB-LC-10). */
  readonly kind: SubscriptionKind;
  /** The normalized Offer code the subscription was created with, if any. */
  readonly marketingCode: string | null;
  readonly expireBy: Date | null;
  /** UX only (SB-LC-07): feeds the advisory, never a rule of its own. */
  readonly advisoryPaymentMethod: string | null;
  readonly advisoryInternationalCard: boolean | null;
  /** Kizunia's own record of a requested cycle-end cancellation (I-1). */
  readonly cancelAtPeriodEnd: boolean;
  /** Kizunia's target for a pending `cycle_end` change, when it scheduled one. */
  readonly scheduledPlan: MembershipPlan | null;
  readonly scheduledCycle: BillingCycle | null;
  /** A pending scheduled change exists: Kizunia's target, or the provider flag alone (a Dashboard change). */
  readonly hasScheduledChange: boolean;
}

export interface CheckoutIntent {
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
}

/**
 * What else the checkout asks for beyond a plan and cycle (Phase VII): a trial
 * and/or an Offer code, with the facts the acquisition rules decide from. The
 * caller loads `offer` and `history` in the transaction that holds the user's
 * slot; the policy stays pure. Absent = a plain standard checkout.
 */
export interface CheckoutAcquisition {
  readonly kind: SubscriptionKind;
  /** The normalized code the customer entered, or `null`. */
  readonly code: string | null;
  /** The catalog's definition of `code` in the current mode; `null` when it is unknown. */
  readonly offer: OfferCodeDefinition | null;
  readonly history: BillingHistory;
}

export const STANDARD_ACQUISITION: CheckoutAcquisition = {
  kind: "STANDARD",
  code: null,
  offer: null,
  history: NO_BILLING_HISTORY,
};

// ---------------------------------------------------------------------------
// Checkout (and supersession)
// ---------------------------------------------------------------------------

export type CheckoutRefusal =
  | "CONTACT_SUPPORT"
  | "CHECKOUT_IN_PROGRESS"
  | "SUBSCRIPTION_EXISTS"
  | "SUPERSESSION_REQUIRED"
  | "SUPERSESSION_NOT_APPLICABLE"
  | "TRIAL_NOT_ELIGIBLE"
  | "CODE_NOT_ALLOWED_ON_TRIAL"
  | CodeRefusal;

export type CheckoutDecision =
  /**
   * `linkPredecessor`: a supersession's continuation; the new record supersedes that one.
   * `offer`: the code's definition, when the checkout carries a code that passed.
   */
  | { readonly kind: "CREATE"; readonly linkPredecessor?: string; readonly offer?: OfferCodeDefinition }
  | { readonly kind: "RETURN_PROVISIONING"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "REUSE_PENDING"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "ABANDON_THEN_CREATE"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "SUPERSEDE_THEN_CREATE"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "REFUSE"; readonly reason: CheckoutRefusal; readonly planChange?: PlanChangeAdvisory };

/** The subscription a supersession request names, if it is the caller's own in this mode. */
export interface PredecessorView {
  readonly id: string;
  readonly phase: SubscriptionPhase;
  readonly supersededById: string | null;
}

export interface SupersessionInput {
  /** The Kizunia ID the customer confirmed replacing. */
  readonly subscriptionId: string;
  /** That subscription, or `null` when it is not the caller's own (or does not exist). */
  readonly predecessor: PredecessorView | null;
}

export interface CheckoutPreconditionInput {
  /** The user's subscriptions in an open phase, in the current provider mode. */
  readonly open: readonly OpenSubscriptionView[];
  /** An unresolved `MULTIPLE_OPEN_SUBSCRIPTIONS` anomaly for the user. */
  readonly hasOpenAnomaly: boolean;
  readonly intent: CheckoutIntent;
  readonly now: Date;
  readonly reuseMinRemainingSeconds: number;
  /** Present only when the customer explicitly confirmed replacing an on-hold subscription. */
  readonly supersedes?: SupersessionInput | null;
  /** A trial and/or an Offer code; absent for a plain standard checkout. */
  readonly acquisition?: CheckoutAcquisition;
}

export function evaluateCheckoutPreconditions(input: CheckoutPreconditionInput): CheckoutDecision {
  return applyAcquisition(evaluateOpenSubscriptions(input), input);
}

/** The trial and code rules, applied to any decision that would start or return a checkout. */
function applyAcquisition(decision: CheckoutDecision, input: CheckoutPreconditionInput): CheckoutDecision {
  switch (decision.kind) {
    case "CREATE":
    case "SUPERSEDE_THEN_CREATE":
    case "ABANDON_THEN_CREATE":
    case "REUSE_PENDING":
      break;
    default:
      return decision;
  }

  const acquisition = input.acquisition ?? STANDARD_ACQUISITION;

  if (acquisition.kind === "TRIAL") {
    // Whether an Offer and a trial can combine is not documented (IB-27 item 3).
    if (acquisition.code !== null) return { kind: "REFUSE", reason: "CODE_NOT_ALLOWED_ON_TRIAL" };
    if (!isTrialEligible(acquisition.history)) return { kind: "REFUSE", reason: "TRIAL_NOT_ELIGIBLE" };

    return decision;
  }

  if (acquisition.code === null) return decision;

  const evaluation = evaluateOfferCode(acquisition.offer, input.intent, acquisition.history, input.now);

  if (evaluation.kind === "REFUSE") return { kind: "REFUSE", reason: evaluation.reason };

  return decision.kind === "CREATE" ? { ...decision, offer: evaluation.definition } : decision;
}

function evaluateOpenSubscriptions(input: CheckoutPreconditionInput): CheckoutDecision {
  const { open, hasOpenAnomaly, intent } = input;
  const acquisition = input.acquisition ?? STANDARD_ACQUISITION;

  if (hasOpenAnomaly || open.length > 1) return { kind: "REFUSE", reason: "CONTACT_SUPPORT" };

  const [current] = open;

  if (input.supersedes) return evaluateSupersession(current ?? null, input.supersedes);

  if (!current) return { kind: "CREATE" };

  // The same intent: plan, cycle, kind and code (IB-27 item 10).
  const sameIntent =
    current.plan === intent.plan &&
    current.cycle === intent.cycle &&
    current.kind === acquisition.kind &&
    current.marketingCode === acquisition.code;

  switch (current.phase) {
    case "PROVISIONING":
      return sameIntent
        ? { kind: "RETURN_PROVISIONING", subscription: current }
        : { kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" };

    case "PENDING_AUTHENTICATION":
      return sameIntent && isResumable(current, input.now, input.reuseMinRemainingSeconds)
        ? { kind: "REUSE_PENDING", subscription: current }
        : { kind: "ABANDON_THEN_CREATE", subscription: current };

    case "TRIALING":
    case "ACTIVE":
    case "PAST_DUE":
      return { kind: "REFUSE", reason: "SUBSCRIPTION_EXISTS", planChange: planChangeAdvisory(current) };

    case "HALTED":
    case "PAUSED":
      return { kind: "REFUSE", reason: "SUPERSESSION_REQUIRED" };

    default:
      // A terminal phase is never passed in as open; refuse rather than guess.
      return { kind: "REFUSE", reason: "CONTACT_SUPPORT" };
  }
}

/** SB-UQ-04: an on-hold subscription is replaced only after its cancellation is observed. */
function evaluateSupersession(current: OpenSubscriptionView | null, supersedes: SupersessionInput): CheckoutDecision {
  const notApplicable = { kind: "REFUSE", reason: "SUPERSESSION_NOT_APPLICABLE" } as const;

  if (current) {
    return current.id === supersedes.subscriptionId && isSupersedable(current.phase)
      ? { kind: "SUPERSEDE_THEN_CREATE", subscription: current }
      : notApplicable;
  }

  // Nothing open: the named subscription must be the one this supersession already ended.
  const predecessor = supersedes.predecessor;

  return predecessor !== null && predecessor.phase === "CANCELLED" && predecessor.supersededById === null
    ? { kind: "CREATE", linkPredecessor: predecessor.id }
    : notApplicable;
}

export function isSupersedable(phase: SubscriptionPhase): boolean {
  return phase === "HALTED" || phase === "PAUSED";
}

/** A pending checkout the customer can still complete, with time to spare. */
export function isResumable(subscription: OpenSubscriptionView, now: Date, reuseMinRemainingSeconds: number): boolean {
  return (
    subscription.phase === "PENDING_AUTHENTICATION" &&
    subscription.expireBy !== null &&
    subscription.expireBy.getTime() - now.getTime() >= reuseMinRemainingSeconds * 1000
  );
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/** What the customer is told, and acknowledges, before cancelling. */
export type CancelTiming = "CYCLE_END" | "IMMEDIATE";

export type CancelRefusal = "NO_SUBSCRIPTION" | "CONTACT_SUPPORT" | "CHECKOUT_IN_PROGRESS" | "TIMING_CHANGED";

export type CancelDecision =
  | { readonly kind: "CANCEL_AT_CYCLE_END"; readonly subscription: OpenSubscriptionView; readonly cancelScheduledFirst: boolean }
  | {
      readonly kind: "CANCEL_IMMEDIATELY";
      readonly subscription: OpenSubscriptionView;
      /** A pending checkout is abandoned rather than cancelled (the same provider call). */
      readonly abandon: boolean;
    }
  /** A cycle-end cancellation is already requested: answered from local state, nothing sent. */
  | { readonly kind: "ALREADY_REQUESTED"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "REFUSE"; readonly reason: CancelRefusal; readonly requiredTiming?: CancelTiming };

export interface CancelPreconditionInput {
  readonly open: readonly OpenSubscriptionView[];
  readonly hasOpenAnomaly: boolean;
  /** The timing the customer confirmed; `null` to evaluate without one (the summary). */
  readonly acknowledged: CancelTiming | null;
}

/**
 * The timing a customer cancellation takes in each phase, or `null` where
 * there is nothing a customer can cancel. `CYCLE_END` only for `ACTIVE`: in
 * every other phase TEST showed a cycle-end request to be refused or a silent
 * no-op (I-2, IB-1).
 */
export function requiredCancelTiming(phase: SubscriptionPhase): CancelTiming | null {
  switch (phase) {
    case "ACTIVE":
      return "CYCLE_END";
    case "TRIALING":
    case "PAST_DUE":
    case "HALTED":
    case "PAUSED":
    case "PENDING_AUTHENTICATION":
      return "IMMEDIATE";
    default:
      return null;
  }
}

export function evaluateCancelPreconditions(input: CancelPreconditionInput): CancelDecision {
  const { open, hasOpenAnomaly, acknowledged } = input;

  if (hasOpenAnomaly || open.length > 1) return { kind: "REFUSE", reason: "CONTACT_SUPPORT" };

  const [current] = open;

  if (!current) return { kind: "REFUSE", reason: "NO_SUBSCRIPTION" };
  if (current.phase === "PROVISIONING") return { kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" };

  const required = requiredCancelTiming(current.phase);

  if (required === null) return { kind: "REFUSE", reason: "NO_SUBSCRIPTION" };

  // No undo, no repeat: the flag records Kizunia's request (SB-LC-09, I-1).
  if (current.phase === "ACTIVE" && current.cancelAtPeriodEnd) return { kind: "ALREADY_REQUESTED", subscription: current };

  if (acknowledged !== null && acknowledged !== required) {
    return { kind: "REFUSE", reason: "TIMING_CHANGED", requiredTiming: required };
  }

  return required === "CYCLE_END"
    ? { kind: "CANCEL_AT_CYCLE_END", subscription: current, cancelScheduledFirst: current.hasScheduledChange }
    : { kind: "CANCEL_IMMEDIATELY", subscription: current, abandon: current.phase === "PENDING_AUTHENTICATION" };
}

// ---------------------------------------------------------------------------
// Change plan
// ---------------------------------------------------------------------------

export type PlanChangeRefusal = "NO_SUBSCRIPTION" | "CONTACT_SUPPORT" | "CANCELLATION_REQUESTED" | "SAME_PLAN" | "UNAVAILABLE";

export type PlanChangeDecision =
  | {
      readonly kind: "CHANGE";
      readonly subscription: OpenSubscriptionView;
      readonly scheduleChangeAt: ScheduleChangeAt;
      /** A pending change is cancelled first (SB-LC-08). */
      readonly cancelScheduledFirst: boolean;
    }
  /** The same change is already scheduled: answered from local state, nothing sent. */
  | { readonly kind: "ALREADY_SCHEDULED"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "REFUSE"; readonly reason: PlanChangeRefusal; readonly unavailable?: PlanChangeUnavailableReason };

/** Configured plan prices, for telling an upgrade from a downgrade (IB-26 item 6). */
export interface PlanPrices {
  /** The price of the plan the open subscription is on (its own provider plan, retired or not). */
  readonly current: number | undefined;
  /** The price of the plan sold now for an intent. */
  of(intent: CheckoutIntent): number | undefined;
}

export interface PlanChangePreconditionInput {
  readonly open: readonly OpenSubscriptionView[];
  readonly hasOpenAnomaly: boolean;
  readonly target: CheckoutIntent;
  readonly prices: PlanPrices;
}

export function evaluatePlanChangePreconditions(input: PlanChangePreconditionInput): PlanChangeDecision {
  const { open, hasOpenAnomaly, target } = input;

  if (hasOpenAnomaly || open.length > 1) return { kind: "REFUSE", reason: "CONTACT_SUPPORT" };

  const [current] = open;

  // A pending checkout is not a paid subscription: a new plan is a new checkout.
  if (!current || current.phase === "PROVISIONING" || current.phase === "PENDING_AUTHENTICATION") {
    return { kind: "REFUSE", reason: "NO_SUBSCRIPTION" };
  }

  // The subscription is ending: buy the new plan after it ends (upgrade-downgrade.md).
  if (current.cancelAtPeriodEnd) return { kind: "REFUSE", reason: "CANCELLATION_REQUESTED" };

  if (current.plan === target.plan && current.cycle === target.cycle) return { kind: "REFUSE", reason: "SAME_PLAN" };

  if (current.scheduledPlan === target.plan && current.scheduledCycle === target.cycle) {
    return { kind: "ALREADY_SCHEDULED", subscription: current };
  }

  const strategy = planChangeStrategy({
    phase: current.phase,
    advisory: current,
    currentPriceMinor: input.prices.current,
    targetPriceMinor: input.prices.of(target),
  });

  if (strategy.kind === "UNAVAILABLE") return { kind: "REFUSE", reason: "UNAVAILABLE", unavailable: strategy.reason };

  return {
    kind: "CHANGE",
    subscription: current,
    scheduleChangeAt: strategy.scheduleChangeAt,
    cancelScheduledFirst: current.hasScheduledChange,
  };
}

// ---------------------------------------------------------------------------
// Allowed actions (the `/me/billing` view of the same rules)
// ---------------------------------------------------------------------------

export interface PlanChangeOption extends CheckoutIntent {
  readonly scheduleChangeAt: ScheduleChangeAt;
}

export interface AllowedBillingActions {
  /** Plans a checkout may be started for now. Empty when billing is unavailable or refused. */
  readonly startCheckout: readonly CheckoutIntent[];
  /**
   * A pending checkout the user can go back to: asking for the same intent
   * (plan, cycle, kind and code) returns it, with no new provider call.
   */
  readonly resumeCheckout: (CheckoutIntent & { readonly kind: SubscriptionKind; readonly code: string | null }) | null;
  /**
   * A trial the user can start now (Phase VII): `null` when they may not (one
   * was already consumed, a subscription is open, billing is unavailable) or
   * no trial is on offer. The server's flag; the UI never decides eligibility.
   */
  readonly trial: { readonly lengthDays: number; readonly plans: readonly CheckoutIntent[] } | null;
  /** Why a checkout would be refused, when every plan is refused for the same reason. */
  readonly refusal: CheckoutRefusal | null;
  readonly planChange: PlanChangeAdvisory | null;
  /** The cancellation the customer may confirm now, and its timing; `null` when none. */
  readonly cancel: { readonly timing: CancelTiming; readonly abandon: boolean } | null;
  /** Native plan changes on offer, and why none are when the strategy says so. */
  readonly changePlan: {
    readonly options: readonly PlanChangeOption[];
    readonly unavailable: PlanChangeUnavailableReason | null;
  } | null;
  /** The on-hold subscription a new checkout would replace (after an explicit confirmation), and the plans on offer. */
  readonly supersede: { readonly subscriptionId: string; readonly plans: readonly CheckoutIntent[] } | null;
  /** Razorpay's payment-method change and "check now" are offered (HALTED, PAUSED). */
  readonly recover: boolean;
}

export interface AllowedActionsInput extends Omit<CheckoutPreconditionInput, "intent" | "supersedes" | "acquisition"> {
  readonly billingAvailable: boolean;
  /** The user's own subscription history (trial eligibility); absent = none. */
  readonly history?: BillingHistory;
  /** The configured trial length; absent = no trial is on offer. */
  readonly trialLengthDays?: number;
  /** What is for sale in the current mode (catalog entries that are not retired). */
  readonly purchasable: readonly CheckoutIntent[];
  /** An operation for the user is in flight or unresolved: nothing may start now. */
  readonly operationPending: boolean;
  readonly prices: PlanPrices;
}

export const NO_BILLING_ACTIONS: AllowedBillingActions = {
  startCheckout: [],
  resumeCheckout: null,
  refusal: null,
  planChange: null,
  cancel: null,
  changePlan: null,
  supersede: null,
  recover: false,
  trial: null,
};

export function allowedBillingActions(input: AllowedActionsInput): AllowedBillingActions {
  if (!input.billingAvailable) return NO_BILLING_ACTIONS;

  const pending = input.operationPending;
  const decisions = input.purchasable.map((intent) => ({ intent, decision: evaluateCheckoutPreconditions({ ...input, intent }) }));
  // A pending checkout is resumable as the intent it was created with (a trial or a code included).
  const resumable =
    input.open.length === 1 && !input.hasOpenAnomaly && isResumable(input.open[0], input.now, input.reuseMinRemainingSeconds) ? input.open[0] : undefined;
  const trialPlans =
    input.trialLengthDays === undefined
      ? []
      : input.purchasable.filter((intent) => {
          const { kind } = evaluateCheckoutPreconditions({
            ...input,
            intent,
            acquisition: { ...STANDARD_ACQUISITION, kind: "TRIAL", history: input.history ?? NO_BILLING_HISTORY },
          });

          return kind === "CREATE" || kind === "ABANDON_THEN_CREATE" || kind === "REUSE_PENDING";
        });
  const refusals = decisions.flatMap(({ decision }) => (decision.kind === "REFUSE" ? [decision] : []));
  const allRefusedAlike =
    refusals.length > 0 &&
    refusals.length === decisions.length &&
    refusals.every((refusal) => refusal.reason === refusals[0].reason);

  const [current] = input.open;
  const single = input.open.length === 1 && !input.hasOpenAnomaly ? current : undefined;

  const cancelDecision = evaluateCancelPreconditions({ open: input.open, hasOpenAnomaly: input.hasOpenAnomaly, acknowledged: null });
  const cancel =
    !pending && cancelDecision.kind === "CANCEL_AT_CYCLE_END"
      ? { timing: "CYCLE_END" as const, abandon: false }
      : !pending && cancelDecision.kind === "CANCEL_IMMEDIATELY"
        ? { timing: "IMMEDIATE" as const, abandon: cancelDecision.abandon }
        : null;

  return {
    startCheckout: pending
      ? []
      : decisions
          .filter(({ decision }) => decision.kind === "CREATE" || decision.kind === "ABANDON_THEN_CREATE" || decision.kind === "REUSE_PENDING")
          .map(({ intent }) => intent),
    resumeCheckout: resumable ? { plan: resumable.plan, cycle: resumable.cycle, kind: resumable.kind, code: resumable.marketingCode } : null,
    trial: pending || trialPlans.length === 0 || input.trialLengthDays === undefined ? null : { lengthDays: input.trialLengthDays, plans: trialPlans },
    refusal: allRefusedAlike ? refusals[0].reason : null,
    planChange: refusals.find((refusal) => refusal.planChange)?.planChange ?? null,
    cancel,
    changePlan: pending || !single ? null : planChangeOptions(input, single),
    supersede: !pending && single && isSupersedable(single.phase) ? { subscriptionId: single.id, plans: input.purchasable } : null,
    recover: single !== undefined && isSupersedable(single.phase),
  };
}

/** The plan changes on offer for a paid subscription; `null` when it has none to change. */
function planChangeOptions(input: AllowedActionsInput, current: OpenSubscriptionView): AllowedBillingActions["changePlan"] {
  const targets = input.purchasable.filter((intent) => intent.plan !== current.plan || intent.cycle !== current.cycle);
  const evaluated = targets.map((target) => ({
    target,
    decision: evaluatePlanChangePreconditions({ open: input.open, hasOpenAnomaly: input.hasOpenAnomaly, target, prices: input.prices }),
  }));

  if (evaluated.some(({ decision }) => decision.kind === "REFUSE" && decision.reason !== "UNAVAILABLE")) {
    // Not a changeable subscription at all (none paid, or ending): nothing to show.
    return null;
  }

  const options = evaluated.flatMap(({ target, decision }) =>
    decision.kind === "CHANGE" ? [{ ...target, scheduleChangeAt: decision.scheduleChangeAt }] : [],
  );
  const unavailable = evaluated.flatMap(({ decision }) =>
    decision.kind === "REFUSE" && decision.unavailable && decision.unavailable !== "SAME_PRICE" ? [decision.unavailable] : [],
  );

  return { options, unavailable: options.length === 0 ? (unavailable[0] ?? null) : null };
}
