/**
 * Billing — Settling Operations by Observation
 *
 * An operation whose outcome is unknown (a timeout, a 5xx, a crash after the
 * request left) is resolved by reading the provider, never by resending it
 * (SB-CM-03; docs/architecture/subscription/commands/operation-model.md). This
 * decides, for one applied observation, which of the subscription's
 * `OUTCOME_UNKNOWN` operations it proves or disproves:
 *
 *   UPDATE_PLAN              plan (or the pending scheduled plan) == requested -> SUCCEEDED, else NOT_APPLIED
 *   CANCEL_IMMEDIATELY       status cancelled                                  -> SUCCEEDED, else NOT_APPLIED
 *   CANCEL_SCHEDULED_CHANGE  no scheduled change                               -> SUCCEEDED, else NOT_APPLIED
 *   CANCEL_AT_CYCLE_END      status cancelled                                  -> SUCCEEDED; otherwise
 *                            left alone: a requested cycle-end cancel is not observable (A2)
 *   CREATE_SUBSCRIPTION      settled by binding, not here
 *   SUPERSEDE, CHANGE_PLAN   parents: settled through their children (Phase V/VI)
 *
 * Only an observation whose request was sent strictly **after** the operation's
 * request can settle it; an earlier read says nothing about a later change.
 *
 * The `request` JSON of an `UPDATE_PLAN` operation must match
 * `UpdatePlanRequestSchema`. Phase IV defines it because the apply path reads
 * it; Phase V's command runner writes it. A request that does not parse is
 * left unsettled (and the caller logs it), never guessed at.
 *
 * Pure.
 */
import { z } from "zod";

import type { BillingCycle, BillingOperationKind, BillingOperationStatus, MembershipPlan } from "@/generated/prisma";

export const UpdatePlanRequestSchema = z.object({
  plan: z.enum(["PRO", "PRO_PLUS"]),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
});

export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequestSchema>;

export interface SettleableOperation {
  readonly id: string;
  readonly kind: BillingOperationKind;
  readonly status: BillingOperationStatus;
  readonly requestSentAt: Date | null;
  readonly request: unknown;
}

export interface SettlementObservation {
  readonly observationAt: Date;
  readonly rawStatus: string;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly hasScheduledChanges: boolean;
  /** Kizunia's pending target after this observation, if any. */
  readonly scheduledPlan: MembershipPlan | null;
  readonly scheduledCycle: BillingCycle | null;
}

export type SettledStatus = "SUCCEEDED" | "NOT_APPLIED";

export type SettlementDecision =
  | { readonly operationId: string; readonly status: SettledStatus }
  | { readonly operationId: string; readonly status: "UNPARSEABLE_REQUEST" };

export function settleOperations(
  operations: readonly SettleableOperation[],
  observation: SettlementObservation,
): SettlementDecision[] {
  const decisions: SettlementDecision[] = [];

  for (const operation of operations) {
    if (operation.status !== "OUTCOME_UNKNOWN") continue;
    if (operation.requestSentAt === null) continue;
    if (operation.requestSentAt.getTime() >= observation.observationAt.getTime()) continue;

    const decision = decide(operation, observation);

    if (decision !== null) decisions.push(decision);
  }

  return decisions;
}

function decide(operation: SettleableOperation, observation: SettlementObservation): SettlementDecision | null {
  const cancelled = observation.rawStatus === "cancelled";
  const settled = (succeeded: boolean): SettlementDecision => ({
    operationId: operation.id,
    status: succeeded ? "SUCCEEDED" : "NOT_APPLIED",
  });

  switch (operation.kind) {
    case "UPDATE_PLAN": {
      const parsed = UpdatePlanRequestSchema.safeParse(operation.request);

      if (!parsed.success) return { operationId: operation.id, status: "UNPARSEABLE_REQUEST" };

      const { plan, cycle } = parsed.data;
      const current = observation.plan === plan && observation.cycle === cycle;
      const pending = observation.scheduledPlan === plan && observation.scheduledCycle === cycle;

      return settled(current || pending);
    }
    case "CANCEL_IMMEDIATELY":
      return settled(cancelled);
    case "CANCEL_SCHEDULED_CHANGE":
      return settled(!observation.hasScheduledChanges);
    case "CANCEL_AT_CYCLE_END":
      return cancelled ? settled(true) : null;
    default:
      return null;
  }
}
