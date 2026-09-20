/**
 * Notifications — Job Handler Contract
 *
 * What a handler receives, what it may return, and how handlers are found.
 *
 * A handler does one unit of work for one job kind. It does not claim, retry,
 * complete, fail or log — the runner owns all of that, so a handler is a plain
 * async function over a typed payload and stays testable without a queue.
 */
import type { NotificationJobKind } from "@/generated/prisma";

import type { JobPayloadFor } from "./job-payload";
import type { ClaimedJob, WorkQueue } from "./work-queue.port";

export interface JobContext<K extends NotificationJobKind> {
  readonly job: ClaimedJob;
  /** Already validated against this kind's schema. */
  readonly payload: JobPayloadFor<K>;
  /**
   * For scheduling follow-up work and stamping timestamps — never for a domain
   * decision. Anything a decision depends on is frozen in the payload by the
   * scheduler (ND-D-07).
   */
  readonly now: Date;
  /** So a handler can enqueue follow-up work or continue itself. */
  readonly queue: WorkQueue;
}

/**
 * `continued` means the handler has already rescheduled its own row and the
 * runner must leave it alone. It is how work larger than one execution makes
 * progress without being mistaken for either success or failure.
 */
export type JobResult =
  | { readonly kind: "completed"; readonly detail?: string }
  | { readonly kind: "continued"; readonly detail?: string };

export const completed = (detail?: string): JobResult => ({
  kind: "completed",
  detail,
});

export const continued = (detail?: string): JobResult => ({
  kind: "continued",
  detail,
});

export type JobHandler<K extends NotificationJobKind> = (
  context: JobContext<K>,
) => Promise<JobResult>;

/**
 * Every kind must have a handler.
 *
 * Keyed exhaustively, so a new job kind cannot reach production without one —
 * the alternative is a job that claims successfully, finds no handler, and
 * fails forever at runtime.
 */
export type JobHandlerRegistry = {
  readonly [K in NotificationJobKind]: JobHandler<K>;
};
