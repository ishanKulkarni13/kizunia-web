/**
 * Notifications — Retry Backoff
 *
 * Pure. No clock, no I/O, no randomness it did not receive. Both the job runner
 * and push delivery schedule their retries through this, because there is no
 * reason for two different retry curves in one subsystem, and every reason for
 * the curve to be testable without waiting for it.
 */

export interface BackoffPolicy {
  /** Delay before the first retry, in seconds. */
  readonly baseSeconds: number;
  /** Multiplier applied per additional attempt. */
  readonly factor: number;
  /** Ceiling, before jitter. */
  readonly capSeconds: number;
  /**
   * Upper bound of the random multiplier, as a fraction. `0.5` spreads a delay
   * across `[d, 1.5d]`.
   */
  readonly jitterRatio: number;
}

/**
 * Delay before the next attempt, in milliseconds.
 *
 * `attempts` is the number of attempts **already made**, so the first retry
 * (after one failed attempt) waits exactly `baseSeconds` before jitter.
 *
 * Jitter is additive-upward rather than symmetric on purpose: symmetric jitter
 * can schedule a retry *sooner* than the base delay, which is the opposite of
 * what backoff is for when the thing being retried is overloaded.
 *
 * `random` is injected so the curve is testable; callers pass `Math.random`.
 */
export function nextAttemptDelayMs(
  attempts: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempts - 1);
  const rawSeconds = policy.baseSeconds * Math.pow(policy.factor, exponent);
  const cappedSeconds = Math.min(rawSeconds, policy.capSeconds);
  const jittered = cappedSeconds * (1 + random() * policy.jitterRatio);

  return Math.round(jittered * 1000);
}

/** The same delay, resolved against a caller-supplied `now`. */
export function nextAttemptAt(
  now: Date,
  attempts: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): Date {
  return new Date(now.getTime() + nextAttemptDelayMs(attempts, policy, random));
}
