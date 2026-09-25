/**
 * Billing — BillingOperation Persistence
 *
 * The durable answer to "did Kizunia ask Razorpay to do this, and what
 * happened?" (docs/architecture/subscription/commands/operation-model.md).
 * An operation is an audit record: it is never deleted, and never rewritten
 * except through the status transitions
 *
 *   IN_FLIGHT -> SUCCEEDED | REJECTED | OUTCOME_UNKNOWN
 *   OUTCOME_UNKNOWN -> SUCCEEDED | NOT_APPLIED
 *
 * At most one IN_FLIGHT *root* operation exists per user. That is a database
 * fact (the partial unique index `billing_operation_userId_in_flight_root_key`,
 * IB-6), never a read-then-insert check: the insert is attempted and the
 * unique violation is the answer.
 */
import type { Prisma, ProviderMode } from "@/generated/prisma";

import { logBillingEvent } from "../../observability/log";
import { SyncClaimRepository } from "../sync/claim.repository";

type Tx = Prisma.TransactionClient;

export class BillingOperationRepository {
  /**
   * An IN_FLIGHT operation whose lease lapsed died with its outcome unknown (a
   * crash after the request may have left). It becomes OUTCOME_UNKNOWN, and its
   * subscription is marked due so the next observation settles it (SB-CM-03).
   * The tick runs this for every user of a mode; a command's first
   * transaction runs it for its own user (the cheap self-heal).
   *
   * A bound subscription is marked due; an unbound PROVISIONING one cannot be
   * (there is nothing to fetch) and is resolved by a webhook or orphan scan.
   */
  static async expireLapsed(
    tx: Tx,
    options: { readonly mode: ProviderMode; readonly userId?: string; readonly now: Date },
  ): Promise<number> {
    const { mode, userId, now } = options;
    const lapsed = await tx.billingOperation.findMany({
      where: { providerMode: mode, status: "IN_FLIGHT", leaseUntil: { lt: now }, ...(userId && { userId }) },
      select: { id: true, subscriptionId: true },
    });

    if (lapsed.length === 0) return 0;

    await tx.billingOperation.updateMany({
      where: { id: { in: lapsed.map((op) => op.id) }, status: "IN_FLIGHT" },
      data: { status: "OUTCOME_UNKNOWN" },
    });

    for (const subscriptionId of new Set(lapsed.flatMap((op) => (op.subscriptionId ? [op.subscriptionId] : [])))) {
      await SyncClaimRepository.markDue(tx, subscriptionId, "COMMAND_CONFIRM", now, { eventDriven: true, now });
    }

    logBillingEvent("command.outcome_unknown", {
      mode,
      count: lapsed.length,
      cause: "lease_lapsed",
      ...(userId && { userId }),
      operationIds: lapsed.map((op) => op.id),
    });

    return lapsed.length;
  }
}
