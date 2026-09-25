/**
 * Billing — One Immediate Cancellation, Confirmed by Sync
 *
 * The step every immediate cancel shares: a customer's cancel of a trialing,
 * past-due, halted or paused subscription, an abandoned checkout, an admin's
 * cancel, and supersession's first child
 * (docs/architecture/subscription/lifecycle/cancellation.md):
 *
 *   cancel(atCycleEnd: false)          the only cancel whose effect TEST verified in
 *                                      every open state (A1); never the cycle-end form
 *   tx B                               the response through the one apply path (SB-CM-05),
 *                                      and the row marked due whatever the answer
 *   one targeted priority-1 sync       the OBSERVED phase decides (D9: a cancel's
 *                                      response body is not always what a GET shows)
 *
 * It runs as the root's own mutation or as a child under a composed root
 * (IB-6). An unknown outcome is settled later by the apply path
 * (`settleOperations` resolves `CANCEL_IMMEDIATELY` by an observed
 * `cancelled`), never by resending.
 */
import type { BillingOperation, Prisma, Subscription, SubscriptionPhase } from "@/generated/prisma";

import type { ClassifiedOutcome } from "../../policy/command-outcome";
import { isTerminalPhase } from "../../policy/state-mapping";
import type { ProviderSubscriptionState } from "../../provider/types";
import { applyObservationInTransaction } from "../sync/apply";
import { SyncClaimRepository } from "../sync/claim.repository";
import type { CommandScope, MutationSpec } from "./command-runner";

/** Where the cancel is recorded: as the root's own call, or as a child of a composed root. */
export type CancelVia =
  | { readonly root: BillingOperation }
  | { readonly parent: BillingOperation; readonly request: Prisma.InputJsonValue };

export interface ImmediateCancelResult {
  /** The operation that carried the call (the root, or the new child). */
  readonly operation: BillingOperation;
  readonly outcome: ClassifiedOutcome<ProviderSubscriptionState>;
  /** A fetch after the call observed the subscription terminal. `false` when nothing was sent. */
  readonly confirmed: boolean;
  /** What that fetch observed; `null` when there was none, or it could not be made. */
  readonly observedPhase: SubscriptionPhase | null;
}

/** `true` when the call was refused before anything reached the provider (budget, cooldown). */
export function notSent(outcome: ClassifiedOutcome<unknown>): boolean {
  return outcome.kind === "REJECTED" && outcome.requestSentAt === null;
}

export async function cancelImmediately(
  scope: CommandScope,
  via: CancelVia,
  subscription: Pick<Subscription, "id" | "providerSubscriptionId">,
): Promise<ImmediateCancelResult> {
  const { runner, mode } = scope;
  const providerSubscriptionId = subscription.providerSubscriptionId;

  // Callers cancel only bound subscriptions (PROVISIONING is refused before this).
  if (providerSubscriptionId === null) throw new Error(`Subscription ${subscription.id} has no provider subscription to cancel.`);

  const spec: MutationSpec<ProviderSubscriptionState> = {
    call: (provider) => provider.cancelSubscription(providerSubscriptionId, { atCycleEnd: false }),
    settle: async (tx, classified, { operation, effects, now }) => {
      if (classified.kind === "SUCCESS") {
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
      }

      // Confirm by a fresh fetch whatever the answer: a refusal suggests stale local state.
      await SyncClaimRepository.markDue(tx, subscription.id, "COMMAND_CONFIRM", now, { eventDriven: false, now });
    },
  };

  const { operation, outcome } =
    "root" in via
      ? { operation: via.root, outcome: await runner.mutate(via.root, spec) }
      : await runner
          .runChild(via.parent, { ...spec, kind: "CANCEL_IMMEDIATELY", subscriptionId: subscription.id, request: via.request })
          .then(({ child, outcome: childOutcome }) => ({ operation: child, outcome: childOutcome }));

  if (notSent(outcome)) return { operation, outcome, confirmed: false, observedPhase: null };

  const { subscription: observed } = await runner.confirmBySync(subscription.id);
  const observedPhase = observed?.phase ?? null;

  return { operation, outcome, confirmed: observedPhase !== null && isTerminalPhase(observedPhase), observedPhase };
}
