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
 *   create      the shared create step (create-subscription-step.ts): notes
 *               {kz_sub, kz_op, kz_env}, expire_by = now + C5, total_count per cycle
 *
 * Replacing an on-hold subscription is a supersession (`supersede.ts`), a
 * different root kind that reuses the same create step. Access is not granted
 * here: it changes only when an observation shows the subscription paid.
 */
import type { BillingOperation, Prisma, Subscription } from "@/generated/prisma";
import type { AppError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import { CHECKOUT_CONFIG } from "../../config/billing-config";
import {
  BillingBusyError,
  BillingContactSupportError,
  BillingRequestRefusedError,
  CheckoutFailedError,
  CheckoutInProgressError,
  SubscriptionExistsError,
  SupersessionNotApplicableError,
  SupersessionRequiredError,
} from "../../errors";
import {
  evaluateCheckoutPreconditions,
  type CheckoutDecision,
  type CheckoutIntent,
} from "../../policy/command-preconditions";
import { CreateSubscriptionRequestSchema, type StartCheckoutInput } from "../../schemas/checkout";
import { abandonCheckout } from "./abandon-checkout";
import { errorForRejection, type BillingCommand, type CommandScope, type Preparation } from "./command-runner";
import { CheckoutCreate, type CheckoutCreateDeps, type StartCheckoutResult } from "./create-subscription-step";
import { BillingOperationRepository } from "./operation.repository";
import { createProvisioning, loadOpenSubscriptions, openView } from "./provisioning";

export type { CheckoutParams, StartCheckoutResult } from "./create-subscription-step";

type StartPlan =
  | { readonly kind: "CREATE"; readonly subscriptionId: string }
  | { readonly kind: "ABANDON_THEN_CREATE"; readonly old: Subscription };

export interface StartCheckoutDeps extends CheckoutCreateDeps {
  readonly reuseMinRemainingSeconds?: number;
}

export class StartCheckoutCommand implements BillingCommand<StartCheckoutResult, StartPlan> {
  readonly kind = "CREATE_SUBSCRIPTION" as const;
  readonly customerCommand = true;
  readonly request: Prisma.InputJsonValue;

  private readonly intent: CheckoutIntent;
  private readonly creator: CheckoutCreate;
  private readonly reuseMinRemainingSeconds: number;

  constructor(input: Pick<StartCheckoutInput, "plan" | "cycle">, deps: StartCheckoutDeps = {}) {
    this.intent = { plan: input.plan, cycle: input.cycle };
    this.request = CreateSubscriptionRequestSchema.parse({ plan: input.plan, cycle: input.cycle, kind: "STANDARD" });
    this.creator = new CheckoutCreate(this.intent, deps);
    this.reuseMinRemainingSeconds = deps.reuseMinRemainingSeconds ?? CHECKOUT_CONFIG.reuseMinRemainingSeconds;
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
      case "RETURN_PROVISIONING":
        return { kind: "RESPOND", result: { status: "IN_PROGRESS", operationId: await creatingOperationId(tx, decision.subscription.id) } };
      case "REUSE_PENDING": {
        const subscription = open.find((row) => row.id === decision.subscription.id)!;

        return { kind: "RESPOND", result: this.creator.ready(subscription, null) };
      }
      case "ABANDON_THEN_CREATE":
        return { kind: "PROCEED", plan: { kind: "ABANDON_THEN_CREATE", old: open.find((row) => row.id === decision.subscription.id)! } };
      case "REFUSE":
        return { kind: "REFUSE", error: checkoutRefusalError(decision) };
      default:
        // Only a supersession request can reach SUPERSEDE_THEN_CREATE (supersede.ts).
        throw new Error(`StartCheckout cannot act on ${decision.kind}`);
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
    const outcome = await this.creator.send(scope, { root }, subscriptionId);

    return this.creator.respond(outcome, subscriptionId, root.id);
  }

  // -- Replays --------------------------------------------------------------

  inProgress(root: BillingOperation): StartCheckoutResult {
    return { status: root.status === "OUTCOME_UNKNOWN" ? "CONFIRMING" : "IN_PROGRESS", operationId: root.id };
  }

  async replay(scope: CommandScope, root: BillingOperation): Promise<StartCheckoutResult> {
    if (root.status === "SUCCEEDED" && root.subscriptionId) {
      return replayCreated(this.creator, scope, root.subscriptionId, root.id);
    }

    if (root.status === "NOT_APPLIED" || root.status === "SUCCEEDED") return { status: "CLOSED", operationId: root.id };

    // REJECTED.
    if (root.failureClass !== null) throw errorForRejection(root.failureClass) ?? new CheckoutFailedError();

    const children = await BillingOperationRepository.children(root.id);

    if (children.length > 0) return { status: "CONFIRMING", operationId: root.id };

    // A local refusal: explained from current state, never re-executed (IB-25 item 3).
    const decision = this.decide(await loadOpenSubscriptions(prisma, scope.actor.userId, scope.mode), scope.now());

    throw decision.kind === "REFUSE" ? checkoutRefusalError(decision) : new BillingRequestRefusedError();
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

  /**
   * Ends a root whose create was never sent. Normally it is still IN_FLIGHT
   * (REJECTED); if its lease lapsed under a slow request it is OUTCOME_UNKNOWN,
   * and since nothing was sent it is provably NOT_APPLIED.
   */
  private async closeRoot(scope: CommandScope, root: BillingOperation, failureClass: BillingOperation["failureClass"]): Promise<void> {
    const now = scope.now();

    await prisma.$transaction((tx) => BillingOperationRepository.closeUnsent(tx, root.id, failureClass, now));
  }
}

/** A same-key retry of a create that succeeded: the checkout again while it can still be completed. */
export async function replayCreated(
  creator: CheckoutCreate,
  scope: CommandScope,
  subscriptionId: string,
  operationId: string,
): Promise<StartCheckoutResult> {
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  const stillOpen =
    subscription?.phase === "PENDING_AUTHENTICATION" &&
    subscription.providerSubscriptionId !== null &&
    (subscription.expireBy === null || subscription.expireBy.getTime() > scope.now().getTime());

  return stillOpen ? creator.ready(subscription, operationId) : { status: "CLOSED", operationId };
}

/** The root that is creating a `PROVISIONING` record (a supersession's create is its child). */
export async function creatingOperationId(tx: Prisma.TransactionClient, subscriptionId: string): Promise<string | null> {
  const creating = await tx.billingOperation.findFirst({
    where: { subscriptionId, kind: "CREATE_SUBSCRIPTION" },
    orderBy: { createdAt: "desc" },
    select: { id: true, parentOperationId: true },
  });

  return creating ? (creating.parentOperationId ?? creating.id) : null;
}

export function checkoutRefusalError(decision: Extract<CheckoutDecision, { kind: "REFUSE" }>): AppError {
  switch (decision.reason) {
    case "CONTACT_SUPPORT":
      return new BillingContactSupportError();
    case "CHECKOUT_IN_PROGRESS":
      return new CheckoutInProgressError();
    case "SUBSCRIPTION_EXISTS":
      return new SubscriptionExistsError(decision.planChange ?? "UNKNOWN");
    case "SUPERSESSION_NOT_APPLICABLE":
      return new SupersessionNotApplicableError();
    default:
      return new SupersessionRequiredError();
  }
}
