/**
 * Rate Limit Observability — a small, domain-typed event seam over the
 * shared logger.
 *
 * `RateLimitEvent`'s specific shape (a closed `RateLimitEventName` union,
 * `subjectKind` never the raw subject id) is worth keeping: it is precise
 * domain modeling this subsystem's own callers and tests rely on. What it no
 * longer needs is its own hand-rolled `console`/sink-swap plumbing — that
 * part is `lib/logger`'s job now. `setRateLimitEventSink`/
 * `resetRateLimitEventSink` are preserved as-is so every existing caller and
 * test keeps working unchanged; they now sit in front of `lib/logger`
 * instead of `console` directly.
 */

import { logger } from "@/lib/logger";

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
 * Routes through the shared logger rather than touching `console` directly.
 * `failed_open`/`failed_closed` are warn-level (a store outage is a real
 * operational condition); `allowed`/`rejected` are info-level (expected,
 * high-volume, ordinary traffic shaping).
 */
const defaultSink: RateLimitEventSink = (event) => {
  const { name, ...fields } = event;
  const isFailure = name === "rate_limit.failed_open" || name === "rate_limit.failed_closed";

  if (isFailure) {
    logger.warn(name, fields);
  } else {
    logger.info(name, fields);
  }
};

let sink: RateLimitEventSink = defaultSink;

/** Swaps the event sink — for tests, and later for a real logger/metrics pipeline. */
export function setRateLimitEventSink(next: RateLimitEventSink): void {
  sink = next;
}

/** Restores the default sink (routed through `lib/logger`). Mainly for tests to clean up after themselves. */
export function resetRateLimitEventSink(): void {
  sink = defaultSink;
}

export function emitRateLimitEvent(
  event: Omit<RateLimitEvent, "timestamp">,
): void {
  sink({ ...event, timestamp: new Date().toISOString() });
}
