/**
 * Rate Limit Observability — a small structured-event seam, not a logger.
 *
 * Kizunia has no logging framework yet (see the audit). This module is
 * deliberately not one either: it is a single typed emission point that a
 * future professional logger swaps in behind `setRateLimitEventSink`,
 * without any caller of `emitRateLimitEvent` changing. Every part of the
 * rate-limit subsystem that needs to report something calls this — nothing
 * else in the subsystem should call `console.*` directly.
 */

import type { RateLimitPolicyId } from "./policies";
import type { RateLimitSubjectKind } from "./subject";

export type RateLimitEventName =
  | "rate_limit.allowed"
  | "rate_limit.rejected"
  /** The store failed and the policy's failure mode let the request through. */
  | "rate_limit.failed_open"
  /** The store failed and the policy's failure mode rejected the request. */
  | "rate_limit.failed_closed";

export interface RateLimitEvent {
  readonly name: RateLimitEventName;
  readonly policyId: RateLimitPolicyId;
  /**
   * The kind of subject involved, never the raw id — an IP or a user id is
   * per-viewer identifying information and must not be logged in plain
   * text. Correlation by identity is deliberately out of scope for this
   * seam; a future logger that genuinely needs it should hash the id, not
   * change what this event carries.
   */
  readonly subjectKind: RateLimitSubjectKind;
  readonly limit?: number;
  readonly windowSeconds?: number;
  readonly remaining?: number;
  readonly timestamp: string;
}

export type RateLimitEventSink = (event: RateLimitEvent) => void;

/**
 * The one place in this subsystem that touches `console`. Structured JSON
 * so it is queryable in Vercel's log capture even before a real log
 * aggregator exists.
 */
const defaultSink: RateLimitEventSink = (event) => {
  console.info(JSON.stringify(event));
};

let sink: RateLimitEventSink = defaultSink;

/** Swaps the event sink — for tests, and later for a real logger/metrics pipeline. */
export function setRateLimitEventSink(next: RateLimitEventSink): void {
  sink = next;
}

/** Restores the default console sink. Mainly for tests to clean up after themselves. */
export function resetRateLimitEventSink(): void {
  sink = defaultSink;
}

export function emitRateLimitEvent(
  event: Omit<RateLimitEvent, "timestamp">,
): void {
  sink({ ...event, timestamp: new Date().toISOString() });
}
