/**
 * Billing — The Open-Subscription Precondition
 *
 * **The one place** the rule "Kizunia never creates a second open subscription
 * for a user" (SB-UQ-02) is evaluated, as the reuse and uniqueness table of
 * docs/architecture/subscription/implementation/checkout-flow.md:
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
 *   HALTED, PAUSED                                    REFUSE  SUPERSESSION_REQUIRED (Phase VI)
 *
 * Every command and the `/me/billing` summary ask this module, so the UI's
 * "allowed actions" and the server's refusal can never disagree. A later
 * switch or supersession flow relaxes the rule by changing this file alone
 * (IB-21 item 2): callers and the runner do not change.
 *
 * Pure: the caller reads local state inside the transaction that holds the
 * user's operation slot and passes it in.
 */
import type { BillingCycle, MembershipPlan, SubscriptionPhase } from "@/generated/prisma";

/** A subscription in an open phase (`isOpenPhase`), as the precondition sees it. */
export interface OpenSubscriptionView {
  readonly id: string;
  readonly phase: SubscriptionPhase;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly expireBy: Date | null;
  /** UX only (SB-LC-07): feeds the advisory, never a rule. */
  readonly advisoryPaymentMethod: string | null;
  readonly advisoryInternationalCard: boolean | null;
}

export interface CheckoutIntent {
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
}

/**
 * Advisory only (SB-LC-07): whether Razorpay is expected to allow a native
 * plan change for the live subscription. Razorpay refuses Update for UPI,
 * e-mandate and domestic-card subscriptions (R-06), so only an international
 * card is expected to work. Kizunia never enforces this; Razorpay decides.
 */
export type PlanChangeAdvisory = "NATIVE_UPDATE_POSSIBLE" | "V1_LIMITATION" | "UNKNOWN";

export type CheckoutRefusal = "CONTACT_SUPPORT" | "CHECKOUT_IN_PROGRESS" | "SUBSCRIPTION_EXISTS" | "SUPERSESSION_REQUIRED";

export type CheckoutDecision =
  | { readonly kind: "CREATE" }
  | { readonly kind: "RETURN_PROVISIONING"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "REUSE_PENDING"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "ABANDON_THEN_CREATE"; readonly subscription: OpenSubscriptionView }
  | { readonly kind: "REFUSE"; readonly reason: CheckoutRefusal; readonly planChange?: PlanChangeAdvisory };

export interface CheckoutPreconditionInput {
  /** The user's subscriptions in an open phase, in the current provider mode. */
  readonly open: readonly OpenSubscriptionView[];
  /** An unresolved `MULTIPLE_OPEN_SUBSCRIPTIONS` anomaly for the user. */
  readonly hasOpenAnomaly: boolean;
  readonly intent: CheckoutIntent;
  readonly now: Date;
  readonly reuseMinRemainingSeconds: number;
}

export function evaluateCheckoutPreconditions(input: CheckoutPreconditionInput): CheckoutDecision {
  const { open, hasOpenAnomaly, intent } = input;

  if (hasOpenAnomaly || open.length > 1) return { kind: "REFUSE", reason: "CONTACT_SUPPORT" };

  const [current] = open;

  if (!current) return { kind: "CREATE" };

  const samePlan = current.plan === intent.plan && current.cycle === intent.cycle;

  switch (current.phase) {
    case "PROVISIONING":
      return samePlan
        ? { kind: "RETURN_PROVISIONING", subscription: current }
        : { kind: "REFUSE", reason: "CHECKOUT_IN_PROGRESS" };

    case "PENDING_AUTHENTICATION":
      return samePlan && isResumable(current, input.now, input.reuseMinRemainingSeconds)
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

/** A pending checkout the customer can still complete, with time to spare. */
export function isResumable(subscription: OpenSubscriptionView, now: Date, reuseMinRemainingSeconds: number): boolean {
  return (
    subscription.phase === "PENDING_AUTHENTICATION" &&
    subscription.expireBy !== null &&
    subscription.expireBy.getTime() - now.getTime() >= reuseMinRemainingSeconds * 1000
  );
}

export function planChangeAdvisory(subscription: Pick<OpenSubscriptionView, "advisoryPaymentMethod" | "advisoryInternationalCard">): PlanChangeAdvisory {
  const method = subscription.advisoryPaymentMethod?.toLowerCase() ?? null;

  if (method === null) return "UNKNOWN";
  if (method === "card") {
    if (subscription.advisoryInternationalCard === true) return "NATIVE_UPDATE_POSSIBLE";
    if (subscription.advisoryInternationalCard === false) return "V1_LIMITATION";

    return "UNKNOWN";
  }

  return "V1_LIMITATION";
}

// ---------------------------------------------------------------------------
// Allowed actions (the `/me/billing` view of the same rule)
// ---------------------------------------------------------------------------

export interface AllowedBillingActions {
  /** Plans a checkout may be started for now. Empty when billing is unavailable or refused. */
  readonly startCheckout: readonly CheckoutIntent[];
  /** A pending checkout the user can go back to (the same plan returns it, no new provider call). */
  readonly resumeCheckout: CheckoutIntent | null;
  /** Why a checkout would be refused, when every plan is refused for the same reason. */
  readonly refusal: CheckoutRefusal | null;
  readonly planChange: PlanChangeAdvisory | null;
}

export interface AllowedActionsInput extends Omit<CheckoutPreconditionInput, "intent"> {
  readonly billingAvailable: boolean;
  /** What is for sale in the current mode (catalog entries that are not retired). */
  readonly purchasable: readonly CheckoutIntent[];
  /** An operation for the user is in flight or unresolved: nothing may start now. */
  readonly operationPending: boolean;
}

export function allowedBillingActions(input: AllowedActionsInput): AllowedBillingActions {
  if (!input.billingAvailable) {
    return { startCheckout: [], resumeCheckout: null, refusal: null, planChange: null };
  }

  const decisions = input.purchasable.map((intent) => ({ intent, decision: evaluateCheckoutPreconditions({ ...input, intent }) }));
  const resumable = decisions.find(({ decision }) => decision.kind === "REUSE_PENDING");
  const refusals = decisions.flatMap(({ decision }) => (decision.kind === "REFUSE" ? [decision] : []));
  const allRefusedAlike =
    refusals.length > 0 &&
    refusals.length === decisions.length &&
    refusals.every((refusal) => refusal.reason === refusals[0].reason);

  return {
    startCheckout: input.operationPending
      ? []
      : decisions
          .filter(({ decision }) => decision.kind === "CREATE" || decision.kind === "ABANDON_THEN_CREATE" || decision.kind === "REUSE_PENDING")
          .map(({ intent }) => intent),
    resumeCheckout: resumable?.intent ?? null,
    refusal: allRefusedAlike ? refusals[0].reason : null,
    planChange: refusals.find((refusal) => refusal.planChange)?.planChange ?? null,
  };
}
