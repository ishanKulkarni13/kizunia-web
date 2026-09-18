/**
 * Notifications — Postgres Work Queue
 *
 * Database Layer
 *
 * The only implementation of `WorkQueue`, and the only file in this module that
 * writes raw SQL. Both facts are deliberate: claiming has to be one atomic
 * statement, which the query builder cannot express, and confining that to one
 * file keeps the rest of the subsystem in typed Prisma calls.
 *
 * Responsibilities
 * ----------------
 * ✓ Store, claim, complete, fail, reschedule and prune job rows
 * ✓ Enforce exclusivity and lease expiry at the database
 *
 * Does NOT
 * ----------------
 * ✗ Decide what a job means, when to retry it, or whether a failure is fatal
 * ✗ Validate payloads — the runner does that against the kind's schema
 * ✗ Know anything about notifications, delivery or intents
 *
 * ## How claiming works
 *
 * One statement. A CTE selects due rows with `FOR UPDATE SKIP LOCKED`, and the
 * enclosing `UPDATE` marks them claimed. `SKIP LOCKED` is what makes concurrent
 * executions safe: a second worker running the same statement at the same
 * instant simply passes over the rows the first is taking, rather than blocking
 * behind them or — far worse — taking them too.
 *
 * ## Why `runAt` is pushed to the lease expiry on claim
 *
 * "Due" then means exactly one thing: `runAt <= now`. A pending job is due at
 * its scheduled time; a claimed job becomes due again the moment its lease
 * lapses, which is precisely the crash-recovery condition. One predicate, one
 * index, and no separate recovery sweep to forget to run.
 *
 * ## Raw SQL hazards, all of which apply here
 *
 * - **Enum literals are cast, never parameterised.** Prisma binds string
 *   parameters as `text`, and `enum_column = $1` raises
 *   `operator does not exist`.
 * - **`updatedAt` is written explicitly.** `@updatedAt` is applied by the
 *   Prisma client; raw SQL bypasses it entirely and the non-null column would
 *   silently keep a stale value.
 * - **`$queryRaw`, not `$executeRaw`** — the latter discards `RETURNING`.
 * - **`ORDER BY "runAt", "id"`** — the id tiebreak makes claim order
 *   deterministic under ties, which is what lets the concurrency test assert
 *   anything reproducible.
 *
 * Column names in this schema are camelCase (only tables are mapped to
 * snake_case), so raw rows need no key remapping — but every identifier has to
 * be double-quoted.
 */
import { Prisma, type NotificationJobKind } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type {
  ClaimJobsInput,
  ClaimedJob,
  EnqueueJobInput,
  EnqueueManyResult,
  EnqueueResult,
  FailJobInput,
  RescheduleJobInput,
  WorkQueue,
} from "./work-queue.port";

/** Prisma's code for a unique-constraint violation. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Binds a `Date` so it compares correctly against a `timestamp` column.
 *
 * **This is not optional, and getting it wrong is silent.** Prisma's `DateTime`
 * columns are `timestamp` — no time zone, storing the UTC wall clock — but the
 * driver binds a JS `Date` parameter as `timestamptz`. Comparing the two makes
 * Postgres convert the column value using the **session** time zone, so on any
 * server not running in UTC the comparison is wrong by that offset, in silence.
 *
 * Observed concretely on a server set to `Asia/Calcutta`: a job scheduled one
 * minute in the future was claimed immediately, because its stored value was
 * reinterpreted five and a half hours earlier. Nothing errors; work simply runs
 * at the wrong time.
 *
 * This renders the instant as UTC text, parses it as `timestamptz`, then
 * flattens it back to a naive UTC `timestamp` — the exact representation the
 * column holds, whatever the session is set to. It stays a constant expression,
 * so the index is still usable.
 *
 * The Prisma query builder handles this correctly on its own; only raw SQL is
 * exposed, which is one more reason raw SQL lives in this file alone.
 */
function utc(value: Date) {
  return Prisma.sql`${value.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
}

interface ClaimedJobRow {
  id: string;
  kind: string;
  dedupeKey: string;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  payload: Prisma.JsonValue;
  leaseExpiresAt: Date | null;
}

export class PostgresWorkQueue implements WorkQueue {
  async enqueue(input: EnqueueJobInput): Promise<EnqueueResult> {
    try {
      await prisma.notificationJob.create({
        data: {
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          runAt: input.runAt,
          maxAttempts: input.maxAttempts,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });

      return { created: true };
    } catch (error) {
      // An existing dedupe key means this work is already scheduled, which is
      // the state the caller wanted. Swallowing it here is what makes a
      // duplicate scheduler run harmless (ND-D-06).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return { created: false };
      }

      throw error;
    }
  }

  async enqueueMany(
    inputs: readonly EnqueueJobInput[],
  ): Promise<EnqueueManyResult> {
    if (inputs.length === 0) return { created: 0, duplicates: 0 };

    // `skipDuplicates` turns the whole batch into one statement that cannot
    // fail on a key that already exists — the alternative, inserting one row at
    // a time to catch violations individually, is a round trip per user.
    const result = await prisma.notificationJob.createMany({
      data: inputs.map((input) => ({
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        runAt: input.runAt,
        maxAttempts: input.maxAttempts,
        payload: input.payload as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });

    return {
      created: result.count,
      duplicates: inputs.length - result.count,
    };
  }

  async claim(input: ClaimJobsInput): Promise<readonly ClaimedJob[]> {
    const { now, limit, leaseSeconds, owner } = input;

    if (limit <= 0) return [];

    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

    const rows = await prisma.$queryRaw<ClaimedJobRow[]>(Prisma.sql`
      WITH candidate AS (
        SELECT j."id"
        FROM "public"."notification_job" AS j
        WHERE j."attempts" < j."maxAttempts"
          AND j."runAt" <= ${utc(now)}
          AND j."status" IN (
            'PENDING'::"public"."NotificationJobStatus",
            'PROCESSING'::"public"."NotificationJobStatus"
          )
        ORDER BY j."runAt" ASC, j."id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "public"."notification_job" AS j
      SET "status"         = 'PROCESSING'::"public"."NotificationJobStatus",
          "attempts"       = j."attempts" + 1,
          "leaseOwner"     = ${owner},
          "leaseExpiresAt" = ${utc(leaseExpiresAt)},
          "runAt"          = ${utc(leaseExpiresAt)},
          "updatedAt"      = ${utc(now)}
      FROM candidate AS c
      WHERE j."id" = c."id"
      RETURNING j."id",
                j."kind"::text AS "kind",
                j."dedupeKey",
                j."runAt",
                j."attempts",
                j."maxAttempts",
                j."payload",
                j."leaseExpiresAt";
    `);

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as NotificationJobKind,
      dedupeKey: row.dedupeKey,
      runAt: row.runAt,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      payload: row.payload,
      leaseExpiresAt: row.leaseExpiresAt,
    }));
  }

  async complete(jobId: string, now: Date): Promise<void> {
    await prisma.notificationJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  async fail(input: FailJobInput): Promise<void> {
    const terminal = input.retryAt === null;

    await prisma.notificationJob.update({
      where: { id: input.jobId },
      data: {
        status: terminal ? "FAILED" : "PENDING",
        // `completedAt` means "finished", not "succeeded". A terminally failed
        // job is finished, and stamping it here is what makes it prunable on
        // the same horizon as a successful one.
        completedAt: terminal ? input.now : null,
        runAt: input.retryAt ?? undefined,
        leaseOwner: null,
        leaseExpiresAt: null,
        // Truncated: a stack trace from a driver can be enormous, and this
        // column exists to orient a human, not to be a log sink.
        lastError: input.error.slice(0, 2000),
      },
    });
  }

  async reschedule(input: RescheduleJobInput): Promise<void> {
    await prisma.notificationJob.update({
      where: { id: input.jobId },
      data: {
        status: "PENDING",
        runAt: input.runAt,
        payload: input.payload as Prisma.InputJsonValue,
        leaseOwner: null,
        leaseExpiresAt: null,
        // Not an attempt. Continuing partway through a large workload is
        // progress, and charging it an attempt would cap how much work a job
        // can do rather than how many times it may fail.
      },
    });
  }

  async reapExpired(now: Date): Promise<number> {
    const result = await prisma.notificationJob.updateMany({
      where: {
        status: "PROCESSING",
        leaseExpiresAt: { lt: now },
        // Only jobs with nothing left to try. Anything under its limit is
        // reclaimable by `claim`, and reaping it would throw away a retry the
        // caller is entitled to.
        attempts: { gte: prisma.notificationJob.fields.maxAttempts },
      },
      data: {
        status: "FAILED",
        completedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    return result.count;
  }

  async prune(before: Date, limit: number): Promise<number> {
    // Two statements rather than one `deleteMany`: Prisma cannot put a LIMIT on
    // a delete, and an unbounded delete over a large backlog is exactly the
    // long-running statement a prune pass is supposed to avoid.
    const doomed = await prisma.notificationJob.findMany({
      where: {
        status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
        completedAt: { lt: before },
      },
      select: { id: true },
      take: limit,
    });

    if (doomed.length === 0) return 0;

    const result = await prisma.notificationJob.deleteMany({
      where: { id: { in: doomed.map((job) => job.id) } },
    });

    return result.count;
  }
}

/**
 * The queue every caller uses.
 *
 * A module-level singleton in the same style as `rateLimitService`: it holds no
 * per-request state, and the alternative — constructing one per call site —
 * would only spread the choice of implementation across the codebase, which is
 * the thing the port exists to prevent.
 */
export const workQueue: WorkQueue = new PostgresWorkQueue();
