/**
 * Notifications — Work Queue Port
 *
 * The seam between "this work should happen" and "this is how work is stored
 * and handed out" (ND-D-10).
 *
 * Everything above this interface — schedulers, handlers, the runner —
 * describes work. Nothing above it knows the work lives in Postgres, is claimed
 * with `SKIP LOCKED`, or is protected by a lease. Replacing the implementation
 * with a broker is a change to one file.
 *
 * ## What an implementation must guarantee
 *
 * 1. **`enqueue` is idempotent on `dedupeKey`.** Enqueueing an existing key is
 *    a no-op reporting `created: false`, not an error. A scheduler that runs
 *    twice must be harmless (ND-D-06).
 * 2. **`claim` is exclusive.** Two concurrent claims never return the same job.
 * 3. **A claim expires.** A worker that dies without completing or failing its
 *    job must leave that job reclaimable, with no operator involved (NFR-2).
 * 4. **An attempt is consumed at claim time, not at completion.** Otherwise a
 *    worker that crashes mid-job never burns an attempt, and the job is
 *    re-claimed forever.
 *
 * Pure types only — no Prisma import, so this file states the contract without
 * implying the storage.
 */
import type { NotificationJobKind } from "@/generated/prisma";

export interface EnqueueJobInput {
  readonly kind: NotificationJobKind;
  /**
   * The job's identity. Two enqueues with the same key are the same job.
   *
   * Conventionally `<kind>:<scope>:<occurrence>` — see `occurrence.ts`.
   */
  readonly dedupeKey: string;
  /** When this becomes eligible to run. The one timing primitive (AD-8). */
  readonly runAt: Date;
  readonly payload: unknown;
  readonly maxAttempts: number;
}

export interface EnqueueResult {
  /** False when the dedupe key already existed — a success, not a failure. */
  readonly created: boolean;
}

export interface EnqueueManyResult {
  readonly created: number;
  /** Keys that already existed. Expected on a re-run, not an error condition. */
  readonly duplicates: number;
}

export interface ClaimJobsInput {
  readonly now: Date;
  readonly limit: number;
  readonly leaseSeconds: number;
  /**
   * Identifies the claiming execution, for diagnosis only. Correctness comes
   * from the database, never from this value being unique.
   */
  readonly owner: string;
}

export interface ClaimedJob {
  readonly id: string;
  readonly kind: NotificationJobKind;
  readonly dedupeKey: string;
  readonly runAt: Date;
  /** Includes the attempt just consumed by this claim. */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Unvalidated. The runner parses it against the kind's schema. */
  readonly payload: unknown;
  readonly leaseExpiresAt: Date | null;
}

export interface FailJobInput {
  readonly jobId: string;
  readonly now: Date;
  readonly error: string;
  /**
   * When to try again, or `null` for a terminal failure.
   *
   * The caller decides, because only the caller knows whether the error was
   * transient, permanent, or simply the last attempt (ND-D-08).
   */
  readonly retryAt: Date | null;
}

export interface RescheduleJobInput {
  readonly jobId: string;
  readonly now: Date;
  readonly runAt: Date;
  /** Replaces the payload — how resumable work advances its own cursor. */
  readonly payload: unknown;
}

export interface WorkQueue {
  enqueue(input: EnqueueJobInput): Promise<EnqueueResult>;

  /** Bulk enqueue. Existing keys are counted, not thrown. */
  enqueueMany(inputs: readonly EnqueueJobInput[]): Promise<EnqueueManyResult>;

  /**
   * Atomically takes up to `limit` due jobs under a lease.
   *
   * "Due" means either pending and past its run time, or claimed by a worker
   * whose lease has expired — the second case is crash recovery, and it is
   * deliberately the same query rather than a separate sweep.
   */
  claim(input: ClaimJobsInput): Promise<readonly ClaimedJob[]>;

  complete(jobId: string, now: Date): Promise<void>;

  fail(input: FailJobInput): Promise<void>;

  /**
   * Returns a job to the queue with a new payload, releasing its lease.
   *
   * This is how work that outlives one execution continues: it re-arms its own
   * row with an advanced cursor. It cannot enqueue a successor instead — the
   * successor would carry the same dedupe key as the row creating it, and
   * collide with itself.
   *
   * Does not consume an attempt. Continuing is progress, not a retry.
   */
  reschedule(input: RescheduleJobInput): Promise<void>;

  /**
   * Marks jobs whose lease expired with no attempts left as terminally failed.
   *
   * Without this they would be invisible to `claim` (which skips exhausted
   * jobs) while still reading as `PROCESSING` — alive in the table, dead in
   * practice, and confusing to whoever looks.
   */
  reapExpired(now: Date): Promise<number>;

  /**
   * Deletes finished jobs older than `before`, up to `limit`.
   *
   * Only jobs. Nothing that participates in deduplication is ever pruned —
   * deleting a delivered notification would make its subject eligible for
   * discovery again (open decision A-11).
   */
  prune(before: Date, limit: number): Promise<number>;
}
