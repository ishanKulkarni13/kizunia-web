/**
 * Billing — Clearing a Pending Scheduled Change (a child step)
 *
 * At most one scheduled change exists, and cancellation always wins
 * (SB-LC-08): before a cycle-end cancel or a new plan change, a pending
 * `cycle_end` update is cancelled through Razorpay's Cancel an Update, as a
 * `CANCEL_SCHEDULED_CHANGE` child under the command's root (IB-6, IB-26
 * item 1), and **confirmed by sync**:
 *
 *   cancelScheduledChange             "you cannot cancel an update once it is live"
 *   tx B                              the response through the apply path; row marked due
 *   one targeted priority-1 sync      cleared only when the fetch shows no pending change
 *                                     (no Kizunia target and the provider flag off)
 *
 * A refusal is not taken at its word either: when the pending change was
 * already applied or cancelled elsewhere (local state stale), the fetch shows
 * it gone and the command may proceed. An unknown outcome is settled by the
 * apply path (`settleOperations`: `has_scheduled_changes = false`).
 */
import type { BillingOperation, Subscription } from "@/generated/prisma";

import type { ClassifiedOutcome } from "../../policy/command-outcome";
import type { ProviderSubscriptionState } from "../../provider/types";
import { applyObservationInTransaction } from "../sync/apply";
import { SyncClaimRepository } from "../sync/claim.repository";
import type { CommandScope } from "./command-runner";
import { notSent } from "./immediate-cancel";
import { hasScheduledChange } from "./provisioning";

export interface ClearScheduledChangeResult {
  readonly outcome: ClassifiedOutcome<ProviderSubscriptionState>;
  /** A fetch after the call observed no pending change. `false` when nothing was sent. */
  readonly cleared: boolean;
}

export async function clearScheduledChange(
  scope: CommandScope,
  parent: BillingOperation,
  subscription: Pick<Subscription, "id" | "providerSubscriptionId">,
): Promise<ClearScheduledChangeResult> {
  const { runner, mode } = scope;
  const providerSubscriptionId = subscription.providerSubscriptionId;

  if (providerSubscriptionId === null) throw new Error(`Subscription ${subscription.id} has no provider subscription.`);

  const { outcome } = await runner.runChild<ProviderSubscriptionState>(parent, {
    kind: "CANCEL_SCHEDULED_CHANGE",
    subscriptionId: subscription.id,
    request: { reason: parent.kind },
    call: (provider) => provider.cancelScheduledChange(providerSubscriptionId),
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

      await SyncClaimRepository.markDue(tx, subscription.id, "COMMAND_CONFIRM", now, { eventDriven: false, now });
    },
  });

  if (notSent(outcome)) return { outcome, cleared: false };

  const { subscription: observed } = await runner.confirmBySync(subscription.id);

  return { outcome, cleared: observed !== null && !hasScheduledChange(observed) };
}
