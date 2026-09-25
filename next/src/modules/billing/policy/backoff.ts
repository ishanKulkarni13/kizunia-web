/**
 * Billing — Backoff
 *
 * The retry-delay math, shared by everything that backs off from the provider:
 * the global cooldown (this phase) and per-subscription retries (Phase IV).
 * Pure, and with an injectable random source so the bounds are testable.
 *
 *   delay = min(cap, base · 2^exponent) × jitter,   jitter uniform in [0.5, 1.0]
 *
 * The jitter is what keeps a shared outage from re-synchronizing every retry
 * into the same instant. It only ever shortens a delay, never lengthens it, so
 * the cap is a true upper bound.
 *
 * See docs/architecture/subscription/reconciliation/provider-rate-limits.md#backoff.
 */

export interface BackoffSettings {
  readonly baseSeconds: number;
  readonly capSeconds: number;
}

/** Jitter multiplier bounds. */
export const JITTER_MIN = 0.5;
export const JITTER_MAX = 1.0;

/** `min(cap, base · 2^exponent)`, before jitter. A negative or fractional exponent is treated as 0. */
export function backoffCeilingSeconds(settings: BackoffSettings, exponent: number): number {
  const steps = Math.max(0, Math.floor(exponent));

  // `2 ** steps` overflows to Infinity for a huge exponent, and `min` then
  // returns the cap, which is exactly right.
  return Math.min(settings.capSeconds, settings.baseSeconds * 2 ** steps);
}

/** The jittered delay, in seconds. `random` returns a value in [0, 1). */
export function backoffDelaySeconds(
  settings: BackoffSettings,
  exponent: number,
  random: () => number = Math.random,
): number {
  const jitter = JITTER_MIN + (JITTER_MAX - JITTER_MIN) * random();

  return backoffCeilingSeconds(settings, exponent) * jitter;
}
