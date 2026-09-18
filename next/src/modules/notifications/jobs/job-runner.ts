/**
 * Notifications — Job Runner
 *
 * Business Layer
 *
 * Claims a bounded batch of due work, dispatches each job to its handler, and
 * records the outcome. Knows nothing about HTTP, Vercel, or cron — it is as
 * callable from a test or an admin action as from a scheduled request.
 *
 * Responsibilities
 * ----------------
 * ✓ Claim under a lease, within a wall-clock budget
 * ✓ Validate each payload before a handler sees it
 * ✓ Classify failures and schedule retries
 * ✓ Keep one job's failure from affecting any other
 *
 * Does NOT
 * ----------------
 * ✗ Decide what any job means
 * ✗ Know how work is stored or claimed — that is behind `WorkQueue`
 * ✗ Read the clock for a domain decision
 *
 * ## Fault isolation
 *
 * Every job is processed inside its own try/catch (NFR-1). One user's
 * evaluation failing must not abandon the other 1,999 in the batch — that is
 * the difference between a bad day for one user and a bad day for everyone,
 * and it is the single most important property of this loop.
 *
 * ## The budget
 *
 * The loop stops claiming when there is not enough time left to finish another
 * batch safely, and reports `hasMore`. It does not try to finish the queue:
 * being killed mid-job by a platform timeout is survivable (the lease expires
 * and the job is re-claimed) but it wastes an attempt and delays the work, so
 * stopping cleanly is strictly better.
 */
import { NotificationJobKind } from "@/generated/prisma";

import { JOB_CONFIG } from "../config/notification-config";
import { logNotificationEvent } from "../observability/log";
import { nextAttemptAt, type BackoffPolicy } from "./backoff";
import { describeFailure, isPermanentFailure } from "./job-error";
import { parseJobPayload } from "./job-payload";
import type { JobHandler, JobHandlerRegistry, JobResult } from "./handler";
import type { ClaimedJob, WorkQueue } from "./work-queue.port";

const JOB_BACKOFF: BackoffPolicy = {
  baseSeconds: JOB_CONFIG.backoffBaseSeconds,
  factor: JOB_CONFIG.backoffFactor,
  capSeconds: JOB_CONFIG.backoffCapSeconds,
  jitterRatio: JOB_CONFIG.jitterRatio,
};

export interface RunJobsOptions {
  readonly queue: WorkQueue;
  readonly handlers: JobHandlerRegistry;
  /** Defaults to the configured batch size. */
  readonly batchSize?: number;
  readonly leaseSeconds?: number;
  /** Defaults to the configured wall-clock budget. */
  readonly budgetMs?: number;
  /** Identifies this execution in logs and on the leased row. */
  readonly owner?: string;
  /** Injected for tests; production passes nothing. */
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface RunJobsSummary {
  readonly claimed: number;
  readonly completed: number;
  readonly continued: number;
  readonly retried: number;
  readonly failed: number;
  /** True when the loop stopped on its budget rather than on an empty queue. */
  readonly hasMore: boolean;
  readonly reapedExpired: number;
  readonly durationMs: number;
}

function defaultOwner(): string {
  // Identifies the execution for diagnosis only. Correctness comes from the
  // database's exclusivity, never from this being unique — which is just as
  // well, since a serverless platform gives no stable worker identity.
  return `worker-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

export class JobRunner {
  /**
   * Drains due work until the queue is empty or the budget is spent.
   *
   * Always returns a summary. It does not throw for a failed job: a batch in
   * which some jobs failed is a normal outcome that the caller reports as
   * success, because the failures are already durably recorded and scheduled
   * for retry. Only a failure of the queue itself propagates.
   */
  static async run(options: RunJobsOptions): Promise<RunJobsSummary> {
    const {
      queue,
      handlers,
      batchSize = JOB_CONFIG.claimBatchSize,
      leaseSeconds = JOB_CONFIG.leaseSeconds,
      budgetMs = JOB_CONFIG.wallClockBudgetMs,
      owner = defaultOwner(),
      now = () => new Date(),
      random = Math.random,
    } = options;

    const startedAt = Date.now();

    let claimed = 0;
    let completedCount = 0;
    let continuedCount = 0;
    let retried = 0;
    let failed = 0;
    let hasMore = false;

    // Before claiming: retire jobs whose lease lapsed with no attempts left.
    // They are invisible to `claim` but still read as PROCESSING, which is a
    // state nobody can interpret correctly when looking at the table.
    const reapedExpired = await queue.reapExpired(now());

    for (;;) {
      if (Date.now() - startedAt >= budgetMs) {
        // Out of time. Whether work actually remains is unknown, so report
        // conservatively — over-reporting costs one extra empty claim next
        // tick, under-reporting can strand a backlog.
        hasMore = true;
        break;
      }

      const batch = await queue.claim({
        now: now(),
        limit: batchSize,
        leaseSeconds,
        owner,
      });

      if (batch.length === 0) break;

      claimed += batch.length;

      for (const job of batch) {
        const outcome = await this.processOne(job, handlers, queue, now, random);

        if (outcome === "completed") completedCount += 1;
        else if (outcome === "continued") continuedCount += 1;
        else if (outcome === "retried") retried += 1;
        else failed += 1;

        if (Date.now() - startedAt >= budgetMs) {
          // Mid-batch stop. Anything still leased from this batch simply
          // expires and is re-claimed; nothing is lost.
          hasMore = true;
          break;
        }
      }

      if (hasMore) break;

      // Loop until a claim comes back empty — deliberately not "until a batch
      // comes back short".
      //
      // A short batch looks like an empty queue and saves one cheap query, but
      // it is wrong here: handlers enqueue work. Generation enqueues a delivery
      // job; fan-out re-arms its own row for the next page. Stopping on a short
      // batch would defer all of that to the next tick, which on a daily
      // schedule means a push arriving a day after its inbox row, and a
      // fan-out advancing one page per day.
    }

    const summary: RunJobsSummary = {
      claimed,
      completed: completedCount,
      continued: continuedCount,
      retried,
      failed,
      hasMore,
      reapedExpired,
      durationMs: Date.now() - startedAt,
    };

    logNotificationEvent("jobs.drain", { ...summary });

    return summary;
  }

  /**
   * One job, start to finish, with its failure contained.
   *
   * Returns what happened rather than throwing, so the caller's loop cannot be
   * broken by a single bad job.
   */
  private static async processOne(
    job: ClaimedJob,
    handlers: JobHandlerRegistry,
    queue: WorkQueue,
    now: () => Date,
    random: () => number,
  ): Promise<"completed" | "continued" | "retried" | "failed"> {
    try {
      const payload = parseJobPayload(job.kind, job.payload);

      // The registry is exhaustive over NotificationJobKind, so the lookup
      // cannot miss. The cast is because TypeScript cannot narrow the handler
      // and the payload to the same member from a runtime value.
      const handler = handlers[job.kind] as JobHandler<NotificationJobKind>;

      const result: JobResult = await handler({
        job,
        payload,
        now: now(),
        queue,
      });

      if (result.kind === "continued") {
        // The handler re-armed its own row. Touching it here would either
        // complete work that is not finished or double-schedule it.
        logNotificationEvent("jobs.continued", {
          jobId: job.id,
          kind: job.kind,
          attempts: job.attempts,
          detail: result.detail,
        });
        return "continued";
      }

      await queue.complete(job.id, now());

      logNotificationEvent("jobs.completed", {
        jobId: job.id,
        kind: job.kind,
        attempts: job.attempts,
        detail: result.detail,
      });

      return "completed";
    } catch (error) {
      return this.recordFailure(job, queue, now, random, error);
    }
  }

  private static async recordFailure(
    job: ClaimedJob,
    queue: WorkQueue,
    now: () => Date,
    random: () => number,
    error: unknown,
  ): Promise<"retried" | "failed"> {
    const permanent = isPermanentFailure(error);
    const exhausted = job.attempts >= job.maxAttempts;
    const terminal = permanent || exhausted;
    const at = now();

    const retryAt = terminal
      ? null
      : nextAttemptAt(at, job.attempts, JOB_BACKOFF, random);

    try {
      await queue.fail({
        jobId: job.id,
        now: at,
        error: describeFailure(error),
        retryAt,
      });
    } catch (recordingError) {
      // The failure could not even be recorded — the database is probably the
      // thing that failed. The lease still expires, so the job comes back on
      // its own; losing the error message is the only casualty.
      logNotificationEvent("jobs.failure_unrecorded", {
        jobId: job.id,
        kind: job.kind,
        originalError: describeFailure(error),
        recordingError: describeFailure(recordingError),
      });

      return terminal ? "failed" : "retried";
    }

    logNotificationEvent(terminal ? "jobs.failed" : "jobs.retrying", {
      jobId: job.id,
      kind: job.kind,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      permanent,
      exhausted,
      retryAt: retryAt?.toISOString() ?? null,
      error: describeFailure(error),
    });

    return terminal ? "failed" : "retried";
  }
}
