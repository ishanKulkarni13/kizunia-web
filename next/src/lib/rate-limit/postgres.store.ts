import { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type {
  RateLimitConditionalIncrementResult,
  RateLimitIncrementResult,
  RateLimitStore,
} from "./store";

/**
 * One in every ~500 increments also runs a small, bounded opportunistic
 * prune. This is what makes cleanup a property of the store rather than of
 * deployment configuration: it cannot be forgotten and cannot silently stop
 * being scheduled, because it isn't scheduled — it rides along with normal
 * traffic. The scheduled sweep (wired separately, see `prune()` below and
 * the cron entry in vercel.json) is the backstop for when traffic is too
 * low for the opportunistic path to keep up.
 */
const OPPORTUNISTIC_PRUNE_PROBABILITY = 1 / 500;

/** Caps a single opportunistic sweep so it can never become the request's dominant cost. */
const OPPORTUNISTIC_PRUNE_BATCH_SIZE = 1_000;

/**
 * Binds a `Date` for raw SQL against a `timestamp(3)` (no time zone) column.
 *
 * The Prisma query builder does this correctly on its own; only raw SQL is
 * exposed. This renders the instant as UTC text, parses it as `timestamptz`,
 * then flattens it back to a naive UTC `timestamp` — the representation the
 * column holds, whatever the session time zone is. It is the same helper
 * `notifications/jobs/postgres-work-queue.ts` uses for its claim query,
 * repeated here so `lib/rate-limit` does not depend on a feature module.
 */
function utc(value: Date) {
  return Prisma.sql`${value.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
}

/**
 * Postgres-backed store. This is the existing `checkRateLimit` counting
 * logic, unchanged in substance: one atomic upsert per increment, correct
 * under concurrency because it is a single `INSERT ... ON CONFLICT DO
 * UPDATE SET count = count + 1`, not a read-then-write.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  async increment(
    key: string,
    expiresAt: Date,
  ): Promise<RateLimitIncrementResult> {
    const record = await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt },
      update: { count: { increment: 1 } },
    });

    this.maybePruneInBackground();

    return { count: record.count };
  }

  /**
   * One atomic statement, correct under any concurrency: the row is created
   * at 1, or incremented only `WHERE count < ceiling`. When the ceiling is
   * already reached the conflict branch updates nothing and `RETURNING` yields
   * no row, which is exactly "refused". There is no read before it, so two
   * callers can never both observe room for the last slot.
   *
   * A fresh key inserts at 1 unconditionally, so a ceiling below 1 is refused
   * before touching the database rather than left to the statement.
   */
  async incrementIfBelow(
    key: string,
    ceiling: number,
    expiresAt: Date,
  ): Promise<RateLimitConditionalIncrementResult> {
    if (ceiling < 1) return { acquired: false };

    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "rate_limit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, ${utc(expiresAt)})
      ON CONFLICT ("key") DO UPDATE
        SET "count" = "rate_limit"."count" + 1
        WHERE "rate_limit"."count" < ${ceiling}
      RETURNING "count"
    `;

    this.maybePruneInBackground();

    const [row] = rows;

    return row ? { acquired: true, count: row.count } : { acquired: false };
  }

  private maybePruneInBackground(): void {
    if (Math.random() < OPPORTUNISTIC_PRUNE_PROBABILITY) {
      // Best-effort; a failed sweep must never fail the request it rode in on.
      void this.pruneBounded(OPPORTUNISTIC_PRUNE_BATCH_SIZE).catch(() => {});
    }
  }

  /** Full sweep. Intended for the scheduled cron entry, not the request path. */
  async prune(): Promise<number> {
    const { count } = await prisma.rateLimit.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    return count;
  }

  /**
   * Deletes at most `batchSize` expired rows. Bounded so an opportunistic
   * sweep triggered mid-request can never turn into an unbounded table scan
   * under a large backlog — `deleteMany` has no `LIMIT`, so this goes
   * through a bounded subquery instead.
   */
  private async pruneBounded(batchSize: number): Promise<number> {
    return prisma.$executeRaw`
      DELETE FROM "rate_limit"
      WHERE "key" IN (
        SELECT "key" FROM "rate_limit"
        WHERE "expiresAt" < NOW()
        LIMIT ${batchSize}
      )
    `;
  }
}
