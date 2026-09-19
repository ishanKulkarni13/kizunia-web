import prisma from "@/lib/prisma";

import type { RateLimitIncrementResult, RateLimitStore } from "./store";

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

    if (Math.random() < OPPORTUNISTIC_PRUNE_PROBABILITY) {
      // Best-effort; a failed sweep must never fail the request it rode in on.
      void this.pruneBounded(OPPORTUNISTIC_PRUNE_BATCH_SIZE).catch(() => {});
    }

    return { count: record.count };
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
