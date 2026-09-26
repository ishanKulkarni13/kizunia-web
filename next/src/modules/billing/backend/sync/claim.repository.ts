/**
 * Billing — Sync-Due Marker and Claims
 *
 * The subscription row *is* the work item (SB-RC-04). Anything that learns a
 * subscription may have changed marks it due; a worker claims due rows with a
 * lease, fetches outside any transaction, and applies. The claim is the
 * notification work queue's pattern (`FOR UPDATE SKIP LOCKED` plus a lease)
 * with two differences: the work item is the subscription itself, and there is
 * no attempt cap, since a billing sync is never abandoned (SB-RC-07).
 *
 * **Mark due** is one idempotent write, always inside the transaction that
 * records its cause:
 *
 *   syncDueAt       := LEAST(COALESCE(syncDueAt, +infinity), at)   -- a burst coalesces into one fetch
 *   syncReason      := reason
 *   syncRequestedAt := now                                          -- event-driven triggers only
 *
 * A terminal row is never marked (the database CHECK forbids a due terminal
 * row), nor a row with no provider ID (there is nothing to fetch; orphan
 * discovery resolves it).
 *
 * **Claims** are exclusive: two workers never hold the same row, and a lease
 * that lapsed (a crashed worker, a slow provider) is claimable again. The
 * batch claim takes only rows of the current provider mode that are due; the
 * targeted claim (webhook `after()`, admin "sync now") takes one row by id,
 * due or not, whatever its mode, so the caller can detect a mode mismatch.
 *
 * Raw SQL, following the documented hazards (see `../sql.ts`).
 */
import {
  ProviderMode as ProviderModeEnum,
  Prisma,
  SyncReason as SyncReasonEnum,
  type PrismaClient,
  type ProviderMode,
  type SubscriptionPhase,
  type SyncReason,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { enumLiteral, utc } from "../sql";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ClaimedSubscription {
  readonly id: string;
  readonly providerSubscriptionId: string;
  readonly providerMode: ProviderMode;
  readonly phase: SubscriptionPhase;
  readonly syncReason: SyncReason | null;
  readonly syncDueAt: Date | null;
  readonly syncAttempts: number;
}

const TERMINAL = Prisma.raw(
  `('CANCELLED'::"public"."SubscriptionPhase", 'EXPIRED'::"public"."SubscriptionPhase", ` +
    `'COMPLETED'::"public"."SubscriptionPhase", 'ABANDONED'::"public"."SubscriptionPhase")`,
);

const RETURNING = Prisma.sql`
  RETURNING s."id", s."providerSubscriptionId", s."providerMode"::text AS "providerMode",
            s."phase"::text AS "phase", s."syncReason"::text AS "syncReason", s."syncDueAt", s."syncAttempts"`;

export interface MarkDueOptions {
  /** Webhook, confirmation or admin: records `syncRequestedAt` so an in-flight fetch cannot swallow it. */
  readonly eventDriven: boolean;
  readonly now: Date;
}

export interface BulkMarkDueOptions {
  readonly mode: ProviderMode;
  /** Only rows last synced before this (or never). */
  readonly lastSyncedBefore?: Date;
  readonly now: Date;
  readonly batchSize: number;
  readonly dryRun?: boolean;
  readonly db?: Db;
}

export interface BulkMarkDueResult {
  readonly matched: number;
  readonly marked: number;
}

export class SyncClaimRepository {
  /** Marks a subscription due at `at` (or keeps an earlier due time). Returns whether a row was marked. */
  static async markDue(
    db: Db,
    subscriptionId: string,
    reason: SyncReason,
    at: Date,
    options: MarkDueOptions,
  ): Promise<boolean> {
    const requested = options.eventDriven ? utc(options.now) : Prisma.sql`"syncRequestedAt"`;

    const count = await db.$executeRaw(Prisma.sql`
      UPDATE "public"."subscription"
      SET "syncDueAt" = LEAST(COALESCE("syncDueAt", 'infinity'::timestamp), ${utc(at)}),
          "syncReason" = ${enumLiteral(reason, SyncReasonEnum, "SyncReason")},
          "syncRequestedAt" = ${requested},
          "updatedAt" = ${utc(options.now)}
      WHERE "id" = ${subscriptionId}
        AND "providerSubscriptionId" IS NOT NULL
        AND "phase" NOT IN ${TERMINAL}`);

    return count > 0;
  }

  /**
   * Bulk re-sync (Phase VIII, IB-28 item 3): marks every bound, non-terminal
   * subscription of `mode` due now, optionally only those last synced before
   * `lastSyncedBefore` (a never-synced row counts as older than any time).
   * The same rules as `markDue`, in bounded keyset batches of one short
   * statement each, so no long transaction and no long lock.
   *
   *  - `syncDueAt` keeps an earlier due time (`LEAST`).
   *  - `syncReason` becomes `ADMIN` unless the row is already due: a pending
   *    `WEBHOOK` or `CHECKOUT_CONFIRM` (drained at priority 2) is never demoted
   *    to priority 3. `syncRequestedAt` is untouched (not event-driven).
   *  - Nothing is fetched. The rows drain through `billing:sync`, which spends
   *    the priority-3 budget.
   *
   * `dryRun` counts the matches and writes nothing. `matched` is what the
   * filter selected; `marked` what was written (a row that turned terminal
   * between the select and the update is not marked).
   */
  static async markDueBulk(options: BulkMarkDueOptions): Promise<BulkMarkDueResult> {
    const { mode, lastSyncedBefore, now, batchSize } = options;
    const db = options.db ?? prisma;

    const matching = Prisma.sql`
      "providerMode" = ${enumLiteral(mode, ProviderModeEnum, "ProviderMode")}
      AND "providerSubscriptionId" IS NOT NULL
      AND "phase" NOT IN ${TERMINAL}
      ${
        lastSyncedBefore
          ? Prisma.sql`AND ("lastSyncedAt" IS NULL OR "lastSyncedAt" < ${utc(lastSyncedBefore)})`
          : Prisma.empty
      }`;

    if (options.dryRun) {
      const [row] = await db.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) AS "count" FROM "public"."subscription" WHERE ${matching}`,
      );

      return { matched: Number(row.count), marked: 0 };
    }

    let matched = 0;
    let marked = 0;
    let cursor = "";

    for (;;) {
      const batch = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "public"."subscription"
        WHERE ${matching} AND "id" > ${cursor}
        ORDER BY "id" ASC
        LIMIT ${batchSize}`);

      if (batch.length === 0) break;

      const ids = batch.map((row) => row.id);
      cursor = ids[ids.length - 1];
      matched += ids.length;

      // The predicate is repeated so a row that changed since the select is re-checked.
      marked += await db.$executeRaw(Prisma.sql`
        UPDATE "public"."subscription"
        SET "syncReason" = CASE
              WHEN "syncDueAt" IS NOT NULL AND "syncDueAt" <= ${utc(now)} THEN "syncReason"
              ELSE ${enumLiteral("ADMIN", SyncReasonEnum, "SyncReason")}
            END,
            "syncDueAt" = LEAST(COALESCE("syncDueAt", 'infinity'::timestamp), ${utc(now)}),
            "updatedAt" = ${utc(now)}
        WHERE "id" = ANY(${ids}::text[]) AND ${matching}`);

      if (batch.length < batchSize) break;
    }

    return { matched, marked };
  }

  /** Claims up to `limit` due rows of `mode`, oldest due first. */
  static async claimDue(
    mode: ProviderMode,
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<ClaimedSubscription[]> {
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);

    const rows = await prisma.$queryRaw<ClaimedSubscription[]>(Prisma.sql`
      WITH candidate AS (
        SELECT c."id" FROM "public"."subscription" AS c
        WHERE c."providerMode" = ${enumLiteral(mode, ProviderModeEnum, "ProviderMode")}
          AND c."syncDueAt" <= ${utc(now)}
          AND c."providerSubscriptionId" IS NOT NULL
          AND (c."syncLeaseUntil" IS NULL OR c."syncLeaseUntil" < ${utc(now)})
        ORDER BY c."syncDueAt" ASC, c."id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "public"."subscription" AS s
      SET "syncLeaseUntil" = ${utc(leaseUntil)}, "updatedAt" = ${utc(now)}
      FROM candidate WHERE s."id" = candidate."id"
      ${RETURNING}`);

    // RETURNING does not keep the candidate order; the batch is worked oldest first.
    return rows.sort(
      (a, b) => (a.syncDueAt?.getTime() ?? 0) - (b.syncDueAt?.getTime() ?? 0) || a.id.localeCompare(b.id),
    );
  }

  /**
   * Claims one row by id, due or not and in any mode, unless another worker
   * holds its lease. `null` when it is leased elsewhere or cannot be fetched.
   */
  static async claimOne(subscriptionId: string, now: Date, leaseSeconds: number): Promise<ClaimedSubscription | null> {
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);

    const rows = await prisma.$queryRaw<ClaimedSubscription[]>(Prisma.sql`
      WITH candidate AS (
        SELECT c."id" FROM "public"."subscription" AS c
        WHERE c."id" = ${subscriptionId}
          AND c."providerSubscriptionId" IS NOT NULL
          AND (c."syncLeaseUntil" IS NULL OR c."syncLeaseUntil" < ${utc(now)})
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "public"."subscription" AS s
      SET "syncLeaseUntil" = ${utc(leaseUntil)}, "updatedAt" = ${utc(now)}
      FROM candidate WHERE s."id" = candidate."id"
      ${RETURNING}`);

    return rows[0] ?? null;
  }

  /** Gives rows back without touching their due time (claimed but not fetched). */
  static async releaseLease(subscriptionIds: readonly string[], now: Date): Promise<void> {
    if (subscriptionIds.length === 0) return;

    await prisma.subscription.updateMany({
      where: { id: { in: [...subscriptionIds] } },
      data: { syncLeaseUntil: null, updatedAt: now },
    });
  }

  /** How much is due now in `mode`, and since when. */
  static async dueBacklog(mode: ProviderMode, now: Date): Promise<{ remainingDue: number; oldestDueAt: Date | null }> {
    const where = {
      providerMode: mode,
      syncDueAt: { lte: now },
      providerSubscriptionId: { not: null },
    } satisfies Prisma.SubscriptionWhereInput;

    const [remainingDue, oldest] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findFirst({ where, orderBy: { syncDueAt: "asc" }, select: { syncDueAt: true } }),
    ]);

    return { remainingDue, oldestDueAt: oldest?.syncDueAt ?? null };
  }
}
