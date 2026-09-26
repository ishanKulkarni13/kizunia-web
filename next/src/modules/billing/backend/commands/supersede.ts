/**
 * Billing — Supersede (`SUPERSEDE` → `CANCEL_IMMEDIATELY` → confirm → `CREATE_SUBSCRIPTION`)
 *
 * A user whose subscription is `HALTED` or `PAUSED` starts a new one only by
 * explicitly confirming that the old one is cancelled permanently (SB-UQ-04;
 * docs/architecture/subscription/lifecycle/multiple-subscriptions.md#supersession).
 * The checkout request carries `supersedesSubscriptionId` and
 * `confirmSupersession: true`, and opens a `SUPERSEDE` root holding the user's
 * one slot; its steps are children (IB-6, IB-26 items 4 and 5):
 *
 *   tx A        the one checkout precondition, with the supersession:
 *                 the named subscription is open and on hold -> cancel, then create
 *                 none open, the named one observed CANCELLED
 *                   and not superseded yet                   -> link + create (continuation)
 *                 anything else                              -> SUPERSESSION_NOT_APPLICABLE
 *   re-check    one targeted sync: a subscription that recovered on its own is
 *               never cancelled
 *   cancel      child CANCEL_IMMEDIATELY (never the cycle-end form: a no-op on these
 *               states, D2), then a targeted sync that must OBSERVE `cancelled`
 *                 refused      -> nothing else happens; the user is sent to recovery
 *                 unknown / not visible yet -> CONFIRMING; no create in this request.
 *                                 The next request re-evaluates from local state
 *                                 (no background continuation, SB-RC-10)
 *   tx A2       old.supersededById = new PROVISIONING record, history SUPERSESSION
 *   create      child CREATE_SUBSCRIPTION through the shared create step
 *
 * The checkout may also ask for a trial or carry an Offer code (Phase VII): the
 * same acquisition rules are evaluated in the same precondition step, before
 * anything is cancelled, so a refused code or an ineligible trial can never
 * strand a customer who had already agreed to replace their subscription.
 *
 * Kizunia never creates before the old subscription is observed cancelled,
 * so the one-open-subscription invariant holds throughout. If the new
 * checkout is never completed, the old one stays cancelled: that is what the
 * user confirmed, and they are Free until a new checkout completes.
 */
import type { BillingOperation, Prisma, Subscription } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { CHECKOUT_CONFIG } from "../../config/billing-config";
import {
  BillingBusyError,
  BillingRequestRefusedError,
  SupersessionCancelRefusedError,
  SupersessionNotApplicableError,
} from "../../errors";
import type { ClassifiedOutcome } from "../../policy/command-outcome";
import {
  evaluateCheckoutPreconditions,
  isSupersedable,
  type CheckoutDecision,
  type CheckoutIntent,
} from "../../policy/command-preconditions";
import type { ProviderSubscriptionState } from "../../provider/types";
import { CreateSubscriptionRequestSchema, type StartCheckoutInput } from "../../schemas/checkout";
import type { CancelImmediatelyRequest } from "../../schemas/lifecycle";
import { SubscriptionHistoryRepository } from "../history/history.repository";
import { Acquisition, type AcquisitionRequest } from "./acquisition";
import { errorForRejection, type BillingCommand, type CommandScope, type Preparation } from "./command-runner";
import { CheckoutCreate, type StartCheckoutResult } from "./create-subscription-step";
import { cancelImmediately, notSent } from "./immediate-cancel";
import { BillingOperationRepository } from "./operation.repository";
import { createProvisioning, loadOpenSubscriptions, openView } from "./provisioning";
import { checkoutRefusalError, replayCreated, type StartCheckoutDeps } from "./start-checkout";

type SupersedePlan =
  | { readonly kind: "CANCEL_THEN_CREATE"; readonly old: Subscription }
  /** The old one is already observed cancelled: tx A provisioned and linked the new record, and recorded its create. */
  | { readonly kind: "CREATE"; readonly provisioned: Provisioned };

/** A new `PROVISIONING` record and the `CREATE_SUBSCRIPTION` child written with it. */
interface Provisioned {
  readonly subscriptionId: string;
  readonly child: BillingOperation;
}

type SupersedeInput = Pick<StartCheckoutInput, "plan" | "cycle"> & AcquisitionRequest & { readonly supersedesSubscriptionId: string };

export class SupersedeCommand implements BillingCommand<StartCheckoutResult, SupersedePlan> {
  readonly kind = "SUPERSEDE" as const;
  readonly customerCommand = true;
  readonly request: Prisma.InputJsonValue;

  private readonly intent: CheckoutIntent;
  private readonly acquisition: Acquisition;
  private readonly supersedesSubscriptionId: string;
  private readonly creator: CheckoutCreate;
  private readonly createRequest: Prisma.InputJsonValue;
  private readonly reuseMinRemainingSeconds: number;

  constructor(input: SupersedeInput, private readonly deps: StartCheckoutDeps = {}) {
    this.intent = { plan: input.plan, cycle: input.cycle };
    this.acquisition = new Acquisition(input, deps);
    this.supersedesSubscriptionId = input.supersedesSubscriptionId;
    this.createRequest = CreateSubscriptionRequestSchema.parse({ ...this.intent, ...this.acquisition.requestFields });
    this.request = { ...(this.createRequest as Record<string, string>), supersedesSubscriptionId: input.supersedesSubscriptionId, confirmed: true };
    this.creator = new CheckoutCreate(this.intent, deps);
    this.reuseMinRemainingSeconds = deps.reuseMinRemainingSeconds ?? CHECKOUT_CONFIG.reuseMinRemainingSeconds;
  }

  // -- Tx A -----------------------------------------------------------------

  async prepare(tx: Prisma.TransactionClient, scope: CommandScope, root: BillingOperation): Promise<Preparation<StartCheckoutResult, SupersedePlan>> {
    const { decision, open, predecessorExists } = await this.decide(tx, scope);

    // The root names the subscription it would replace (when it is the caller's own).
    if (predecessorExists) await BillingOperationRepository.linkSubscription(tx, root.id, this.supersedesSubscriptionId);

    switch (decision.kind) {
      case "SUPERSEDE_THEN_CREATE":
        return { kind: "PROCEED", plan: { kind: "CANCEL_THEN_CREATE", old: open.find((row) => row.id === decision.subscription.id)! } };
      case "CREATE": {
        const provisioned = await this.provisionAndLink(tx, scope, root, decision);

        return provisioned === null
          ? { kind: "REFUSE", error: new SupersessionNotApplicableError() }
          : { kind: "PROCEED", plan: { kind: "CREATE", provisioned } };
      }
      case "REFUSE":
        return { kind: "REFUSE", error: checkoutRefusalError(decision) };
      default:
        throw new Error(`Supersede cannot act on ${decision.kind}`);
    }
  }

  // -- After tx A -----------------------------------------------------------

  async execute(scope: CommandScope, root: BillingOperation, plan: SupersedePlan): Promise<StartCheckoutResult> {
    if (plan.kind === "CREATE") return this.create(scope, root, plan.provisioned);

    const { runner } = scope;
    const old = plan.old;

    // Re-check by sync before acting: a subscription that recovered on its own is never cancelled.
    const { subscription: observed } = await runner.confirmBySync(old.id);

    if (observed === null) {
      await this.close(scope, root, { status: "REJECTED", failureClass: null });

      throw new BillingBusyError();
    }

    if (!isSupersedable(observed.phase) && observed.phase !== "CANCELLED") {
      await this.close(scope, root, { status: "REJECTED", failureClass: null });

      throw new SupersessionNotApplicableError();
    }

    if (observed.phase !== "CANCELLED") {
      const request = { atCycleEnd: false, reason: "SUPERSESSION" } satisfies CancelImmediatelyRequest;
      const cancelled = await cancelImmediately(scope, { parent: root, request }, old);
      const { outcome } = cancelled;

      if (!cancelled.confirmed || cancelled.observedPhase !== "CANCELLED") {
        if (outcome.kind === "REJECTED") {
          await this.close(scope, root, { status: "REJECTED", failureClass: outcome.failureClass });

          // Razorpay refused to cancel this state: recovery is the way back.
          throw errorForRejection(outcome.failureClass) ?? (notSent(outcome) ? new BillingBusyError() : new SupersessionCancelRefusedError());
        }

        // Sent, but `cancelled` is not visible yet: the next request continues.
        await this.close(scope, root, outcome.kind === "SUCCESS" ? { status: "SUCCEEDED" } : { status: "REJECTED", failureClass: null });

        return { status: "CONFIRMING", operationId: root.id };
      }
    }

    // Tx A2: observed cancelled. The root still holds the slot; re-decide, then provision and link.
    const provisioned = await prisma.$transaction(async (tx) => {
      const now = scope.now();

      if (!(await BillingOperationRepository.renewLease(tx, root.id, runner.leaseUntil(now), now))) return null;

      const { decision } = await this.decide(tx, scope);

      return decision.kind === "CREATE" ? this.provisionAndLink(tx, scope, root, decision) : null;
    });

    if (provisioned === null) {
      await this.close(scope, root, { status: "SUCCEEDED" });

      return { status: "CONFIRMING", operationId: root.id };
    }

    return this.create(scope, root, provisioned);
  }

  private async create(scope: CommandScope, root: BillingOperation, provisioned: Provisioned): Promise<StartCheckoutResult> {
    const outcome = await this.creator.send(scope, { child: provisioned.child }, provisioned.subscriptionId);

    await this.close(scope, root, closingFor(outcome));

    return this.creator.respond(outcome, provisioned.subscriptionId, root.id);
  }

  // -- Replays --------------------------------------------------------------

  inProgress(root: BillingOperation): StartCheckoutResult {
    return { status: root.status === "OUTCOME_UNKNOWN" ? "CONFIRMING" : "IN_PROGRESS", operationId: root.id };
  }

  async replay(scope: CommandScope, root: BillingOperation): Promise<StartCheckoutResult> {
    const children = await BillingOperationRepository.children(root.id);
    const create = children.find((child) => child.kind === "CREATE_SUBSCRIPTION");

    if (create) {
      switch (create.status) {
        case "SUCCEEDED":
          return replayCreated(this.creator, scope, create.subscriptionId!, root.id);
        case "REJECTED":
          throw await this.creator.rejectionError(create.subscriptionId, create.failureClass);
        case "NOT_APPLIED":
          return { status: "CLOSED", operationId: root.id };
        default:
          return { status: "CONFIRMING", operationId: root.id };
      }
    }

    if (root.status === "REJECTED" && root.failureClass !== null) {
      throw errorForRejection(root.failureClass) ?? new SupersessionCancelRefusedError();
    }

    if (children.length > 0 || root.status === "SUCCEEDED") return { status: "CONFIRMING", operationId: root.id };

    // A local refusal: explained from current state, never re-executed (IB-25 item 3), and from
    // what the operation itself recorded, not from what this retry's body says (IB-27 item 11).
    const stored = CreateSubscriptionRequestSchema.parse(root.request);
    const recorded = new SupersedeCommand(
      { plan: stored.plan, cycle: stored.cycle, trial: stored.kind === "TRIAL", code: stored.code, supersedesSubscriptionId: this.supersedesSubscriptionId },
      this.deps,
    );
    const { decision } = await recorded.decide(prisma, scope);

    throw decision.kind === "REFUSE" ? checkoutRefusalError(decision) : new BillingRequestRefusedError();
  }

  // -- Internals ------------------------------------------------------------

  private async decide(tx: Prisma.TransactionClient, scope: CommandScope) {
    const open = await loadOpenSubscriptions(tx, scope.actor.userId, scope.mode);
    const predecessor = await tx.subscription.findFirst({
      where: { id: this.supersedesSubscriptionId, userId: scope.actor.userId, providerMode: scope.mode },
      select: { id: true, phase: true, supersededById: true },
    });
    const decision = evaluateCheckoutPreconditions({
      open: open.map(openView),
      // The runner refused an open anomaly before tx A reached here.
      hasOpenAnomaly: false,
      intent: this.intent,
      now: scope.now(),
      reuseMinRemainingSeconds: this.reuseMinRemainingSeconds,
      supersedes: { subscriptionId: this.supersedesSubscriptionId, predecessor },
      acquisition: await this.acquisition.policyInput(tx, scope.actor.userId, scope.mode),
    });

    return { decision, open, predecessorExists: predecessor !== null };
  }

  /**
   * The new `PROVISIONING` record with the create child that will send it,
   * and the successor link on the old one with its `SUPERSESSION` history
   * (multiple-subscriptions.md step 6), all in one transaction. `null` when
   * the decision carries no predecessor to link.
   */
  private async provisionAndLink(
    tx: Prisma.TransactionClient,
    scope: CommandScope,
    root: BillingOperation,
    decision: Extract<CheckoutDecision, { kind: "CREATE" }>,
  ): Promise<Provisioned | null> {
    const predecessorId = decision.linkPredecessor;

    if (predecessorId === undefined) return null;

    const now = scope.now();
    const subscription = await createProvisioning(tx, {
      userId: scope.actor.userId,
      mode: scope.mode,
      plan: this.intent.plan,
      cycle: this.intent.cycle,
      // The root names the old subscription; the create child names this one.
      operationId: null,
      now,
      acquisition: this.acquisition.provisioningFor(decision, now),
    });
    const { count } = await tx.subscription.updateMany({
      where: { id: predecessorId, supersededById: null },
      data: { supersededById: subscription.id },
    });

    if (count === 0) throw new SupersessionNotApplicableError();

    await SubscriptionHistoryRepository.record(tx, [
      {
        subscriptionId: predecessorId,
        userId: scope.actor.userId,
        change: "SUPERSESSION",
        fromValue: null,
        toValue: subscription.id,
        cause: "KIZUNIA_COMMAND",
        trigger: "COMMAND_CONFIRM",
        operationId: root.id,
      },
    ]);

    const child = await scope.runner.insertChild(tx, root, {
      kind: "CREATE_SUBSCRIPTION",
      subscriptionId: subscription.id,
      request: this.createRequest,
    });

    return { subscriptionId: subscription.id, child };
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

/** How a supersession root ends once its create child has an answer (IB-26 item 4). */
function closingFor(outcome: ClassifiedOutcome<ProviderSubscriptionState>): Parameters<typeof BillingOperationRepository.closeParent>[2] {
  switch (outcome.kind) {
    case "SUCCESS":
      return { status: "SUCCEEDED" };
    case "REJECTED":
    case "OUTCOME_UNKNOWN":
      return { status: "REJECTED", failureClass: outcome.kind === "REJECTED" ? outcome.failureClass : null };
    default:
      return { status: "REJECTED", failureClass: null };
  }
}
