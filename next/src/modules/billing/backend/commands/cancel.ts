/**
 * Billing — Cancel (customer)
 *
 * The customer's cancellation, with the timing each phase requires
 * (docs/architecture/subscription/lifecycle/cancellation.md; IB-1):
 *
 *   ACTIVE                  CANCEL_AT_CYCLE_END   access continues to current_end; no undo (SB-LC-09)
 *                                                 [a pending scheduled change is cancelled first,
 *                                                  as a child confirmed by sync (SB-LC-08)]
 *   TRIALING, PAST_DUE      CANCEL_IMMEDIATELY    ends when the cancellation is observed
 *   HALTED, PAUSED          CANCEL_IMMEDIATELY    never cycle-end (a silent no-op there, I-2)
 *   PENDING_AUTHENTICATION  CANCEL_IMMEDIATELY    abandons the checkout
 *   none, terminal          refused
 *
 * The customer confirms the timing they were shown; the root's kind is that
 * timing, and tx A refuses the request if the phase now needs another one
 * (IB-26 item 2). Nothing is claimed that Razorpay has not shown:
 *
 *   - an immediate cancel answers `CANCELLED` only when a fetch after the call
 *     observes it; otherwise `CONFIRMING`, settled by the next sync;
 *   - a cycle-end cancel's `200` is never evidence (I-1, A2): it sets
 *     `cancelAtPeriodEnd` as Kizunia's *request* ("cancellation requested"),
 *     with the period end it was sent in (IB-26 item 3), and the apply path
 *     watches it for a contradiction (I-4). Its response showing a phase other
 *     than ACTIVE means it was a no-op: the flag is not set, the anomaly is
 *     raised, and the customer is asked to review the new timing.
 *
 * An unknown cycle-end outcome may be re-issued once the resolution window
 * has passed: a repeat is harmless (A14).
 */
import type { BillingOperation, Prisma, Subscription } from "@/generated/prisma";
import type { AppError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import {
  BillingBusyError,
  BillingContactSupportError,
  BillingRequestRefusedError,
  CancellationFailedError,
  CancellationTimingChangedError,
  CheckoutInProgressError,
  NoSubscriptionError,
} from "../../errors";
import type { ClassifiedOutcome } from "../../policy/command-outcome";
import {
  evaluateCancelPreconditions,
  requiredCancelTiming,
  type CancelDecision,
  type CancelTiming,
} from "../../policy/command-preconditions";
import type { CancelAtCycleEndRequest } from "../../policy/operation-settlement";
import { isTerminalPhase } from "../../policy/state-mapping";
import type { ProviderSubscriptionState } from "../../provider/types";
import type { CancelImmediatelyRequest } from "../../schemas/lifecycle";
import { SubscriptionHistoryRepository } from "../history/history.repository";
import { applyObservationInTransaction, raiseCancellationNotEffective } from "../sync/apply";
import { SyncClaimRepository } from "../sync/claim.repository";
import { errorForRejection, type BillingCommand, type CommandScope, type Preparation, type SettleContext } from "./command-runner";
import { cancelImmediately, notSent } from "./immediate-cancel";
import { BillingOperationRepository } from "./operation.repository";
import { loadOpenSubscriptions, openView } from "./provisioning";
import { clearScheduledChange } from "./scheduled-change-step";

export type CancelResult =
  /** A cycle-end cancellation is requested (never "confirmed": A2). Access continues to `endsAt`. */
  | { readonly status: "CANCELLATION_REQUESTED"; readonly operationId: string | null; readonly endsAt: string | null }
  /** Observed cancelled: access has ended. */
  | { readonly status: "CANCELLED"; readonly operationId: string }
  /** Sent, but not observed yet (or its outcome is unknown): poll `/me/billing`. */
  | { readonly status: "CONFIRMING"; readonly operationId: string }
  /** Still being processed (a same-key retry while the first request runs). */
  | { readonly status: "IN_PROGRESS"; readonly operationId: string }
  /** A cycle-end request Kizunia later observed not to take effect: the subscription continues (I-4). */
  | { readonly status: "NOT_EFFECTIVE"; readonly operationId: string };

type CancelPlan = { readonly subscription: Subscription; readonly decision: Extract<CancelDecision, { kind: "CANCEL_AT_CYCLE_END" | "CANCEL_IMMEDIATELY" }> };

export class CancelSubscriptionCommand implements BillingCommand<CancelResult, CancelPlan> {
  readonly kind: "CANCEL_AT_CYCLE_END" | "CANCEL_IMMEDIATELY";
  readonly customerCommand = true;
  readonly request: Prisma.InputJsonValue;

  constructor(private readonly timing: CancelTiming) {
    this.kind = timing === "CYCLE_END" ? "CANCEL_AT_CYCLE_END" : "CANCEL_IMMEDIATELY";
    // A cycle-end request's period end is completed in tx A, from the row it is sent for.
    this.request =
      timing === "CYCLE_END"
        ? ({ atCycleEnd: true, periodEnd: null } satisfies CancelAtCycleEndRequest)
        : ({ atCycleEnd: false, reason: "CUSTOMER_CANCEL" } satisfies CancelImmediatelyRequest);
  }

  // -- Tx A -----------------------------------------------------------------

  async prepare(tx: Prisma.TransactionClient, scope: CommandScope, root: BillingOperation): Promise<Preparation<CancelResult, CancelPlan>> {
    const open = await loadOpenSubscriptions(tx, scope.actor.userId, scope.mode);
    // The runner refused an open anomaly before tx A reached here.
    const decision = evaluateCancelPreconditions({ open: open.map(openView), hasOpenAnomaly: false, acknowledged: this.timing });

    switch (decision.kind) {
      case "ALREADY_REQUESTED": {
        const row = open.find((candidate) => candidate.id === decision.subscription.id)!;

        return { kind: "RESPOND", result: requested(row.cancelRequestedByOperationId, row) };
      }
      case "REFUSE":
        return { kind: "REFUSE", error: cancelRefusalError(decision) };
      default: {
        const subscription = open.find((candidate) => candidate.id === decision.subscription.id)!;

        await BillingOperationRepository.linkSubscription(tx, root.id, subscription.id);

        if (decision.kind === "CANCEL_AT_CYCLE_END") {
          await BillingOperationRepository.completeRequest(tx, root.id, {
            atCycleEnd: true,
            periodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          } satisfies CancelAtCycleEndRequest);
        }

        return { kind: "PROCEED", plan: { subscription, decision } };
      }
    }
  }

  // -- After tx A -----------------------------------------------------------

  async execute(scope: CommandScope, root: BillingOperation, plan: CancelPlan): Promise<CancelResult> {
    return plan.decision.kind === "CANCEL_IMMEDIATELY"
      ? this.immediately(scope, root, plan.subscription)
      : this.atCycleEnd(scope, root, plan.subscription, plan.decision.cancelScheduledFirst);
  }

  private async immediately(scope: CommandScope, root: BillingOperation, subscription: Subscription): Promise<CancelResult> {
    const { outcome, confirmed } = await cancelImmediately(scope, { root }, subscription);

    if (confirmed) return { status: "CANCELLED", operationId: root.id };

    switch (outcome.kind) {
      case "REJECTED":
        throw errorForRejection(outcome.failureClass) ?? (notSent(outcome) ? new BillingBusyError() : new CancellationFailedError());
      default:
        return { status: "CONFIRMING", operationId: root.id };
    }
  }

  private async atCycleEnd(
    scope: CommandScope,
    root: BillingOperation,
    subscription: Subscription,
    cancelScheduledFirst: boolean,
  ): Promise<CancelResult> {
    const { runner } = scope;
    const providerSubscriptionId = subscription.providerSubscriptionId!;

    if (cancelScheduledFirst) {
      const cleared = await clearScheduledChange(scope, root, subscription);
      const busy = cleared.outcome.kind === "REJECTED" ? errorForRejection(cleared.outcome.failureClass) : null;

      if (!cleared.cleared) {
        await closeUnsent(scope, root, cleared.outcome.kind === "REJECTED" ? cleared.outcome.failureClass : null);

        if (busy || notSent(cleared.outcome)) throw busy ?? new BillingBusyError();

        return { status: "CONFIRMING", operationId: root.id };
      }

      // The root still has its own call to make: keep its slot (IB-25 item 4).
      const now = scope.now();
      const renewed = await prisma.$transaction((tx) => BillingOperationRepository.renewLease(tx, root.id, runner.leaseUntil(now), now));

      if (!renewed) {
        await closeUnsent(scope, root, null);

        return { status: "CONFIRMING", operationId: root.id };
      }
    }

    const outcome = await runner.mutate<ProviderSubscriptionState>(root, {
      call: (provider) => provider.cancelSubscription(providerSubscriptionId, { atCycleEnd: true }),
      settle: (tx, classified, context) => this.settleCycleEnd(tx, scope, subscription, classified, context),
    });

    switch (outcome.kind) {
      case "SUCCESS": {
        const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });

        if (row.cancelAtPeriodEnd && row.cancelRequestedByOperationId === root.id) return requested(root.id, row);

        // Sent outside ACTIVE after all (the phase moved since tx A): a no-op by I-2.
        const timing = requiredCancelTiming(row.phase);

        if (timing !== null && timing !== "CYCLE_END") throw new CancellationTimingChangedError(timing);
        if (isTerminalPhase(row.phase)) return { status: "CANCELLED", operationId: root.id };

        throw new CancellationFailedError();
      }
      case "OUTCOME_UNKNOWN":
        return { status: "CONFIRMING", operationId: root.id };
      default:
        throw errorForRejection(outcome.kind === "REJECTED" ? outcome.failureClass : null) ?? new CancellationFailedError();
    }
  }

  /**
   * Tx B of a cycle-end cancel: the response through the apply path, then
   * Kizunia's own record of the request, only while the subscription is still
   * ACTIVE. The row is marked due whatever the answer.
   */
  private async settleCycleEnd(
    tx: Prisma.TransactionClient,
    scope: CommandScope,
    subscription: Subscription,
    classified: ClassifiedOutcome<ProviderSubscriptionState>,
    { operation, effects, now }: SettleContext,
  ): Promise<void> {
    const { runner, mode } = scope;

    await SyncClaimRepository.markDue(tx, subscription.id, "COMMAND_CONFIRM", now, { eventDriven: false, now });

    if (classified.kind !== "SUCCESS") return;

    await applyObservationInTransaction(
      tx,
      subscription.id,
      { state: classified.value, observationAt: classified.requestSentAt },
      {
        resolvedMode: mode,
        trigger: "COMMAND_RESPONSE",
        commandOperationId: operation.id,
        now,
        catalog: runner.catalog,
        schedule: runner.schedule,
      },
      effects,
    );

    const row = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    const log = { subscriptionId: row.id, userId: row.userId, mode, operationId: operation.id };

    if (row.phase !== "ACTIVE") {
      if (!isTerminalPhase(row.phase)) {
        await raiseCancellationNotEffective(
          tx,
          row,
          "SENT_OUTSIDE_ACTIVE",
          { observedPhase: row.phase, observationAt: classified.requestSentAt },
          now,
          effects,
          log,
        );
      }

      return;
    }

    if (row.cancelAtPeriodEnd) return; // requested already (a racing request of this user cannot exist: one slot)

    await tx.subscription.update({
      where: { id: row.id },
      data: { cancelAtPeriodEnd: true, cancelRequestedAt: classified.requestSentAt, cancelRequestedByOperationId: operation.id },
    });
    await SubscriptionHistoryRepository.record(tx, [
      {
        subscriptionId: row.id,
        userId: row.userId,
        change: "CANCEL_AT_PERIOD_END",
        fromValue: "false",
        toValue: "true",
        cause: "KIZUNIA_COMMAND",
        trigger: "COMMAND_RESPONSE",
        operationId: operation.id,
        observationAt: classified.requestSentAt,
      },
    ]);
    effects.events.push({ event: "cancel.requested", fields: { ...log, endsAt: row.currentPeriodEnd } });
  }

  // -- Replays --------------------------------------------------------------

  inProgress(root: BillingOperation): CancelResult {
    return { status: root.status === "OUTCOME_UNKNOWN" ? "CONFIRMING" : "IN_PROGRESS", operationId: root.id };
  }

  async replay(scope: CommandScope, root: BillingOperation): Promise<CancelResult> {
    const row = root.subscriptionId ? await prisma.subscription.findUnique({ where: { id: root.subscriptionId } }) : null;

    if (root.status === "SUCCEEDED" && row) {
      if (isTerminalPhase(row.phase)) return { status: "CANCELLED", operationId: root.id };
      if (root.kind === "CANCEL_IMMEDIATELY") return { status: "CONFIRMING", operationId: root.id };
      if (row.cancelAtPeriodEnd && row.cancelRequestedByOperationId === root.id) return requested(root.id, row);

      return { status: "NOT_EFFECTIVE", operationId: root.id };
    }

    if (root.status === "NOT_APPLIED") throw new CancellationFailedError();

    // REJECTED.
    if (root.failureClass !== null) throw errorForRejection(root.failureClass) ?? new CancellationFailedError();

    if ((await BillingOperationRepository.children(root.id)).length > 0) return { status: "CONFIRMING", operationId: root.id };

    // A local refusal: explained from current state, never re-executed (IB-25 item 3).
    const open = await loadOpenSubscriptions(prisma, scope.actor.userId, scope.mode);
    const decision = evaluateCancelPreconditions({ open: open.map(openView), hasOpenAnomaly: false, acknowledged: this.timing });

    throw decision.kind === "REFUSE" ? cancelRefusalError(decision) : new BillingRequestRefusedError();
  }
}

function requested(operationId: string | null, row: Pick<Subscription, "currentPeriodEnd">): CancelResult {
  return { status: "CANCELLATION_REQUESTED", operationId, endsAt: row.currentPeriodEnd?.toISOString() ?? null };
}

async function closeUnsent(scope: CommandScope, root: BillingOperation, failureClass: BillingOperation["failureClass"]): Promise<void> {
  const now = scope.now();

  await prisma.$transaction((tx) => BillingOperationRepository.closeUnsent(tx, root.id, failureClass, now));
}

export function cancelRefusalError(decision: Extract<CancelDecision, { kind: "REFUSE" }>): AppError {
  switch (decision.reason) {
    case "CONTACT_SUPPORT":
      return new BillingContactSupportError();
    case "CHECKOUT_IN_PROGRESS":
      return new CheckoutInProgressError();
    case "TIMING_CHANGED":
      return new CancellationTimingChangedError(decision.requiredTiming ?? "IMMEDIATE");
    default:
      return new NoSubscriptionError();
  }
}
