/**
 * Billing — The Create Step of a Checkout
 *
 * Sends one `createSubscription` for a `PROVISIONING` record and settles it
 * (docs/architecture/subscription/implementation/checkout-flow.md). Shared by
 * StartCheckout, where the create is the root's own call, and by supersession,
 * where it is a `CREATE_SUBSCRIPTION` child under the `SUPERSEDE` root (IB-26
 * item 5). Either way `notes.kz_op` names the operation that carries the call,
 * so a webhook or the orphan scan binds it exactly as any other create:
 *
 *   notes {kz_sub, kz_op, kz_env}, expire_by = now + C5, total_count per cycle
 *   tx B   SUCCESS  -> bind + apply (-> PENDING_AUTHENTICATION) + mark due
 *          REJECTED -> ABANDONED ("busy" or a typed failure)
 *          UNKNOWN  -> stays PROVISIONING; never re-sent (SB-CM-03)
 *
 * The answer carries `keyId` and the provider subscription ID, which
 * `checkout.js` needs, to the owner of the checkout and nowhere else (IB-25
 * item 7).
 */
import type { BillingCycle, BillingOperation, MembershipPlan, Prisma, Subscription } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { CHECKOUT_CONFIG } from "../../config/billing-config";
import { BillingUnavailableError, CheckoutFailedError } from "../../errors";
import { BillingAlertCondition } from "../../observability/log";
import type { ClassifiedOutcome } from "../../policy/command-outcome";
import type { CheckoutIntent } from "../../policy/command-preconditions";
import { getCheckoutKeyId } from "../../provider/provider-mode";
import type { ProviderSubscriptionState } from "../../provider/types";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { applyObservationInTransaction, raiseAnomaly } from "../sync/apply";
import { bindProvisioning } from "../sync/binding";
import { SyncClaimRepository } from "../sync/claim.repository";
import { errorForRejection, type CommandScope, type MutationSpec, type SettleContext } from "./command-runner";
import { abandonProvisioning } from "./provisioning";

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
  /** Kizunia is confirming a previous step (an unknown create, a cancel not yet observed); poll, then retry. */
  | { readonly status: "CONFIRMING"; readonly operationId: string | null }
  /** A retry of a request whose checkout is no longer open; refresh `/me/billing`. */
  | { readonly status: "CLOSED"; readonly operationId: string };

export interface CheckoutCreateDeps {
  readonly keyId?: () => string | null;
  readonly expireBySeconds?: number;
  readonly totalCount?: Readonly<Record<BillingCycle, number>>;
}

/**
 * The operation the create is recorded as: the root's own call
 * (StartCheckout), or a `CREATE_SUBSCRIPTION` child a composed root inserted
 * together with the `PROVISIONING` record (`CommandRunner.insertChild`).
 */
export type CreateVia = { readonly root: BillingOperation } | { readonly child: BillingOperation };

export class CheckoutCreate {
  private readonly keyId: () => string | null;
  private readonly expireBySeconds: number;
  private readonly totalCount: Readonly<Record<BillingCycle, number>>;

  constructor(
    private readonly intent: CheckoutIntent,
    deps: CheckoutCreateDeps = {},
  ) {
    this.keyId = deps.keyId ?? getCheckoutKeyId;
    this.expireBySeconds = deps.expireBySeconds ?? CHECKOUT_CONFIG.expireBySeconds;
    this.totalCount = deps.totalCount ?? CHECKOUT_CONFIG.totalCount;
  }

  /** Sends the create for `subscriptionId` (a `PROVISIONING` record) and settles it in tx B. */
  async send(scope: CommandScope, via: CreateVia, subscriptionId: string): Promise<ClassifiedOutcome<ProviderSubscriptionState>> {
    const { runner, mode } = scope;
    const expireBy = new Date(scope.now().getTime() + this.expireBySeconds * 1000);
    const spec: MutationSpec<ProviderSubscriptionState> = {
      call: (provider, operation) =>
        provider.createSubscription({
          plan: this.intent.plan,
          cycle: this.intent.cycle,
          totalCount: this.totalCount[this.intent.cycle],
          expireBy,
          notes: { kz_sub: subscriptionId, kz_op: operation.id, kz_env: mode },
        }),
      settle: (tx, classified, context) => this.settle(tx, scope, subscriptionId, classified, context),
    };

    return runner.mutate("root" in via ? via.root : via.child, spec);
  }

  /** The answer after `send`, from local state (never the response itself). Throws on a refusal. */
  async respond(outcome: ClassifiedOutcome<ProviderSubscriptionState>, subscriptionId: string, operationId: string): Promise<StartCheckoutResult> {
    switch (outcome.kind) {
      case "SUCCESS": {
        const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

        return subscription.phase === "PENDING_AUTHENTICATION" && subscription.providerSubscriptionId
          ? this.ready(subscription, operationId)
          : { status: "IN_PROGRESS", operationId };
      }
      case "OUTCOME_UNKNOWN":
        return { status: "CONFIRMING", operationId };
      case "REJECTED":
        throw errorForRejection(outcome.failureClass) ?? new CheckoutFailedError();
      default:
        throw new BillingUnavailableError();
    }
  }

  ready(subscription: Subscription, operationId: string | null): StartCheckoutResult {
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

  private async settle(
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
}
