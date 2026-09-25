/**
 * Billing — Subscription History
 *
 * One `SubscriptionHistoryEntry` per access-relevant change Kizunia applies,
 * written in the same transaction as the change
 * (docs/architecture/subscription/history-and-audit/subscription-history.md).
 * It records what Kizunia *decided*, including changes no webhook reported, so
 * it is never rebuilt by replaying events.
 *
 * Two questions, kept apart:
 *
 *  - **cause**: who changed it. `KIZUNIA_COMMAND` when the observation settles
 *    one of Kizunia's operations, `PROVIDER_OBSERVED` for a change made at
 *    Razorpay (Dashboard, customer, renewal), `LOCAL` for a local-only one.
 *  - **trigger**: how Kizunia found out (webhook, checkpoint, heartbeat, retry,
 *    admin sync, …).
 *
 * Append-only: history is never updated or deleted.
 */
import type {
  HistoryCause,
  HistoryChange,
  HistoryTrigger,
  Prisma,
  PrismaClient,
  SubscriptionPhase,
  SyncReason,
} from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export interface HistoryEntryInput {
  readonly subscriptionId: string;
  readonly userId: string | null;
  readonly change: HistoryChange;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly cause: HistoryCause;
  readonly trigger: HistoryTrigger;
  readonly operationId?: string | null;
  readonly billingEventId?: string | null;
  readonly actorUserId?: string | null;
  /** The provider request send time the change was derived from. */
  readonly observationAt?: Date | null;
}

/** How Kizunia found out, from why the sync was due. */
export function historyTriggerFor(reason: SyncReason | null): HistoryTrigger {
  switch (reason) {
    case "WEBHOOK":
      return "WEBHOOK";
    case "CHECKOUT_CONFIRM":
      return "CHECKOUT_CONFIRM";
    case "COMMAND_CONFIRM":
      return "COMMAND_CONFIRM";
    case "CHECKPOINT":
      return "CHECKPOINT";
    case "HEARTBEAT":
      return "HEARTBEAT";
    case "RETRY":
      return "RETRY";
    case "ADMIN":
      return "ADMIN_SYNC";
    default:
      return "SYSTEM";
  }
}

export class SubscriptionHistoryRepository {
  static async record(db: Db, entries: readonly HistoryEntryInput[]): Promise<void> {
    if (entries.length === 0) return;

    await db.subscriptionHistoryEntry.createMany({
      data: entries.map((entry) => ({
        subscriptionId: entry.subscriptionId,
        userId: entry.userId,
        change: entry.change,
        fromValue: entry.fromValue,
        toValue: entry.toValue,
        cause: entry.cause,
        trigger: entry.trigger,
        operationId: entry.operationId ?? null,
        billingEventId: entry.billingEventId ?? null,
        actorUserId: entry.actorUserId ?? null,
        observationAt: entry.observationAt ?? null,
      })),
    });
  }

  /**
   * When the subscription entered `phase`, from its latest phase entry to it:
   * the observation time when known, else when it was recorded. `null` when no
   * entry exists (for example a row written before history existed).
   */
  static async phaseEnteredAt(db: Db, subscriptionId: string, phase: SubscriptionPhase): Promise<Date | null> {
    const entry = await db.subscriptionHistoryEntry.findFirst({
      where: { subscriptionId, change: "PHASE", toValue: phase },
      orderBy: { recordedAt: "desc" },
      select: { observationAt: true, recordedAt: true },
    });

    return entry ? (entry.observationAt ?? entry.recordedAt) : null;
  }

  /**
   * The event behind a webhook-triggered sync: the latest event linked to the
   * subscription that was received no later than the observation was sent.
   */
  static async triggeringEventId(db: Db, subscriptionId: string, notAfter: Date): Promise<string | null> {
    const event = await db.billingEvent.findFirst({
      where: { subscriptionId, receivedAt: { lte: notAfter } },
      orderBy: { receivedAt: "desc" },
      select: { id: true },
    });

    return event?.id ?? null;
  }
}
