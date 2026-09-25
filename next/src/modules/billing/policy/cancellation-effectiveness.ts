/**
 * Billing — Is a Requested Cycle-End Cancellation Still Believable?
 *
 * Invariant I-4 (docs/architecture/subscription/implementation/past-due-cancellation.md,
 * IB-1): while `cancelAtPeriodEnd` is set, every applied observation is
 * checked for a contradiction. A cycle-end cancel's `200` is never evidence
 * (I-1, A2), so these are the only ways Kizunia learns that its request did
 * not take:
 *
 *   (i)   still active/pending after the requested period end + margin   PERIOD_PASSED
 *   (ii)  a CHARGE dated after the cancel request was sent              CHARGED_AFTER_REQUEST
 *   (iii) HALTED while the flag is set (a state, IB-26 item 3)          HALTED
 *
 * Any of them means the customer is still being billed, or can be again. The
 * caller clears the flag (I-3) and raises `CANCELLATION_NOT_EFFECTIVE`, which
 * alerts and tells the customer they are still subscribed. An observed
 * CANCELLED is the flag's other exit and is never a contradiction.
 *
 * Pure.
 */
import type { SubscriptionPhase } from "@/generated/prisma";

export type CancellationContradiction = "PERIOD_PASSED" | "CHARGED_AFTER_REQUEST" | "HALTED";

export interface CancellationEffectivenessInput {
  readonly cancelAtPeriodEnd: boolean;
  /** The phase this observation maps to. */
  readonly observedPhase: SubscriptionPhase;
  /** When the observation's request was sent: "now" as far as the provider is concerned. */
  readonly observationAt: Date;
  /** The period end in force when the cancel was sent (from its operation's request), if known. */
  readonly requestedPeriodEnd: Date | null;
  /** The checkpoint margin (C3): the current_end checkpoint sync is the observation that decides. */
  readonly marginSeconds: number;
  /** When the cancel request was sent. */
  readonly cancelRequestedAt: Date | null;
  /** The newest CHARGE money fact's time for this subscription, if any. */
  readonly latestChargeAt: Date | null;
}

/** Phases in which a subscription can still bill: the provider's `active` and `pending`. */
const STILL_BILLING: ReadonlySet<SubscriptionPhase> = new Set(["ACTIVE", "PAST_DUE"]);

export function detectCancellationNotEffective(input: CancellationEffectivenessInput): CancellationContradiction | null {
  if (!input.cancelAtPeriodEnd || input.observedPhase === "CANCELLED") return null;

  if (input.observedPhase === "HALTED") return "HALTED";

  if (
    input.cancelRequestedAt !== null &&
    input.latestChargeAt !== null &&
    input.latestChargeAt.getTime() > input.cancelRequestedAt.getTime()
  ) {
    return "CHARGED_AFTER_REQUEST";
  }

  if (
    input.requestedPeriodEnd !== null &&
    STILL_BILLING.has(input.observedPhase) &&
    input.observationAt.getTime() > input.requestedPeriodEnd.getTime() + input.marginSeconds * 1000
  ) {
    return "PERIOD_PASSED";
  }

  return null;
}
