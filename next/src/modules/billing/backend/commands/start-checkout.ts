/**
 * Billing — StartCheckout (`CREATE_SUBSCRIPTION`)
 *
 * A Free user's first step to a paid plan
 * (docs/architecture/subscription/implementation/checkout-flow.md). Exactly one
 * Razorpay subscription per intent, whatever the clicks, tabs, timeouts or
 * crashes:
 *
 *   tx A        the reuse and uniqueness table (policy/command-preconditions.ts):
 *                 CREATE              -> PROVISIONING row, linked to the root
 *                 RETURN_PROVISIONING -> "still being set up" (nothing persisted)
 *                 REUSE_PENDING       -> the stored checkout, no provider call
 *                 ABANDON_THEN_CREATE -> the composed path below
 *                 REFUSE              -> a typed refusal, recorded
 *   abandon     child CANCEL_IMMEDIATELY + targeted sync; not observed terminal -> CONFIRMING
 *   create      notes {kz_sub, kz_op, kz_env}, expire_by = now + C5, total_count per cycle
 *   tx B        SUCCESS  -> bind + apply (-> PENDING_AUTHENTICATION) + mark due
 *               REJECTED -> ABANDONED ("busy" or a typed failure)
 *               UNKNOWN  -> stays PROVISIONING; never re-sent: a webhook or the
 *                           orphan scan binds it through notes, or its window closes
 *
 * The response carries `keyId` and the provider subscription ID, which
 * `checkout.js` needs, to the owner of the checkout and nowhere else (IB-25
 * item 7). Access is not granted here: it changes only when an observation
 * shows the subscription paid.
 */
import type { BillingOperation, BillingCycle, MembershipPlan, Prisma, Subscription } from "@/generated/prisma";
import type { AppError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import { CHECKOUT_CONFIG } from "../../config/billing-config";
import {
  BillingBusyError,
  BillingContactSupportError,
  BillingRequestRefusedError,
  BillingUnavailableError,
  CheckoutFailedError,
  CheckoutInProgressError,
  SubscriptionExistsError,
  SupersessionRequiredError,
} from "../../errors";
import { BillingAlertCondition } from "../../observability/log";
import type { ClassifiedOutcome } from "../../policy/command-outcome";
import { evaluateCheckoutPreconditions, type CheckoutDecision, type CheckoutIntent } from "../../policy/command-preconditions";
import { getCheckoutKeyId } from "../../provider/provider-mode";
import type { ProviderSubscriptionState } from "../../provider/types";
import { CreateSubscriptionRequestSchema, type StartCheckoutInput } from "../../schemas/checkout";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { applyObservationInTransaction, raiseAnomaly } from "../sync/apply";
import { bindProvisioning } from "../sync/binding";
import { SyncClaimRepository } from "../sync/claim.repository";
import { abandonCheckout } from "./abandon-checkout";
import {
  errorForRejection,
  type BillingCommand,
  type CommandScope,
  type Preparation,
  type SettleContext,
} from "./command-runner";
import { BillingOperationRepository } from "./operation.repository";
import { abandonProvisioning, createProvisioning, loadOpenSubscriptions, openView } from "./provisioning";

/** What `checkout.js` needs. Returned only to the checkout's owner. */
export interface CheckoutParams {
  readonly keyId: string;
  readonly subscriptionId: string;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  /** ISO timestamp: when the customer must have authenticated by. */
  readonly expireBy: string | null;
}

export type StartCheckoutResult =
  /** Open Razorpay Checkout with these. */
  | { readonly status: "CHECKOUT_READY"; readonly operationId: string | null; readonly checkout: CheckoutParams }
  /** A checkout for this plan is being set up; poll `/me/billing`. */
  | { readonly status: "IN_PROGRESS"; readonly operationId: string | null }
  /** Kizunia is confirming a previous step (an unknown create, an abandon not yet observed); poll, then retry. */
  | { readonly status: "CONFIRMING"; readonly operationId: string | null }
  /** A retry of a request whose checkout is no longer open; refresh `/me/billing`. */
  | { readonly status: "CLOSED"; readonly operationId: string };

type StartPlan =
  | { readonly kind: "CREATE"; readonly subscriptionId: string }
  | { readonly kind: "ABANDON_THEN_CREATE"; readonly old: Subscription };

export interface StartCheckoutDeps {
  readonly keyId?: () => string | null;
  readonly expireBySeconds?: number;
  readonly reuseMinRemainingSeconds?: number;
  readonly totalCount?: Readonly<Record<BillingCycle, number>>;
}

export class StartCheckoutCommand implements BillingCommand<StartCheckoutResult, StartPlan> {
  readonly kind = "CREATE_SUBSCRIPTION" as const;
  readonly customerCommand = true;
  readonly request: Prisma.InputJsonValue;

  private readonly intent: CheckoutIntent;
  private readonly keyId: () => string | null;
  private readonly expireBySeconds: number;
  private readonly reuseMinRemainingSeconds: number;
  private readonly totalCount: Readonly<Record<BillingCycle, number>>;

  constructor(input: StartCheckoutInput, deps: StartCheckoutDeps = {}) {
    this.intent = { plan: input.plan, cycle: input.cycle };
    this.request = CreateSubscriptionRequestSchema.parse({ plan: input.plan, cycle: input.cycle, kind: "STANDARD" });
    this.keyId = deps.keyId ?? getCheckoutKeyId;
    this.expireBySeconds = deps.expireBySeconds ?? CHECKOUT_CONFIG.expireBySeconds;
    this.reuseMinRemainingSeconds = deps.reuseMinRemainingSeconds ?? CHECKOUT_CONFIG.reuseMinRemainingSeconds;
    this.totalCount = deps.totalCount ?? CHECKOUT_CONFIG.totalCount;
  }

  // -- Tx A -----------------------------------------------------------------

  async prepare(
    tx: Prisma.TransactionClient,
    scope: CommandScope,
    root: BillingOperation,
  ): Promise<Preparation<StartCheckoutResult, StartPlan>> {
    const open = await loadOpenSubscriptions(tx, scope.actor.userId, scope.mode);
    const decision = this.decide(open, scope.now());

    switch (decision.kind) {
      case "CREATE": {
        const subscription = await createProvisioning(tx, {
          userId: scope.actor.userId,
          mode: scope.mode,
          plan: this.intent.plan,
          cycle: this.intent.cycle,
          operationId: root.id,
          now: scope.now(),
        });

        return { kind: "PROCEED", plan: { kind: "CREATE", subscriptionId: subscription.id } };
      }
      case "RETURN_PROVISIONING": {
        const creating = await tx.billingOperation.findFirst({
          where: { subscriptionId: decision.subscription.id, kind: "CREATE_SUBSCRIPTION", parentOperationId: null },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        return { kind: "RESPOND", result: { status: "IN_PROGRESS", operationId: creating?.id ?? null } };
      }
      case "REUSE_PENDING": {
        const subscription = open.find((row) => row.id === decision.subscription.id)!;

        return { kind: "RESPOND", result: this.ready(subscription, null) };
      }
      case "ABANDON_THEN_CREATE":
        return { kind: "PROCEED", plan: { kind: "ABANDON_THEN_CREATE", old: open.find((row) => row.id === decision.subscription.id)! } };
      default:
        return { kind: "REFUSE", error: refusalError(decision) };
    }
  }

  // -- After tx A -----------------------------------------------------------

  async execute(scope: CommandScope, root: BillingOperation, plan: StartPlan): Promise<StartCheckoutResult> {
    if (plan.kind === "CREATE") return this.create(scope, root, plan.subscriptionId);

    const abandoned = await abandonCheckout(scope, root, plan.old);

    if (abandoned.kind === "NOT_SENT") {
      await this.closeRoot(scope, root, abandoned.outcome.failureClass);

      throw errorForRejection(abandoned.outcome.failureClass) ?? new BillingBusyError();
    }

    if (abandoned.kind === "NOT_CONFIRMED") {
      await this.closeRoot(scope, root, null);

      return { status: "CONFIRMING", operationId: root.id };
    }

    // Tx A2: the old checkout is observed terminal. The root still holds the
    // user's slot, so nothing else can have started; re-check and provision.
    const subscriptionId = await prisma.$transaction(async (tx) => {
      const now = scope.now();

      if (!(await BillingOperationRepository.renewLease(tx, root.id, scope.runner.leaseUntil(now), now))) return null;

      const decision = this.decide(await loadOpenSubscriptions(tx, scope.actor.userId, scope.mode), now);

      if (decision.kind !== "CREATE") return null;

      const subscription = await createProvisioning(tx, {
        userId: scope.actor.userId,
        mode: scope.mode,
        plan: this.intent.plan,
        cycle: this.intent.cycle,
        operationId: root.id,
        now,
      });

      return subscription.id;
    });

    if (subscriptionId === null) {
      await this.closeRoot(scope, root, null);

      return { status: "CONFIRMING", operationId: root.id };
    }

    return this.create(scope, root, subscriptionId);
  }

  private async create(scope: CommandScope, root: BillingOperation, subscriptionId: string): Promise<StartCheckoutResult> {
    const { runner, mode } = scope;
    const expireBy = new Date(scope.now().getTime() + this.expireBySeconds * 1000);

    const outcome = await runner.mutate<ProviderSubscriptionState>(root, {
      call: (provider) =>
        provider.createSubscription({
          plan: this.intent.plan,
          cycle: this.intent.cycle,
          totalCount: this.totalCount[this.intent.cycle],
          expireBy,
          notes: { kz_sub: subscriptionId, kz_op: root.id, kz_env: mode },
        }),
      settle: (tx, classified, context) => this.settleCreate(tx, scope, subscriptionId, classified, context),
    });

    switch (outcome.kind) {
      case "SUCCESS": {
        const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

        return subscription.phase === "PENDING_AUTHENTICATION" && subscription.providerSubscriptionId
          ? this.ready(subscription, root.id)
          : { status: "IN_PROGRESS", operationId: root.id };
      }
      case "OUTCOME_UNKNOWN":
        return { status: "CONFIRMING", operationId: root.id };
      case "REJECTED":
        throw errorForRejection(outcome.failureClass) ?? new CheckoutFailedError();
      default:
        throw new BillingUnavailableError();
    }
  }

  private async settleCreate(
    tx: Prisma.TransactionClient,
    scope: CommandScope,
    subscriptionId: string,
    classified: ClassifiedOutcome<ProviderSubscriptionState>,
    { operation, effects, now }: SettleContext,
  ): Promise<void> {
    const { mode, runner } = scope;

    if (classified.kind === "OUTCOME_UNKNOWN") return; // stays PROVISIONING; never re-sent

    if (classified.kind !== "SUCCESS") {
      await abandonProvisioning(tx, { subscriptionId, operationId: operation.id, trigger: "COMMAND_RESPONSE", now });

      if (classified.kind === "REJECTED" && !errorForRejection(classified.failureClass)) {
        // Refused although Kizunia sent what the catalog says (a misconfiguration, an expired plan).
        effects.alerts.push({
          condition: BillingAlertCondition.CHECKOUT_REJECTED,
          severity: "HIGH",
          fields: {
            operationId: operation.id,
            subscriptionId,
            failureClass: classified.failureClass,
            providerErrorCode: classified.providerErrorCode,
          },
        });
      }

      return;
    }

    const state = classified.value;
    const bound = await bindProvisioning(tx, {
      mode,
      providerSubscriptionId: state.providerSubscriptionId,
      subscriptionId,
      operationId: operation.id,
      trigger: "COMMAND_RESPONSE",
      now,
    });

    if (bound.outcome === "REFUSED") {
      // The provider created it, but the record it names cannot take it (closed meanwhile): a human decides.
      await raiseAnomaly(
        tx,
        {
          type: "NOTES_CONFLICT",
          providerMode: mode,
          subjectKey: AnomalySubject.providerSubscription(state.providerSubscriptionId),
          userId: scope.actor.userId,
          subscriptionIds: [subscriptionId],
          providerSubscriptionId: state.providerSubscriptionId,
          details: { reason: "the create's own record could not be bound", operationId: operation.id },
        },
        now,
        effects,
        { operationId: operation.id, subscriptionId },
      );

      return;
    }

    await applyObservationInTransaction(
      tx,
      subscriptionId,
      { state, observationAt: classified.requestSentAt },
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

    // SB-CM-05: a fresh fetch confirms what the response said.
    await SyncClaimRepository.markDue(tx, subscriptionId, "COMMAND_CONFIRM", now, { eventDriven: false, now });

    effects.events.push({
      event: "checkout.created",
      fields: { operationId: operation.id, subscriptionId, userId: scope.actor.userId, plan: this.intent.plan, cycle: this.intent.cycle },
    });
  }

  // -- Replays --------------------------------------------------------------

  inProgress(root: BillingOperation): StartCheckoutResult {
    return { status: root.status === "OUTCOME_UNKNOWN" ? "CONFIRMING" : "IN_PROGRESS", operationId: root.id };
  }

  async replay(scope: CommandScope, root: BillingOperation): Promise<StartCheckoutResult> {
    if (root.status === "SUCCEEDED" && root.subscriptionId) {
      const subscription = await prisma.subscription.findUnique({ where: { id: root.subscriptionId } });
      const stillOpen =
        subscription?.phase === "PENDING_AUTHENTICATION" &&
        subscription.providerSubscriptionId !== null &&
        (subscription.expireBy === null || subscription.expireBy.getTime() > scope.now().getTime());

      return stillOpen ? this.ready(subscription, root.id) : { status: "CLOSED", operationId: root.id };
    }

    if (root.status === "NOT_APPLIED" || root.status === "SUCCEEDED") return { status: "CLOSED", operationId: root.id };

    // REJECTED.
    if (root.failureClass !== null) throw errorForRejection(root.failureClass) ?? new CheckoutFailedError();

    const children = await BillingOperationRepository.children(root.id);

    if (children.length > 0) return { status: "CONFIRMING", operationId: root.id };

    // A local refusal: explained from current state, never re-executed (IB-25 item 3).
    const decision = this.decide(await loadOpenSubscriptions(prisma, scope.actor.userId, scope.mode), scope.now());

    throw decision.kind === "REFUSE" ? refusalError(decision) : new BillingRequestRefusedError();
  }

  // -- Internals ------------------------------------------------------------

  private decide(open: readonly Subscription[], now: Date): CheckoutDecision {
    return evaluateCheckoutPreconditions({
      open: open.map(openView),
      // The runner refused an open anomaly before tx A reached here.
      hasOpenAnomaly: false,
      intent: this.intent,
      now,
      reuseMinRemainingSeconds: this.reuseMinRemainingSeconds,
    });
  }

  private ready(subscription: Subscription, operationId: string | null): StartCheckoutResult {
    const keyId = this.keyId();

    if (keyId === null || subscription.providerSubscriptionId === null) throw new BillingUnavailableError();

    return {
      status: "CHECKOUT_READY",
      operationId,
      checkout: {
        keyId,
        subscriptionId: subscription.providerSubscriptionId,
        plan: subscription.plan,
        cycle: subscription.cycle,
        expireBy: subscription.expireBy?.toISOString() ?? null,
      },
    };
  }

  /**
   * Ends a root whose create was never sent. Normally it is still IN_FLIGHT
   * (REJECTED); if its lease lapsed under a slow request it is OUTCOME_UNKNOWN,
   * and since nothing was sent it is provably NOT_APPLIED.
   */
  private async closeRoot(scope: CommandScope, root: BillingOperation, failureClass: BillingOperation["failureClass"]): Promise<void> {
    const now = scope.now();

    await prisma.$transaction(async (tx) => {
      if (!(await BillingOperationRepository.rejectInFlight(tx, root.id, failureClass, now))) {
        await BillingOperationRepository.resolveNotApplied(tx, root.id, now);
      }
    });
  }
}

function refusalError(decision: Extract<CheckoutDecision, { kind: "REFUSE" }>): AppError {
  switch (decision.reason) {
    case "CONTACT_SUPPORT":
      return new BillingContactSupportError();
    case "CHECKOUT_IN_PROGRESS":
      return new CheckoutInProgressError();
    case "SUBSCRIPTION_EXISTS":
      return new SubscriptionExistsError(decision.planChange ?? "UNKNOWN");
    default:
      return new SupersessionRequiredError();
  }
}
