/**
 * Standard rate-limit response headers (the un-prefixed `RateLimit-*` form
 * from the IETF draft, not `X-RateLimit-*`), plus `Retry-After` (RFC 9110)
 * for rejections.
 *
 * This is the one place these header names are spelled, so both the
 * success path (`Route.execute`, via the AsyncLocalStorage context in
 * `response-context.ts`) and the rejection path (`ErrorHandler`) render an
 * identical, consistent set.
 */

export interface RateLimitHeaderInput {
  readonly limit: number;
  readonly remaining: number;
  readonly resetSeconds: number;
}

export function rateLimitHeaders(
  decision: RateLimitHeaderInput,
): Record<string, string> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.resetSeconds),
  };
}

export function rateLimitRejectionHeaders(
  decision: RateLimitHeaderInput,
): Record<string, string> {
  return {
    ...rateLimitHeaders(decision),
    "Retry-After": String(decision.resetSeconds),
  };
}

/**
 * Builds rejection headers directly from a thrown `RateLimitError`,
 * tolerating a `RateLimitError` that does not carry `limit`/`remaining` —
 * every throw site is expected to set them once migrated (see the
 * migration plan), but `ErrorHandler` must not crash on one that has not
 * been yet, or on a `RateLimitError` constructed outside this subsystem.
 */
export function rateLimitErrorHeaders(error: {
  readonly retryAfterSeconds?: number;
  readonly limit?: number;
  readonly remaining?: number;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  if (error.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(error.retryAfterSeconds);
    headers["RateLimit-Reset"] = String(error.retryAfterSeconds);
  }

  if (error.limit !== undefined) {
    headers["RateLimit-Limit"] = String(error.limit);
  }

  if (error.remaining !== undefined) {
    headers["RateLimit-Remaining"] = String(error.remaining);
  }

  return headers;
}
