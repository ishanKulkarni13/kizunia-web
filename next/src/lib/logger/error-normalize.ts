/**
 * Logger — Error Normalization
 *
 * Turns an `unknown` thrown value into a safe, structured field bag,
 * generalizing the `error instanceof Error ? error.message : String(error)`
 * check duplicated across every notification job handler
 * (see `modules/notifications/observability/log.ts` call sites) into one
 * place, and additionally recognizing this repository's own `AppError`
 * hierarchy (`lib/errors`) so a logged error carries its `code`/`category`/
 * `retryable` without every call site re-extracting them by hand.
 *
 * This is deliberately diagnostic-only. `AppError.details` is what an API
 * response is allowed to expose to a caller (see `error-response.ts`); this
 * module logs strictly more than that (message, stack, cause chain) for
 * operators, and that distinction — internal diagnostic detail vs. what an
 * API response exposes — is exactly the boundary that must not blur. Nothing
 * here changes what `ErrorHandler`/`createErrorResponse` send to a client.
 */

import { isAppError } from "@/lib/errors/is-app-error";

export interface NormalizedError {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
  /** Present only for an `AppError` (or subclass). */
  readonly code?: string;
  readonly category?: string;
  readonly retryable?: boolean;
  readonly status?: number;
  /** The error's own `.cause`, normalized the same way, one level at a time. */
  readonly cause?: NormalizedError;
  /** Set when `error` was not an `Error` instance at all. */
  readonly raw?: unknown;
}

const MAX_CAUSE_DEPTH = 5;

export function normalizeError(error: unknown, depth = 0): NormalizedError {
  if (isAppError(error)) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      status: error.status,
      cause: normalizeCause(error.cause, depth),
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      cause: normalizeCause(error.cause, depth),
    };
  }

  if (typeof error === "string") {
    return { message: error, name: "NonErrorThrow" };
  }

  return {
    message: "A non-Error value was thrown.",
    name: "NonErrorThrow",
    raw: error,
  };
}

function normalizeCause(cause: unknown, depth: number): NormalizedError | undefined {
  if (cause === undefined || depth >= MAX_CAUSE_DEPTH) {
    return undefined;
  }

  return normalizeError(cause, depth + 1);
}
