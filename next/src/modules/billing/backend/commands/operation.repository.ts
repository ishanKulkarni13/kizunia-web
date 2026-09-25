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
import type {
  BillingActorKind,
  BillingOperation,
  BillingOperationKind,
  Prisma,
  PrismaClient,
  ProviderFailureClass,
  ProviderMode,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { logBillingEvent } from "../../observability/log";
import { AnomalySubject } from "../anomalies/anomaly.repository";
import { SyncClaimRepository } from "../sync/claim.repository";

type Tx = Prisma.TransactionClient;

export interface NewOperation {
  readonly userId: string;
  readonly kind: BillingOperationKind;
  readonly providerMode: ProviderMode;
  readonly actorKind: BillingActorKind;
  readonly actorUserId: string | null;
  readonly idempotencyKey: string;
  readonly request: Prisma.InputJsonValue;
  readonly subscriptionId?: string | null;
  readonly parentOperationId?: string | null;
  readonly leaseUntil: Date;
  /** The command's clock, so the outcome-unknown window and the lease agree with it. */
  readonly createdAt: Date;
}

/** How a settle transaction closes an operation. */
export type OperationSettlement =
  | { readonly status: "SUCCEEDED"; readonly requestSentAt: Date }
  | {
      readonly status: "REJECTED";
      /** `null` for a local refusal: nothing was sent (IB-25 item 3). */
      readonly failureClass: ProviderFailureClass | null;
      readonly requestSentAt: Date | null;
      readonly providerErrorCode?: string | null;
      readonly providerErrorDescription?: string | null;
    }
  | {
      readonly status: "OUTCOME_UNKNOWN";
      readonly failureClass: ProviderFailureClass;
      readonly requestSentAt: Date;
      readonly providerErrorCode?: string | null;
      readonly providerErrorDescription?: string | null;
    };

export class BillingOperationRepository {
  /**
   * Inserts an operation. For a root, a unique violation means either the
   * user's in-flight slot is taken or the idempotency key was used by a racing
   * request; the caller tells them apart by re-reading the key after the
   * transaction has rolled back (a failed statement aborts it).
   */
  static insert(tx: Tx, operation: NewOperation): Promise<BillingOperation> {
    return tx.billingOperation.create({
      data: {
        userId: operation.userId,
        kind: operation.kind,
        status: "IN_FLIGHT",
        providerMode: operation.providerMode,
        actorKind: operation.actorKind,
        actorUserId: operation.actorUserId,
        idempotencyKey: operation.idempotencyKey,
        request: operation.request,
        subscriptionId: operation.subscriptionId ?? null,
        parentOperationId: operation.parentOperationId ?? null,
        leaseUntil: operation.leaseUntil,
        createdAt: operation.createdAt,
      },
    });
  }

  static findByKey(userId: string, idempotencyKey: string): Promise<BillingOperation | null> {
    return prisma.billingOperation.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
  }

  /** The user's in-flight root operation, if any (at most one exists). */
  static findInFlightRoot(userId: string): Promise<BillingOperation | null> {
    return prisma.billingOperation.findFirst({ where: { userId, status: "IN_FLIGHT", parentOperationId: null } });
  }

  /**
   * An `OUTCOME_UNKNOWN` operation younger than the resolution window blocks
   * the user's new commands: "your last billing change is still being
   * confirmed" (operation-model.md).
   */
  static async hasYoungUnknown(tx: Tx, userId: string, mode: ProviderMode, since: Date): Promise<boolean> {
    const count = await tx.billingOperation.count({
      where: { userId, providerMode: mode, status: "OUTCOME_UNKNOWN", createdAt: { gte: since } },
    });

    return count > 0;
  }

  /** An unresolved `MULTIPLE_OPEN_SUBSCRIPTIONS` anomaly pauses the user's self-serve commands (SB-UQ-05). */
  static async hasOpenMultipleSubscriptionsAnomaly(tx: Tx | PrismaClient, userId: string, mode: ProviderMode): Promise<boolean> {
    const count = await tx.billingAnomaly.count({
      where: {
        type: "MULTIPLE_OPEN_SUBSCRIPTIONS",
        providerMode: mode,
        subjectKey: AnomalySubject.user(userId),
        resolvedAt: null,
      },
    });

    return count > 0;
  }

  /**
   * Closes an operation that is still open (`IN_FLIGHT`, or `OUTCOME_UNKNOWN`
   * when its lease lapsed under a slow call). Returns `false` when another path
   * settled it first (a webhook or orphan scan that bound the create); the
   * caller then leaves it as that path decided.
   */
  static async settle(tx: Tx, operationId: string, settlement: OperationSettlement, now: Date): Promise<boolean> {
    const { count } = await tx.billingOperation.updateMany({
      where: { id: operationId, status: { in: ["IN_FLIGHT", "OUTCOME_UNKNOWN"] } },
      data: {
        status: settlement.status,
        requestSentAt: settlement.requestSentAt,
        leaseUntil: null,
        ...(settlement.status !== "OUTCOME_UNKNOWN" && { resolvedAt: now }),
        ...(settlement.status !== "SUCCEEDED" && {
          failureClass: settlement.failureClass,
          providerErrorCode: settlement.providerErrorCode ?? null,
          providerErrorDescription: settlement.providerErrorDescription ?? null,
        }),
      },
    });

    return count > 0;
  }

  /**
   * Refuses a root that is still IN_FLIGHT without having sent anything (a
   * composed command stopping before its own call). `false` when it is no
   * longer IN_FLIGHT.
   */
  static async rejectInFlight(
    tx: Tx,
    operationId: string,
    failureClass: ProviderFailureClass | null,
    now: Date,
  ): Promise<boolean> {
    const { count } = await tx.billingOperation.updateMany({
      where: { id: operationId, status: "IN_FLIGHT" },
      data: { status: "REJECTED", failureClass, resolvedAt: now, leaseUntil: null },
    });

    return count > 0;
  }

  /**
   * Resolves an `OUTCOME_UNKNOWN` operation whose request provably never took
   * effect (an orphan window closed without a match, or a create root whose
   * create was never sent).
   */
  static async resolveNotApplied(tx: Tx, operationId: string, now: Date): Promise<boolean> {
    const { count } = await tx.billingOperation.updateMany({
      where: { id: operationId, status: "OUTCOME_UNKNOWN" },
      data: { status: "NOT_APPLIED", resolvedAt: now, leaseUntil: null },
    });

    return count > 0;
  }

  /**
   * Extends a live root's lease before a later step of a composed command, so
   * a long request never loses its slot while it still has a call to make.
   * `false` when the lease already lapsed (the slot is no longer this
   * request's, and nothing further may be sent).
   */
  static async renewLease(tx: Tx, operationId: string, leaseUntil: Date, now: Date): Promise<boolean> {
    const { count } = await tx.billingOperation.updateMany({
      where: { id: operationId, status: "IN_FLIGHT", leaseUntil: { gte: now } },
      data: { leaseUntil },
    });

    return count > 0;
  }

  /** Links a root to the Subscription its command created (a one-time fill of a null reference, IB-25 item 4). */
  static async linkSubscription(tx: Tx, operationId: string, subscriptionId: string): Promise<void> {
    await tx.billingOperation.updateMany({
      where: { id: operationId, subscriptionId: null },
      data: { subscriptionId },
    });
  }

  static children(parentOperationId: string): Promise<BillingOperation[]> {
    return prisma.billingOperation.findMany({ where: { parentOperationId }, orderBy: { createdAt: "asc" } });
  }

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
