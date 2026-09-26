/**
 * Billing — Trial Funnel Events
 *
 * Which `trial.*` log event, if any, a phase transition of a `TRIAL`
 * subscription is (Phase VII observability: "trial funnel events"). Pure: the
 * apply path passes the kind and the two phases and logs what comes back.
 * `trial.checkout_started` is emitted by the checkout command, not from here,
 * because it is not a transition.
 *
 *   -> TRIALING                       trial.started               authenticated; access from now
 *   TRIALING -> ACTIVE                trial.converted             the first charge succeeded
 *   TRIALING -> PAST_DUE              trial.first_charge_failed   the first charge failed (A7: presumed path)
 *   TRIALING -> CANCELLED             trial.cancelled             cancelled during the trial
 *   TRIALING -> anything else         trial.ended                 e.g. the IB-9 grace passed (also an anomaly)
 */
import type { SubscriptionKind, SubscriptionPhase } from "@/generated/prisma";

export type TrialFunnelEvent =
  | "trial.started"
  | "trial.converted"
  | "trial.first_charge_failed"
  | "trial.cancelled"
  | "trial.ended";

export function trialFunnelEvent(kind: SubscriptionKind, from: SubscriptionPhase, to: SubscriptionPhase): TrialFunnelEvent | null {
  if (kind !== "TRIAL" || from === to) return null;

  if (to === "TRIALING") return "trial.started";
  if (from !== "TRIALING") return null;

  switch (to) {
    case "ACTIVE":
      return "trial.converted";
    case "PAST_DUE":
      return "trial.first_charge_failed";
    case "CANCELLED":
      return "trial.cancelled";
    default:
      return "trial.ended";
  }
}
