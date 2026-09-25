/**
 * Billing — ChangePlan (`CHANGE_PLAN` → `CANCEL_SCHEDULED_CHANGE`? → `UPDATE_PLAN`)
 *
 * A paid→paid plan change through Razorpay's native Update, only where the
 * one plan-change strategy says it can be (IB-21;
 * docs/architecture/subscription/lifecycle/upgrade-downgrade.md):
 *
 *   tx A        preconditions (policy/command-preconditions.ts): a paid subscription,
 *               no cycle-end cancel requested, a different plan, then the strategy:
 *                 NATIVE_UPDATE  upgrade `now` (ACTIVE, TRIALING), downgrade `cycle_end` (ACTIVE)
 *                 UNAVAILABLE    refused, and nothing is sent (the V1 limitation, SB-LC-07)
 *   [child]     a pending scheduled change is cancelled first, confirmed by sync (SB-LC-08)
 *   child       UPDATE_PLAN {plan, cycle, scheduleChangeAt}
 *     SUCCESS   the response through the apply path; a `cycle_end` change Razorpay shows
 *               pending is mirrored on the Subscription as Kizunia's target (Razorpay never
 *               names it), with its history
 *     REJECTED  Razorpay's refusal is authoritative: nothing changes, it is never retried or
 *               worked around, and it corrects the advisory (IB-26 item 7).
 *               "Another operation in progress" (CONCURRENT_OPERATION) only asks the
 *               customer to retry
 *     UNKNOWN   settled by the next sync (plan, or the pending change, equals the target)
 *   confirm     one targeted sync; the answer is what it shows
 *
 * Access changes only when the new plan itself is observed: an upgrade when
 * Razorpay reports the new plan (after it charged the prorated difference), a
 * downgrade when the checkpoint sync at the cycle end observes it applied.
 */
import type { BillingCycle, BillingOperation, MembershipPlan, Prisma, Subscription } from "@/generated/prisma";
import type { AppError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import { getPlanCatalog } from "../../config/plan-catalog";
import {
  BillingBusyError,
  BillingContactSupportError,
  BillingRequestRefusedError,
  CancellationRequestedError,
  NoSubscriptionError,
  PlanChangeUnavailableError,
  SamePlanError,
} from "../../errors";
import type { ClassifiedOutcome } from "../../policy/command-outcome";
import { evaluatePlanChangePreconditions, type PlanChangeDecision } from "../../policy/command-preconditions";
import type { UpdatePlanRequest } from "../../policy/operation-settlement";
import type { ScheduleChangeAt } from "../../policy/plan-change-strategy";
import type { ProviderSubscriptionState } from "../../provider/types";
import type { ChangePlanInput } from "../../schemas/lifecycle";
import { SubscriptionHistoryRepository } from "../history/history.repository";
import { applyObservationInTransaction } from "../sync/apply";
import { SyncClaimRepository } from "../sync/claim.repository";
import { errorForRejection, type BillingCommand, type CommandScope, type Preparation, type SettleContext } from "./command-runner";
import { notSent } from "./immediate-cancel";
import { BillingOperationRepository } from "./operation.repository";
import { loadOpenSubscriptions, openView, planPricesFor } from "./provisioning";
import { clearScheduledChange } from "./scheduled-change-step";

export type ChangePlanResult =
  /** Observed on the new plan: access follows it. */
  | { readonly status: "UPGRADED"; readonly operationId: string; readonly plan: MembershipPlan; readonly cycle: BillingCycle }
  /** Razorpay shows the change pending; it applies at `effectiveAt` (the cycle end). */
  | {
      readonly status: "SCHEDULED";
      readonly operationId: string | null;
      readonly plan: MembershipPlan;
      readonly cycle: BillingCycle;
      readonly effectiveAt: string | null;
    }
  /** Accepted, but a fetch shows neither the new plan nor a pending change (for example a failed proration charge). */
  | { readonly status: "NOT_CHANGED"; readonly operationId: string }
  /** Sent, not observed yet (or its outcome is unknown): poll `/me/billing`. */
  | { readonly status: "CONFIRMING"; readonly operationId: string }
  | { readonly status: "IN_PROGRESS"; readonly operationId: string };

type ChangePlanPlan = {
  readonly subscription: Subscription;
  readonly scheduleChangeAt: ScheduleChangeAt;
  readonly cancelScheduledFirst: boolean;
};

export class ChangePlanCommand implements BillingCommand<ChangePlanResult, ChangePlanPlan> {
  readonly kind = "CHANGE_PLAN" as const;
  readonly customerCommand = true;
  readonly request: Prisma.InputJsonValue;

  private readonly target: ChangePlanInput;

  constructor(input: ChangePlanInput) {
    this.target = { plan: input.plan, cycle: input.cycle };
    this.request = { plan: input.plan, cycle: input.cycle };
  }

  // -- Tx A -----------------------------------------------------------------

  async prepare(tx: Prisma.TransactionClient, scope: CommandScope, root: BillingOperation): Promise<Preparation<ChangePlanResult, ChangePlanPlan>> {
    const { decision, open } = await this.decide(tx, scope);

    switch (decision.kind) {
      case "ALREADY_SCHEDULED": {
        const row = open.find((candidate) => candidate.id === decision.subscription.id)!;

        return { kind: "RESPOND", result: this.scheduled(row.scheduledByOperationId, row) };
      }
      case "REFUSE":
        return { kind: "REFUSE", error: planChangeRefusalError(decision) };
      default: {
        const subscription = open.find((candidate) => candidate.id === decision.subscription.id)!;

        await BillingOperationRepository.linkSubscription(tx, root.id, subscription.id);

        return {
          kind: "PROCEED",
          plan: { subscription, scheduleChangeAt: decision.scheduleChangeAt, cancelScheduledFirst: decision.cancelScheduledFirst },
        };
      }
    }
  }

  // -- After tx A -----------------------------------------------------------

  async execute(scope: CommandScope, root: BillingOperation, plan: ChangePlanPlan): Promise<ChangePlanResult> {
    const { runner } = scope;
    const { subscription, scheduleChangeAt } = plan;

    if (plan.cancelScheduledFirst) {
      const cleared = await clearScheduledChange(scope, root, subscription);

      if (!cleared.cleared) {
        const failureClass = cleared.outcome.kind === "REJECTED" ? cleared.outcome.failureClass : null;
        const busy = failureClass ? errorForRejection(failureClass) : null;

        await this.close(scope, root, { status: "REJECTED", failureClass });

        if (busy || notSent(cleared.outcome)) throw busy ?? new BillingBusyError();

        return { status: "CONFIRMING", operationId: root.id };
      }
    }

    // The root still has a call to make: keep its slot (IB-25 item 4).
    const now = scope.now();

    if (!(await prisma.$transaction((tx) => BillingOperationRepository.renewLease(tx, root.id, runner.leaseUntil(now), now)))) {
      await this.close(scope, root, { status: plan.cancelScheduledFirst ? "SUCCEEDED" : "REJECTED", failureClass: null });

      return { status: "CONFIRMING", operationId: root.id };
    }

    const providerSubscriptionId = subscription.providerSubscriptionId!;
    const request = { ...this.target, scheduleChangeAt } satisfies UpdatePlanRequest;
    const { outcome } = await runner.runChild<ProviderSubscriptionState>(root, {
      kind: "UPDATE_PLAN",
      subscriptionId: subscription.id,
      request,
      call: (provider) => provider.updateSubscriptionPlan(providerSubscriptionId, { ...this.target, scheduleChangeAt }),
      settle: (tx, classified, context) => this.settleUpdate(tx, scope, subscription, scheduleChangeAt, classified, context),
    });

    await this.close(
      scope,
      root,
      outcome.kind === "SUCCESS"
        ? { status: "SUCCEEDED" }
        : { status: "REJECTED", failureClass: outcome.kind === "REJECTED" ? outcome.failureClass : null },
    );

    switch (outcome.kind) {
      case "SUCCESS": {
        const { subscription: observed } = await runner.confirmBySync(subscription.id);
        const row = observed ?? (await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }));

        return this.fromState(root.id, row, observed !== null);
      }
      case "OUTCOME_UNKNOWN":
        return { status: "CONFIRMING", operationId: root.id };
      case "REJECTED":
        throw errorForRejection(outcome.failureClass) ?? (notSent(outcome) ? new BillingBusyError() : new PlanChangeUnavailableError("PROVIDER_REFUSED"));
      default:
        throw new BillingBusyError();
    }
  }

  /**
   * Tx B of the update. A `cycle_end` change Razorpay shows pending is written
   * as Kizunia's target **before** the response is applied, so the apply path
   * keeps it (rather than recording a change with an unknown target), with a
   * history entry of its own. A business refusal corrects the advisory.
   */
  private async settleUpdate(
    tx: Prisma.TransactionClient,
    scope: CommandScope,
    subscription: Subscription,
    scheduleChangeAt: ScheduleChangeAt,
    classified: ClassifiedOutcome<ProviderSubscriptionState>,
    { operation, effects, now }: SettleContext,
  ): Promise<void> {
    const { runner, mode } = scope;
    const log = { subscriptionId: subscription.id, userId: subscription.userId, mode, operationId: operation.id };

    await SyncClaimRepository.markDue(tx, subscription.id, "COMMAND_CONFIRM", now, { eventDriven: false, now });

    if (classified.kind === "REJECTED" && classified.failureClass === "REJECTED") {
      // Authoritative (SB-LC-07): the UI stops offering what Razorpay refuses.
      await tx.subscription.update({ where: { id: subscription.id }, data: { advisoryInternationalCard: false } });
      effects.events.push({ event: "plan_change.refused", fields: { ...log, providerErrorCode: classified.providerErrorCode } });

      return;
    }

    if (classified.kind !== "SUCCESS") return;

    if (scheduleChangeAt === "CYCLE_END" && classified.value.hasScheduledChanges) {
      const catalog = runner.catalog ?? getPlanCatalog(mode);
      const row = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } });

      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          scheduledPlan: this.target.plan,
          scheduledCycle: this.target.cycle,
          scheduledProviderPlanId: catalog.currentProviderPlanId(this.target.plan, this.target.cycle) ?? null,
          scheduledChangeAt: classified.value.changeScheduledAt ?? classified.value.currentEnd ?? row.currentPeriodEnd,
          scheduledByOperationId: operation.id,
        },
      });
      await SubscriptionHistoryRepository.record(tx, [
        {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          change: "SCHEDULED_CHANGE",
          fromValue: row.scheduledPlan && row.scheduledCycle ? `${row.scheduledPlan}/${row.scheduledCycle}` : null,
          toValue: `${this.target.plan}/${this.target.cycle}`,
          cause: "KIZUNIA_COMMAND",
          trigger: "COMMAND_RESPONSE",
          operationId: operation.id,
          observationAt: classified.requestSentAt,
        },
      ]);
    }

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
    effects.events.push({ event: "plan_change.accepted", fields: { ...log, plan: this.target.plan, cycle: this.target.cycle, scheduleChangeAt } });
  }

  // -- Replays --------------------------------------------------------------

  inProgress(root: BillingOperation): ChangePlanResult {
    return { status: root.status === "OUTCOME_UNKNOWN" ? "CONFIRMING" : "IN_PROGRESS", operationId: root.id };
  }

  async replay(scope: CommandScope, root: BillingOperation): Promise<ChangePlanResult> {
    const children = await BillingOperationRepository.children(root.id);
    const update = children.find((child) => child.kind === "UPDATE_PLAN");

    if (update) {
      switch (update.status) {
        case "SUCCEEDED": {
          const row = await prisma.subscription.findUniqueOrThrow({ where: { id: update.subscriptionId! } });

          return this.fromState(root.id, row, true);
        }
        case "REJECTED":
          throw errorForRejection(update.failureClass) ?? new PlanChangeUnavailableError("PROVIDER_REFUSED");
        case "NOT_APPLIED":
          return { status: "NOT_CHANGED", operationId: root.id };
        default:
          return { status: "CONFIRMING", operationId: root.id };
      }
    }

    if (root.status === "REJECTED" && root.failureClass !== null) throw errorForRejection(root.failureClass) ?? new BillingBusyError();
    if (children.length > 0) return { status: "CONFIRMING", operationId: root.id };

    // A local refusal: explained from current state, never re-executed (IB-25 item 3).
    const { decision } = await this.decide(prisma, scope);

    throw decision.kind === "REFUSE" ? planChangeRefusalError(decision) : new BillingRequestRefusedError();
  }

  // -- Internals ------------------------------------------------------------

  private async decide(tx: Prisma.TransactionClient, scope: CommandScope) {
    const open = await loadOpenSubscriptions(tx, scope.actor.userId, scope.mode);
    const catalog = scope.runner.catalog ?? getPlanCatalog(scope.mode);
    const decision = evaluatePlanChangePreconditions({
      open: open.map(openView),
      // The runner refused an open anomaly before tx A reached here.
      hasOpenAnomaly: false,
      target: this.target,
      prices: planPricesFor(catalog, open.length === 1 ? open[0] : undefined),
    });

    return { decision, open };
  }

  /** The answer from local state: the new plan, the pending change, or neither. */
  private fromState(operationId: string, row: Subscription, observed: boolean): ChangePlanResult {
    const { plan, cycle } = this.target;

    if (row.plan === plan && row.cycle === cycle) return { status: "UPGRADED", operationId, plan, cycle };
    if (row.scheduledPlan === plan && row.scheduledCycle === cycle) return this.scheduled(operationId, row);

    return observed ? { status: "NOT_CHANGED", operationId } : { status: "CONFIRMING", operationId };
  }

  private scheduled(operationId: string | null, row: Subscription): ChangePlanResult {
    return {
      status: "SCHEDULED",
      operationId,
      plan: this.target.plan,
      cycle: this.target.cycle,
      effectiveAt: (row.scheduledChangeAt ?? row.currentPeriodEnd)?.toISOString() ?? null,
    };
  }

  private async close(
    scope: CommandScope,
    root: BillingOperation,
    outcome: Parameters<typeof BillingOperationRepository.closeParent>[2],
  ): Promise<void> {
    const now = scope.now();

    await prisma.$transaction((tx) => BillingOperationRepository.closeParent(tx, root.id, outcome, now));
  }
}

export function planChangeRefusalError(decision: Extract<PlanChangeDecision, { kind: "REFUSE" }>): AppError {
  switch (decision.reason) {
    case "CONTACT_SUPPORT":
      return new BillingContactSupportError();
    case "CANCELLATION_REQUESTED":
      return new CancellationRequestedError();
    case "SAME_PLAN":
      return new SamePlanError();
    case "UNAVAILABLE":
      return new PlanChangeUnavailableError(decision.unavailable ?? "SUBSCRIPTION_STATE");
    default:
      return new NoSubscriptionError();
  }
}
