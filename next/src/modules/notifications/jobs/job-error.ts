/**
 * Notifications — Failure Classification
 *
 * Pure. Answers one question: should this failure be tried again?
 *
 * The default is **retryable**, and that asymmetry is deliberate. An
 * unrecognised error retried a bounded number of times costs some work; an
 * unrecognised error treated as fatal silently drops a notification for a
 * condition nobody has seen yet. The first is recoverable, the second is not
 * (ND-D-08).
 *
 * Permanence has to be claimed explicitly, by throwing `PermanentJobError` or
 * by being one of the few error shapes that provably will not change on a
 * retry.
 */
import { ZodError } from "zod";

import { AppError, ErrorCategory } from "@/lib/errors";

/**
 * A failure that will recur identically however many times it is retried.
 *
 * Throw this when retrying is not merely unlikely to help but *cannot* help: a
 * malformed payload, a referenced row that no longer exists, a rule the input
 * will never satisfy.
 */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/**
 * Error categories that cannot be fixed by waiting.
 *
 * `validation` and `resource` are properties of the input, not of the system's
 * current state — a payload that fails validation now will fail identically in
 * a minute. `authorization` likewise: a job's authority does not change while
 * it sits in a queue.
 *
 * `external`, `rate_limit` and `internal` are deliberately absent. Those are
 * exactly the transient conditions retries exist for.
 */
const PERMANENT_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  ErrorCategory.VALIDATION,
  ErrorCategory.AUTHORIZATION,
  ErrorCategory.RESOURCE,
]);

export function isPermanentFailure(error: unknown): boolean {
  if (error instanceof PermanentJobError) return true;

  // A payload that does not match its schema will not start matching later,
  // and retrying only burns attempts to reach the same conclusion.
  if (error instanceof ZodError) return true;

  if (error instanceof AppError) {
    // The platform's own errors already carry this judgement. An error that
    // declares itself retryable is retryable whatever its category says —
    // a rate-limit rejection is the obvious case.
    if (error.retryable) return false;

    return PERMANENT_CATEGORIES.has(error.category);
  }

  return false;
}

/** A short, safe description for the job row's `lastError`. */
export function describeFailure(error: unknown): string {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return first
      ? `Invalid job payload at ${first.path.join(".") || "<root>"}: ${first.message}`
      : "Invalid job payload";
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
