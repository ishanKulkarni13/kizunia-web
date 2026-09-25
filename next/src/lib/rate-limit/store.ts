/**
 * Rate Limit Store — the counting boundary.
 *
 * Deliberately the smallest interface that the service needs: increment a
 * fixed-window counter atomically, and prune expired ones. Nothing else.
 *
 * This exists for two reasons, not one:
 *
 *  - Testability. `RateLimitService` can run against `InMemoryRateLimitStore`
 *    in milliseconds with no database, which is what makes policy
 *    resolution, failure-mode dispatch, and concurrency genuinely unit
 *    testable in a repository that otherwise has no DB test harness.
 *  - A future Redis implementation, if Kizunia ever has a measured need for
 *    one, is a second class behind this interface — no caller changes.
 *    Nothing here adds Redis; this only avoids foreclosing it.
 *
 * Resist adding read/reset/inspect methods speculatively — every method
 * added here is a method every future store must implement.
 */

export interface RateLimitIncrementResult {
  /** The counter's value after this increment, i.e. this request's ordinal within the window. */
  readonly count: number;
}

/**
 * The outcome of a conditional increment. Refusal carries no count: the
 * atomic statement that decides it returns nothing when the ceiling is
 * already reached, and a second read to find out would not be atomic with it.
 */
export type RateLimitConditionalIncrementResult =
  | { readonly acquired: true; readonly count: number }
  | { readonly acquired: false };

export interface RateLimitStore {
  /**
   * Atomically increments the counter for `key`, creating it at 1 if it does
   * not exist, and returns the post-increment count.
   *
   * @param key - `{scope}:{kind}:{id}:{windowStart}` — already fully formed;
   *   the store does no parsing or interpretation of it.
   * @param expiresAt - when this window's row becomes eligible for pruning.
   */
  increment(key: string, expiresAt: Date): Promise<RateLimitIncrementResult>;

  /**
   * Atomically increments the counter for `key` only if it is currently below
   * `ceiling`, creating it at 1 if it does not exist. A refused call changes
   * nothing.
   *
   * This is a single "increment if below" — never read-then-write — so any
   * number of concurrent callers, across any number of instances, are
   * admitted exactly up to the ceiling and no further. It exists for a
   * consumer that must *cap* a shared resource rather than merely count
   * against it: the outbound provider request budget
   * (docs/architecture/subscription/reconciliation/provider-rate-limits.md).
   * Inbound rate limiting keeps using `increment`, which counts every
   * request whether or not it is admitted.
   *
   * A `ceiling` below 1 admits nothing and writes nothing.
   */
  incrementIfBelow(
    key: string,
    ceiling: number,
    expiresAt: Date,
  ): Promise<RateLimitConditionalIncrementResult>;

  /** Removes expired counters. Best-effort housekeeping; safe to call at any time. */
  prune(): Promise<number>;
}
