/**
 * Billing — Trial Eligibility
 *
 * One trial per account (SB-LC-11). A user may start a trial only if none of
 * their Subscriptions of kind `TRIAL` has ever reached `TRIALING`. That is
 * derived from Subscription records (`firstContributedAt`, set by the apply
 * path on first entry to a contributing phase), so there is no separate table,
 * and the check runs inside the per-user command slot, so two tabs cannot both
 * pass it.
 *
 * An abandoned trial checkout (never authenticated) does not consume it. A
 * cancelled, converted or failed trial does: cancelling a trial is immediate,
 * so without the rule a user could cancel and start another indefinitely.
 *
 * Razorpay has no concept of a prior trial (razorpay-facts.md#trials), so the
 * rule can only live here. A cooldown or a repeat trial (B7) is not built.
 */
import type { BillingHistory } from "./code-eligibility";

export function isTrialEligible(history: Pick<BillingHistory, "trialConsumed">): boolean {
  return !history.trialConsumed;
}
