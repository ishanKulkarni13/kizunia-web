/**
 * Billing — Binding a Provider Subscription to Its PROVISIONING Record
 *
 * A create writes a `PROVISIONING` Subscription before it calls the provider
 * (SB-CM-02), and carries that record's id in the provider's `notes`. The
 * provider ID is bound to it exactly once (SB-UQ-01), by whichever path learns
 * it first:
 *
 *   COMMAND_RESPONSE   the create's own response, in the command's settle transaction
 *   WEBHOOK            an event for an unknown subscription, matched through `notes`
 *   ORPHAN_DISCOVERY   the windowed list scan, matched through `notes`
 *
 * A bind that finds the record already bound to the same provider ID is not an
 * error — another path simply got there first. Anything else (another mode,
 * another ID, no longer `PROVISIONING`) is refused, and the caller decides what
 * that means (a `NOTES_CONFLICT` for a scan or webhook).
 *
 * The create operation `notes.kz_op` names is settled `SUCCEEDED` here: finding
 * the provider object is the proof its request was applied (SB-CM-03).
 *
 * Runs inside the caller's transaction and takes the row lock. A `P2002` (the
 * provider ID is held by another row) propagates; callers that race on it
 * catch it.
 */
import type { HistoryTrigger, Prisma, ProviderMode } from "@/generated/prisma";

import { SyncClaimRepository } from "./claim.repository";

export interface BindInput {
  readonly mode: ProviderMode;
  readonly providerSubscriptionId: string;
  readonly subscriptionId: string;
  /** `notes.kz_op`, or the command's own operation. */
  readonly operationId: string | null;
  readonly trigger: HistoryTrigger;
  readonly now: Date;
}

export type BindResult =
  | { readonly outcome: "BOUND"; readonly subscriptionId: string; readonly userId: string | null; readonly operationId: string | null }
  | { readonly outcome: "ALREADY_BOUND"; readonly subscriptionId: string; readonly userId: string | null }
  | { readonly outcome: "REFUSED" };

export async function bindProvisioning(tx: Prisma.TransactionClient, input: BindInput): Promise<BindResult> {
  const { mode, providerSubscriptionId, subscriptionId, operationId, trigger, now } = input;

  await tx.$executeRaw`SELECT 1 FROM "public"."subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`;
  const row = await tx.subscription.findUnique({ where: { id: subscriptionId } });

  if (!row || row.providerMode !== mode) return { outcome: "REFUSED" };

  if (row.providerSubscriptionId === providerSubscriptionId) {
    return { outcome: "ALREADY_BOUND", subscriptionId: row.id, userId: row.userId };
  }

  if (row.phase !== "PROVISIONING" || row.providerSubscriptionId !== null) return { outcome: "REFUSED" };

  await tx.subscription.update({ where: { id: row.id }, data: { providerSubscriptionId } });

  const operation = operationId
    ? await tx.billingOperation.findFirst({
        where: { id: operationId, subscriptionId: row.id, kind: "CREATE_SUBSCRIPTION" },
        select: { id: true, status: true },
      })
    : null;

  if (operation && (operation.status === "IN_FLIGHT" || operation.status === "OUTCOME_UNKNOWN")) {
    await tx.billingOperation.update({
      where: { id: operation.id },
      data: { status: "SUCCEEDED", resolvedAt: now },
    });
  }

  await tx.subscriptionHistoryEntry.create({
    data: {
      subscriptionId: row.id,
      userId: row.userId,
      change: "BINDING",
      fromValue: null,
      toValue: providerSubscriptionId,
      cause: operation ? "KIZUNIA_COMMAND" : "LOCAL",
      trigger,
      operationId: operation?.id ?? null,
    },
  });

  // Durable before any apply that follows: if that fails, the tick fetches it.
  await SyncClaimRepository.markDue(tx, row.id, trigger === "WEBHOOK" ? "WEBHOOK" : "COMMAND_CONFIRM", now, {
    eventDriven: true,
    now,
  });

  return { outcome: "BOUND", subscriptionId: row.id, userId: row.userId, operationId: operation?.id ?? null };
}
