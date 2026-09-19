import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";
import { HttpStatus } from "./http-status";

export type RateLimitErrorOptions =
    Omit<AppErrorOptions, "category" | "status"> & {
        status?: number;
        /** Seconds until the caller may retry, surfaced as `Retry-After`. */
        retryAfterSeconds?: number;
        /** The limit that was exceeded, surfaced as `RateLimit-Limit`. */
        limit?: number;
        /** Remaining requests in the current window, surfaced as `RateLimit-Remaining`. Typically 0. */
        remaining?: number;
    };

/**
 * The caller has exceeded a request budget.
 *
 * Retryable by definition — the limit is a pacing signal, not a rejection of
 * the request itself.
 *
 * `retryAfterSeconds`, `limit`, and `remaining` are typed fields (not just
 * entries in `details`) so `ErrorHandler` can read them directly to build
 * `Retry-After` / `RateLimit-*` response headers without unsafely inspecting
 * an `unknown` value. They are also included in `details`, so they still
 * reach the JSON error body without any change to `createErrorResponse` or
 * the `ErrorResponse` shape.
 */
export class RateLimitError extends AppError {
    readonly retryAfterSeconds?: number;

    readonly limit?: number;

    readonly remaining?: number;

    constructor(options: RateLimitErrorOptions) {
        super({
            ...options,
            status: options.status ?? HttpStatus.TOO_MANY_REQUESTS,
            category: ErrorCategory.RATE_LIMIT,
            retryable: options.retryable ?? true,
        });

        this.retryAfterSeconds = options.retryAfterSeconds;
        this.limit = options.limit;
        this.remaining = options.remaining;
    }
}
