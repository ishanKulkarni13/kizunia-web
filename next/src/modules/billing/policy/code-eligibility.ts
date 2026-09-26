/**
 * Billing — Marketing-Code Eligibility (Offers and Promotions)
 *
 * The pure rules of SB-CP-04, shared by Offer codes (checked in the checkout
 * command's precondition step, before any Razorpay call) and promotion codes
 * (checked inside the redemption transaction). Nothing here reads a database,
 * the clock or the provider: the caller passes the code's definition, the
 * user's history and `now`, so the decision is a function of local records
 * (docs/architecture/subscription/entitlements/coupons-and-offers.md).
 *
 * The three rules, evaluated against the user's own **Subscription** records
 * (IB-27 items 5, 7 and 9), never against grants or effective access:
 *
 *   ANY_USER                       always eligible
 *   FIRST_PAID_SUBSCRIPTION_ONLY   no Subscription of this user ever reached
 *                                  TRIALING, ACTIVE or PAST_DUE
 *                                  (`hadQualifyingSubscription`). Access that came
 *                                  from an admin grant or a promotion does not count:
 *                                  it is not a subscription.
 *   ONCE_PER_USER                  no Subscription of this user that carried this
 *                                  code ever reached a contributing phase. A
 *                                  checkout that carried it and was abandoned or
 *                                  expired consumed nothing (the trial rule, SB-LC-11).
 *
 * All of it is scoped to the provider mode the caller loaded the history for.
 *
 * The provider's Offer identity is opaque here: `offerRef` is carried from the
 * catalog to the create step and read by nothing in between, so the source of
 * definitions (a static catalog today, admin-managed records later) can change
 * without touching these rules.
 */
import type { BillingCycle, CodeEligibility, MembershipPlan } from "@/generated/prisma";

/** What the user's own Subscription records say (built in the command's transaction, `billing-history.ts`). */
export interface BillingHistory {
  /** A `TRIAL` subscription of the user ever reached `TRIALING` (SB-LC-11). */
  readonly trialConsumed: boolean;
  /** Any subscription of the user ever reached `TRIALING`, `ACTIVE` or `PAST_DUE` (SB-CP-04). Subscriptions only. */
  readonly hadQualifyingSubscription: boolean;
  /** Normalized codes carried by subscriptions that reached a contributing phase. */
  readonly contributedCodes: ReadonlySet<string>;
}

export const NO_BILLING_HISTORY: BillingHistory = {
  trialConsumed: false,
  hadQualifyingSubscription: false,
  contributedCodes: new Set(),
};

/** A code as the catalog defines it. `offerRef` is opaque to everything but the create step. */
export interface OfferCodeDefinition {
  /** Normalized (`normalizeCode`). */
  readonly code: string;
  /** The provider's Offer, as an opaque reference (billing-internal, never sent to a browser). */
  readonly offerRef: string;
  readonly appliesTo: readonly { readonly plan: MembershipPlan; readonly cycle: BillingCycle }[];
  readonly eligibility: CodeEligibility;
  /** The window the code can be used in: `validFrom <= now < validUntil`. `null` = unbounded on that side. */
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  /** What the customer is shown once the code applies. Text only: the discount itself is the Offer's own configuration at Razorpay. */
  readonly description: string;
}

/**
 * Why a code cannot be used. `CODE_INVALID` covers "unknown", "outside its
 * window" and "not sold in this mode" alike, so a probe learns nothing about
 * codes that are not usable now (IB-27 item 12).
 */
export type CodeRefusal = "CODE_INVALID" | "CODE_NOT_APPLICABLE" | "CODE_NOT_ELIGIBLE";

export type CodeEvaluation =
  | { readonly kind: "OK"; readonly definition: OfferCodeDefinition }
  | { readonly kind: "REFUSE"; readonly reason: CodeRefusal };

/** The one normalization of a code, used for lookup, storage and comparison. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** `validFrom <= now < validUntil`; an absent bound is open. */
export function isWithinWindow(window: { readonly validFrom: Date | null; readonly validUntil: Date | null }, now: Date): boolean {
  if (window.validFrom !== null && now.getTime() < window.validFrom.getTime()) return false;
  if (window.validUntil !== null && now.getTime() >= window.validUntil.getTime()) return false;

  return true;
}

/** The three SB-CP-04 rules. `code` is normalized. */
export function satisfiesEligibility(rule: CodeEligibility, code: string, history: BillingHistory): boolean {
  switch (rule) {
    case "ANY_USER":
      return true;
    case "FIRST_PAID_SUBSCRIPTION_ONLY":
      return !history.hadQualifyingSubscription;
    case "ONCE_PER_USER":
      return !history.contributedCodes.has(code);
  }
}

/**
 * Evaluates an Offer code for a checkout intent: known and inside its window,
 * then applicable to the plan and cycle, then eligible for this user.
 */
export function evaluateOfferCode(
  definition: OfferCodeDefinition | null,
  intent: { readonly plan: MembershipPlan; readonly cycle: BillingCycle },
  history: BillingHistory,
  now: Date,
): CodeEvaluation {
  if (definition === null || !isWithinWindow(definition, now)) return { kind: "REFUSE", reason: "CODE_INVALID" };

  const applies = definition.appliesTo.some((entry) => entry.plan === intent.plan && entry.cycle === intent.cycle);

  if (!applies) return { kind: "REFUSE", reason: "CODE_NOT_APPLICABLE" };

  if (!satisfiesEligibility(definition.eligibility, definition.code, history)) {
    return { kind: "REFUSE", reason: "CODE_NOT_ELIGIBLE" };
  }

  return { kind: "OK", definition };
}
