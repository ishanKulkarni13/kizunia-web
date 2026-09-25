/**
 * Billing — Recording a Failed Sync
 *
 * A failure to observe is never an observation (SB-RC-07): this writes only
 * the sync bookkeeping, never the phase, plan or access.
 *
 *   syncAttempts         += 1
 *   syncDueAt            := now + min(cap, base · 2^(attempts − 1)) · U(0.5, 1.0)   (jittered)
 *   syncReason           := RETRY
 *   lastSyncFailureClass := the class
 *   syncLeaseUntil       := null
 *
 * A subscription is never marked permanently failed: past the cap it is
 * retried at the capped interval indefinitely, and `SYNC_OVERDUE` is raised
 * past a threshold by the caller. A terminal row stays not-due (the CHECK).
 *
 * Used by the apply path (an observation that could not be applied) inside its
 * transaction, and by `SyncService` (a failed fetch) on its own.
 */
import type { Prisma, PrismaClient, ProviderFailureClass, SubscriptionPhase } from "@/generated/prisma";

import { BACKOFF_CONFIG } from "../../config/billing-config";
import { backoffDelaySeconds } from "../../policy/backoff";
import { isTerminalPhase } from "../../policy/state-mapping";

type Db = PrismaClient | Prisma.TransactionClient;

export interface FailedSyncRow {
  readonly id: string;
  readonly phase: SubscriptionPhase;
  readonly syncAttempts: number;
}

export interface RecordedFailure {
  readonly attempts: number;
  readonly nextDueAt: Date | null;
}

export async function recordSyncFailure(
  db: Db,
  row: FailedSyncRow,
  failureClass: ProviderFailureClass,
  now: Date,
  random: () => number = Math.random,
): Promise<RecordedFailure> {
  const attempts = row.syncAttempts + 1;
  const nextDueAt = isTerminalPhase(row.phase)
    ? null
    : new Date(now.getTime() + backoffDelaySeconds(BACKOFF_CONFIG, attempts - 1, random) * 1000);

  await db.subscription.update({
    where: { id: row.id },
    data: {
      syncAttempts: attempts,
      syncDueAt: nextDueAt,
      syncReason: nextDueAt === null ? undefined : "RETRY",
      lastSyncFailureClass: failureClass,
      syncLeaseUntil: null,
    },
  });

  return { attempts, nextDueAt };
}
