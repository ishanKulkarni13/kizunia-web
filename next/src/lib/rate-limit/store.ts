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

  /** Removes expired counters. Best-effort housekeeping; safe to call at any time. */
  prune(): Promise<number>;
}
