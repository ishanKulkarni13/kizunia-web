/**
 * Billing — Admin Immediate Cancel (`CANCEL_IMMEDIATELY`, actor ADMIN)
 *
 * A support action (SB-LC-05; lifecycle/cancellation.md): cancel one
 * customer's subscription now, with a recorded reason. Used for support
 * cases and for resolving a multiple-subscriptions anomaly
 * (multiple-subscriptions.md).
 *
 *   authorize      MANAGE_BILLING (SUPER_ADMIN; IB-15), here in the service, so no
 *                  caller reaches the command around the HTTP layer
 *   the runner     the SAME per-user slot as the customer's commands (IB-6 item 3):
 *                  a customer operation in flight -> 409; an Idempotency-Key, keyed on
 *                  the customer (IB-26 item 9); not a customer command, so an open
 *                  multiple-subscriptions anomaly does not block it (SB-UQ-05)
 *   preconditions  any open, bound phase of the current mode; PROVISIONING and
 *                  terminal subscriptions are refused
 *   the call       the one immediate-cancel step, confirmed by sync
 *
 * Refunds, if any, are issued in the Razorpay Dashboard; Kizunia never
 * computes or issues one (V1). The answer carries no provider identifier.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { BillingOperation, Prisma, Subscription, SubscriptionPhase } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { BillingBusyError, CancellationFailedError, SubscriptionNotCancellableError, SubscriptionNotFoundError } from "../../errors";
import { isOpenPhase } from "../../policy/state-mapping";
import type { AdminCancelInput, CancelImmediatelyRequest } from "../../schemas/lifecycle";
import { BillingAuthorizer } from "../authorization/authorizer";
import { CommandRunner, errorForRejection, type BillingCommand, type CommandScope, type Preparation } from "./command-runner";
import { cancelImmediately, notSent } from "./immediate-cancel";
import { BillingOperationRepository } from "./operation.repository";

export interface AdminCancelResult {
  /** `CANCELLED` when a fetch observed it; `CONFIRMING` when not yet; `IN_PROGRESS` on a same-key retry mid-flight. */
  readonly status: "CANCELLED" | "CONFIRMING" | "IN_PROGRESS";
  readonly operationId: string;
  readonly subscriptionId: string;
  /** The phase as local state shows it after the command. */
  readonly phase: SubscriptionPhase | null;
}

export class AdminCancelCommand implements BillingCommand<AdminCancelResult, Subscription> {
  readonly kind = "CANCEL_IMMEDIATELY" as const;
  readonly customerCommand = false;
  readonly request: Prisma.InputJsonValue;

  constructor(
    private readonly subscriptionId: string,
    reason: string,
  ) {
    this.request = { atCycleEnd: false, reason: "ADMIN_CANCEL", note: reason } satisfies CancelImmediatelyRequest;
  }

  async prepare(tx: Prisma.TransactionClient, scope: CommandScope, root: BillingOperation): Promise<Preparation<AdminCancelResult, Subscription>> {
    const row = await tx.subscription.findUnique({ where: { id: this.subscriptionId } });

    if (!row || row.userId !== scope.actor.userId || row.providerMode !== scope.mode) {
      return { kind: "REFUSE", error: new SubscriptionNotFoundError() };
    }

    if (!isOpenPhase(row.phase) || row.phase === "PROVISIONING" || row.providerSubscriptionId === null) {
      return { kind: "REFUSE", error: new SubscriptionNotCancellableError() };
    }

    await BillingOperationRepository.linkSubscription(tx, root.id, row.id);

    return { kind: "PROCEED", plan: row };
  }

  async execute(scope: CommandScope, root: BillingOperation, subscription: Subscription): Promise<AdminCancelResult> {
    const { outcome, confirmed, observedPhase } = await cancelImmediately(scope, { root }, subscription);

    if (confirmed) return this.result(root, "CANCELLED", observedPhase);

    if (outcome.kind === "REJECTED") {
      throw errorForRejection(outcome.failureClass) ?? (notSent(outcome) ? new BillingBusyError() : new CancellationFailedError());
    }

    return this.result(root, "CONFIRMING", await this.phaseNow());
  }

  inProgress(root: BillingOperation): AdminCancelResult {
    return { status: root.status === "OUTCOME_UNKNOWN" ? "CONFIRMING" : "IN_PROGRESS", operationId: root.id, subscriptionId: this.subscriptionId, phase: null };
  }

  async replay(_scope: CommandScope, root: BillingOperation): Promise<AdminCancelResult> {
    if (root.status === "REJECTED" && root.failureClass === null) {
      // A local refusal: explained from current state, never re-executed (IB-25 item 3).
      throw (await prisma.subscription.findUnique({ where: { id: this.subscriptionId } }))
        ? new SubscriptionNotCancellableError()
        : new SubscriptionNotFoundError();
    }

    if (root.status === "REJECTED") throw errorForRejection(root.failureClass) ?? new CancellationFailedError();
    if (root.status === "NOT_APPLIED") throw new CancellationFailedError();

    const phase = await this.phaseNow();

    return this.result(root, phase === "CANCELLED" ? "CANCELLED" : "CONFIRMING", phase);
  }

  private result(root: BillingOperation, status: AdminCancelResult["status"], phase: SubscriptionPhase | null): AdminCancelResult {
    return { status, operationId: root.id, subscriptionId: this.subscriptionId, phase };
  }

  private async phaseNow(): Promise<SubscriptionPhase | null> {
    return (await prisma.subscription.findUnique({ where: { id: this.subscriptionId }, select: { phase: true } }))?.phase ?? null;
  }
}

export class AdminCancelService {
  constructor(private readonly runner: CommandRunner = new CommandRunner()) {}

  async cancel(
    actor: StrictAuthorizationActor,
    subscriptionId: string,
    input: AdminCancelInput,
    idempotencyKey: string,
  ): Promise<AdminCancelResult> {
    BillingAuthorizer.manageBilling(await PlatformContextResolver.resolve(actor));

    // The customer whose slot the command takes; the rest is re-checked in tx A.
    const row = await prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { userId: true } });

    if (!row) throw new SubscriptionNotFoundError();
    if (row.userId === null) throw new SubscriptionNotCancellableError();

    return this.runner.run(new AdminCancelCommand(subscriptionId, input.reason), {
      actor: { userId: row.userId, actorKind: "ADMIN", actorUserId: actor.id },
      idempotencyKey,
    });
  }
}
