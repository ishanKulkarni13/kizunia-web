/**
 * Billing — AbandonCheckout (a child of StartCheckout)
 *
 * A pending checkout for another plan or cycle, or one that has (nearly)
 * expired, is cancelled before a new one is created, so Kizunia never has two
 * open subscriptions for a user (SB-UQ-02). It is a `CANCEL_IMMEDIATELY` child
 * under the create's root, sharing its slot (IB-6):
 *
 *   cancel(atCycleEnd: false)          accepted for `created` in TEST (A1)
 *   one targeted priority-1 sync       the OBSERVED phase decides, never the
 *                                      cancel's response (checkout-flow.md)
 *     terminal (cancelled / expired)   -> the parent creates the new checkout
 *     anything else                    -> the parent answers CONFIRMING; the
 *                                         old checkout stays resumable
 *
 * A refused cancel is expected for a checkout that has already expired
 * (Razorpay: "not cancellable in expired status", A1/D1): the sync still runs
 * and observes `expired`. An unknown cancel outcome is settled later by the
 * apply path (`settleOperations` handles `CANCEL_IMMEDIATELY`).
 */
import type { BillingOperation, Subscription } from "@/generated/prisma";

import { applyObservationInTransaction } from "../sync/apply";
import { SyncClaimRepository } from "../sync/claim.repository";
import type { CommandScope } from "./command-runner";
import type { ClassifiedOutcome } from "../../policy/command-outcome";
import type { ProviderSubscriptionState } from "../../provider/types";

export type AbandonResult =
  /** The old checkout is observed terminal: the parent may create. */
  | { readonly kind: "CONFIRMED" }
  /** Nothing was sent (budget or cooldown): the parent stops, "billing is busy". */
  | { readonly kind: "NOT_SENT"; readonly outcome: Extract<ClassifiedOutcome<ProviderSubscriptionState>, { kind: "REJECTED" }> }
  /** Sent, but its end is not observed yet: the parent answers CONFIRMING. */
  | { readonly kind: "NOT_CONFIRMED" };

export async function abandonCheckout(
  scope: CommandScope,
  root: BillingOperation,
  old: Pick<Subscription, "id" | "providerSubscriptionId">,
): Promise<AbandonResult> {
  const { runner, mode } = scope;
  const providerSubscriptionId = old.providerSubscriptionId;

  // A pending checkout is always bound (it is bound before it is applied); guard anyway.
  if (providerSubscriptionId === null) return { kind: "NOT_CONFIRMED" };

  const { outcome } = await runner.runChild<ProviderSubscriptionState>(root, {
    kind: "CANCEL_IMMEDIATELY",
    subscriptionId: old.id,
    request: { atCycleEnd: false, reason: "ABANDON_CHECKOUT" },
    call: (provider) => provider.cancelSubscription(providerSubscriptionId, { atCycleEnd: false }),
    settle: async (tx, classified, { operation, effects, now }) => {
      if (classified.kind === "SUCCESS") {
        // A command response goes through the one apply path (SB-CM-05).
        await applyObservationInTransaction(
          tx,
          old.id,
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
      await SyncClaimRepository.markDue(tx, old.id, "COMMAND_CONFIRM", now, { eventDriven: false, now });
    },
  });

  if (outcome.kind === "REJECTED" && outcome.requestSentAt === null) return { kind: "NOT_SENT", outcome };

  const observed = await runner.confirmTerminal(old.id);

  return observed.confirmed ? { kind: "CONFIRMED" } : { kind: "NOT_CONFIRMED" };
}
