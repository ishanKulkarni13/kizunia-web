/**
 * Billing — Scheduled Plan Changes
 *
 * What a subscription's pending `cycle_end` change looks like after an
 * observation (docs/architecture/subscription/implementation/synchronization.md).
 * Razorpay exposes only a flag, `has_scheduled_changes`, and (sometimes) when
 * it takes effect; never the target plan. Kizunia knows the target only when
 * its own operation scheduled it.
 *
 *   flag set, Kizunia has a target      keep the target (and refresh the time)
 *   flag set, no Kizunia target         flag only: a Dashboard-scheduled change,
 *                                       target unknown; access is unaffected until
 *                                       the new plan is actually observed
 *   observed plan == target             the change was applied: clear it
 *   flag cleared, plan != target        the change was cancelled: clear it
 *
 * Access never changes here. It changes only when the new plan itself is
 * observed, through the ordinary plan write.
 *
 * Pure.
 */
import type { BillingCycle, MembershipPlan } from "@/generated/prisma";

export interface ScheduledChangeState {
  readonly scheduledPlan: MembershipPlan | null;
  readonly scheduledCycle: BillingCycle | null;
  readonly scheduledProviderPlanId: string | null;
  readonly scheduledChangeAt: Date | null;
  readonly scheduledByOperationId: string | null;
}

export interface ScheduledChangeInput {
  readonly current: ScheduledChangeState;
  /** Whether the previous observation had the provider flag set. */
  readonly previouslyFlagged: boolean;
  readonly hasScheduledChanges: boolean;
  readonly changeScheduledAt: Date | null;
  readonly observedPlan: MembershipPlan;
  readonly observedCycle: BillingCycle;
}

/**
 * - `UNCHANGED`: nothing to record
 * - `FLAGGED`: a change with an unknown target appeared
 * - `APPLIED` / `CANCELLED`: a scheduled change is gone, and why
 */
export type ScheduledChangeTransition = "UNCHANGED" | "FLAGGED" | "APPLIED" | "CANCELLED";

export interface ScheduledChangeResult {
  readonly next: ScheduledChangeState;
  readonly transition: ScheduledChangeTransition;
}

const CLEARED: ScheduledChangeState = {
  scheduledPlan: null,
  scheduledCycle: null,
  scheduledProviderPlanId: null,
  scheduledChangeAt: null,
  scheduledByOperationId: null,
};

export function applyScheduledChange(input: ScheduledChangeInput): ScheduledChangeResult {
  const { current } = input;
  const hasTarget = current.scheduledPlan !== null && current.scheduledCycle !== null;
  const reachedTarget =
    hasTarget && input.observedPlan === current.scheduledPlan && input.observedCycle === current.scheduledCycle;

  if (reachedTarget) return { next: CLEARED, transition: "APPLIED" };

  if (input.hasScheduledChanges) {
    const next: ScheduledChangeState = {
      ...current,
      scheduledChangeAt: input.changeScheduledAt ?? current.scheduledChangeAt,
    };

    const newlyFlagged = !hasTarget && !input.previouslyFlagged;

    return { next, transition: newlyFlagged ? "FLAGGED" : "UNCHANGED" };
  }

  if (hasTarget || input.previouslyFlagged) return { next: CLEARED, transition: "CANCELLED" };

  return { next: CLEARED, transition: "UNCHANGED" };
}
