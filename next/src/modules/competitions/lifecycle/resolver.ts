/**
 * Competition Lifecycle - Pure automatic status resolver
 *
 * =============================================================================
 * What this module is
 * =============================================================================
 *
 * The single place lifecycle precedence is encoded. No database access, no
 * side effects, deterministic given its inputs (including `now`, which is
 * always passed in rather than read from the clock here). Every caller that
 * needs to know "what should this competition's status be right now" —
 * the nightly sweep, the admin preview/apply endpoints, and the date-edit /
 * re-enable reconciliation path on `PATCH /competitions/[id]` — goes through
 * `resolveAutomaticStatus` (or its `evaluateLifecycle` wrapper). Nothing else
 * in the codebase is allowed to re-encode these rules.
 *
 * =============================================================================
 * Lifecycle semantics
 * =============================================================================
 *
 * The resolver answers "what is the most accurate lifecycle state right now".
 *
 * Strong evidence wins. Missing dates are unknown, not evidence of an earlier
 * or later lifecycle state.
 *
 * Important edge cases:
 *
 * - REGISTRATION_OPEN + future startDate is valid. Registration may legitimately
 *   be open before the event starts, so startDate must not downgrade it to
 *   UPCOMING.
 *
 * - REGISTRATION_OPEN + null registrationStartDate + future
 *   registrationDeadline is also valid. The missing start date does not prove
 *   that registration has not started. The competition remains
 *   REGISTRATION_OPEN until the deadline is reached.
 *
 * - ONGOING + future startDate is contradictory. The future start date is
 *   sufficient evidence that the event has not started, so automation may move
 *   ONGOING back to UPCOMING.
 *
 * - If ONGOING has a future startDate but registration is currently known to
 *   be open, REGISTRATION_OPEN takes precedence because that is the more
 *   accurate user-facing state.
 *
 * - COMPLETED + future endDate is ambiguous. This may represent a manual
 *   correction, rescheduling, stale data, or another data inconsistency.
 *   The resolver intentionally does not invent organizer intent for this case.
 *
 * - A future registrationDeadline by itself is not evidence that the
 *   competition is UPCOMING. It may simply be the future expiry of an already
 *   open registration window.
 *
 * =============================================================================
 * Precedence, in evaluation order (first match wins)
 * =============================================================================
 *
 *   0. CANCELLED is terminal for automatic processing — never overwritten.
 *   1. COMPLETED           — endDate has been reached.
 *   2. REGISTRATION_OPEN   — registration is known to be open.
 *   3. ONGOING              — startDate has been reached.
 *   4. REGISTRATION_CLOSED — registrationDeadline has been reached.
 *   5. UPCOMING             — sufficient evidence exists that the competition
 *                            is still before its first relevant milestone.
 *   6. unchanged            — no safe automatic transition can be established.
 *                            NO_LIFECYCLE_DATES when no lifecycle date is
 *                            known at all; AMBIGUOUS_LIFECYCLE_DATA when at
 *                            least one date exists but doesn't clear the bar.
 *
 * REGISTRATION_OPEN outranks ONGOING deliberately: a competition may already
 * have started while registration is still open (late registration), and the
 * registration window is what the status describes at that point, not the
 * event itself.
 *
 * ONGOING outranks REGISTRATION_CLOSED because "the event has started" is a
 * stronger signal than "the registration window is over" whenever both are
 * true.
 *
 * =============================================================================
 * Missing dates
 * =============================================================================
 *
 * Every rule names exactly the date(s) it needs and is skipped — not
 * defaulted, not inferred — when that date is null.
 *
 * In particular, a null `registrationStartDate` does not mean that
 * registration has not started. If the current status is REGISTRATION_OPEN
 * and its deadline has not been reached, that status is preserved even when
 * the registration start date is unavailable.
 *
 * Missing information is not evidence of another lifecycle state. If the
 * available dates do not provide sufficient evidence for a transition, the
 * current status is preserved unchanged.
 *
 * =============================================================================
 * Boundary semantics
 * =============================================================================
 *
 * "Reached" is inclusive: `date.getTime() <= now.getTime()`. Its complement
 * (a deadline that has not yet been reached) is therefore strict
 * (`> now`). One consistent rule, so there is no gap or overlap at the exact
 * instant `now` equals a lifecycle date.
 */

import type { CompetitionStatus } from "@/generated/prisma";

// =============================================================================
// Types
// =============================================================================

export const LifecycleReason = {
  /** currentStatus was CANCELLED; automation never moves it. */
  CANCELLED_PRESERVED: "CANCELLED_PRESERVED",

  /** endDate has been reached or passed. */
  END_DATE_PASSED: "END_DATE_PASSED",

  /** Registration is currently known/preserved as open. */
  REGISTRATION_WINDOW_OPEN: "REGISTRATION_WINDOW_OPEN",

  /** startDate has been reached or passed. */
  START_DATE_REACHED: "START_DATE_REACHED",

  /** registrationDeadline has been reached or passed. */
  REGISTRATION_DEADLINE_PASSED: "REGISTRATION_DEADLINE_PASSED",

  /** A future lifecycle date provides sufficient evidence for UPCOMING. */
  AWAITING_FIRST_MILESTONE: "AWAITING_FIRST_MILESTONE",

  /** All four lifecycle dates are null; there is nothing to reason about. */
  NO_LIFECYCLE_DATES: "NO_LIFECYCLE_DATES",

  /**
   * At least one lifecycle date exists, but it is not sufficient (or is
   * contradictory) evidence for an automatic transition. Distinct from
   * NO_LIFECYCLE_DATES because dates do exist — they just do not clear the
   * bar for a safe automatic change.
   */
  AMBIGUOUS_LIFECYCLE_DATA: "AMBIGUOUS_LIFECYCLE_DATA",
} as const;

export type LifecycleReason =
  (typeof LifecycleReason)[keyof typeof LifecycleReason];

export interface LifecycleInput {
  /** The instant to evaluate against. Always injected — never `new Date()`. */
  readonly now: Date;
  readonly currentStatus: CompetitionStatus | null;
  readonly registrationStartDate: Date | null;
  readonly registrationDeadline: Date | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

export interface LifecycleResolution {
  /**
   * The status automation believes is correct right now.
   */
  readonly status: CompetitionStatus | null;
  readonly reason: LifecycleReason;
  /**
   * The date that drove this resolution, for display ("Why" column).
   * Null when there is no specific driving date.
   */
  readonly drivingDate: Date | null;
}

export interface LifecycleEvaluation extends LifecycleResolution {
  readonly current: CompetitionStatus | null;
  /** Whether persisting `status` would actually change the stored value. */
  readonly changed: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function reached(date: Date | null, now: Date): date is Date {
  return date !== null && date.getTime() <= now.getTime();
}

function notYetReached(date: Date | null, now: Date): boolean {
  return date === null || date.getTime() > now.getTime();
}

/**
 * Returns the earliest lifecycle date that is still in the future.
 *
 * This intentionally does NOT treat a past date as a future milestone.
 * More importantly, callers must decide whether a future milestone is
 * actually sufficient evidence for UPCOMING; the existence of a future date
 * alone does not determine the lifecycle state.
 */
function earliestKnownFutureDate(
  now: Date,
  ...dates: readonly (Date | null)[]
): Date | null {
  let earliest: Date | null = null;

  for (const date of dates) {
    if (date === null || date.getTime() <= now.getTime()) {
      continue;
    }

    if (earliest === null || date.getTime() < earliest.getTime()) {
      earliest = date;
    }
  }

  return earliest;
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Computes the status automation believes a competition should have right
 * now, from lifecycle dates and current status alone. Pure, synchronous, no
 * I/O. Calling it twice with identical input always yields identical output.
 */
export function resolveAutomaticStatus(
  input: LifecycleInput,
): LifecycleResolution {
  const {
    now,
    currentStatus,
    registrationStartDate,
    registrationDeadline,
    startDate,
    endDate,
  } = input;

  // Rule 0 — CANCELLED is terminal for automatic processing.
  if (currentStatus === "CANCELLED") {
    return {
      status: currentStatus,
      reason: LifecycleReason.CANCELLED_PRESERVED,
      drivingDate: null,
    };
  }

  // Rule 1 — COMPLETED once the event has ended.
  if (reached(endDate, now)) {
    return {
      status: "COMPLETED",
      reason: LifecycleReason.END_DATE_PASSED,
      drivingDate: endDate,
    };
  }

  // Rule 2 — REGISTRATION_OPEN outranks ONGOING: the event may already have
  // started while registration is still accepting entries.
  //
  // If registrationStartDate is missing but the current status is already
  // REGISTRATION_OPEN, preserve that status until its deadline is reached.
  //
  // A missing registrationStartDate is unknown information; it is not evidence
  // that registration has not started.
  if (
    (reached(registrationStartDate, now) ||
      currentStatus === "REGISTRATION_OPEN") &&
    notYetReached(registrationDeadline, now)
  ) {
    return {
      status: "REGISTRATION_OPEN",
      reason: LifecycleReason.REGISTRATION_WINDOW_OPEN,
      drivingDate: registrationStartDate,
    };
  }

  // Rule 3 — ONGOING once the event has started.
  if (reached(startDate, now)) {
    return {
      status: "ONGOING",
      reason: LifecycleReason.START_DATE_REACHED,
      drivingDate: startDate,
    };
  }

  // Rule 4 — REGISTRATION_CLOSED once the deadline has passed, provided
  // nothing above already matched.
  if (reached(registrationDeadline, now)) {
    return {
      status: "REGISTRATION_CLOSED",
      reason: LifecycleReason.REGISTRATION_DEADLINE_PASSED,
      drivingDate: registrationDeadline,
    };
  }

  // Rule 5 — UPCOMING.
  //
  // A future date by itself is NOT enough to establish UPCOMING.
  //
  // In particular, a future registrationDeadline may simply be the deadline
  // for an already-open registration window.
  //
  // ONGOING + future startDate is different: ONGOING explicitly claims that
  // the event has started, so a future startDate is sufficient evidence for a
  // backward transition to UPCOMING. But it must be startDate specifically —
  // ONGOING says nothing about registration or end dates, so a future
  // registrationStartDate or endDate does not contradict it and must not be
  // used to justify the same backward transition.
  //
  // REGISTRATION_OPEN is intentionally not overridden here because registration
  // can legitimately be open before the event begins.
  //
  // COMPLETED + future endDate is intentionally left untouched because the
  // resolver cannot determine whether the data represents rescheduling,
  // correction, stale data, or another situation.
  if (currentStatus === "ONGOING") {
    if (notYetReached(startDate, now) && startDate !== null) {
      return {
        status: "UPCOMING",
        reason: LifecycleReason.AWAITING_FIRST_MILESTONE,
        drivingDate: startDate,
      };
    }
  } else if (currentStatus === null || currentStatus === "UPCOMING") {
    const nextMilestone = earliestKnownFutureDate(
      now,
      registrationStartDate,
      startDate,
      endDate,
    );

    if (nextMilestone !== null) {
      return {
        status: "UPCOMING",
        reason: LifecycleReason.AWAITING_FIRST_MILESTONE,
        drivingDate: nextMilestone,
      };
    }
  }

  // Rule 6 — ambiguous or incomplete data.
  //
  // There is not enough evidence for a safe automatic transition.
  // Preserve the currently stored status rather than guessing.
  //
  // NO_LIFECYCLE_DATES is reserved for the case where all four lifecycle
  // dates are null — there is nothing to reason about. If at least one date
  // exists but still isn't enough (or is contradictory) evidence for a
  // transition, that is AMBIGUOUS_LIFECYCLE_DATA instead, so callers like the
  // admin preview don't misreport dates that do exist as absent.
  const hasLifecycleDates =
    registrationStartDate !== null ||
    registrationDeadline !== null ||
    startDate !== null ||
    endDate !== null;

  return {
    status: currentStatus,
    reason: hasLifecycleDates
      ? LifecycleReason.AMBIGUOUS_LIFECYCLE_DATA
      : LifecycleReason.NO_LIFECYCLE_DATES,
    drivingDate: null,
  };
}

/**
 * `resolveAutomaticStatus` plus the "did this actually change anything"
 * comparison every caller needs — the admin preview table, the sweep's
 * write-grouping, and the date-edit reconciliation path all only care about
 * rows where `changed` is true.
 */
export function evaluateLifecycle(input: LifecycleInput): LifecycleEvaluation {
  const resolution = resolveAutomaticStatus(input);

  return {
    ...resolution,
    current: input.currentStatus,
    changed: resolution.status !== input.currentStatus,
  };
}