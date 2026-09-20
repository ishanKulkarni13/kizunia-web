/**
 * Notifications — Occurrence Identity and Timing
 *
 * Pure. Every function takes the instant it should reason from; none reads the
 * clock.
 *
 * This file is where "which occasion is this?" is decided, and that question is
 * load-bearing in a way it does not look. An occurrence key is the idempotency
 * identity of a notification: the database rejects a second notification for
 * the same `(user, intent, occurrence)`, so getting the key right is what makes
 * a duplicated scheduler run harmless, and getting it *unstable* is what would
 * make a retry generate a second notification for the same day.
 *
 * Hence the rule these functions exist to enforce: keys and windows are
 * computed **once**, by the scheduler, and carried in the job payload
 * (ND-D-07). A worker that recomputed its own key from `new Date()` would
 * produce a different one the moment a retry crossed UTC midnight.
 */
import { NotificationIntent, type NotificationJobKind } from "@/generated/prisma";

/** `YYYY-MM-DD` in UTC. */
export function utcDateKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * The daily discovery occasion.
 *
 * One per user per UTC day: the intent surfaces at most one competition per
 * evaluation (ND-I-06), and the scheduler runs once a day (ND-I-23), so the day
 * is the occasion.
 */
export function topRelevantOccurrenceKey(anchor: Date): string {
  return `top:${utcDateKey(anchor)}`;
}

/**
 * The deadline-sweep occasion.
 *
 * Also one per user per day, because the sweep produces **one aggregated
 * notification** covering every qualifying competition (ND-I-13) rather than
 * one per competition. Per-competition identity is carried by the notification's
 * targets, not by this key.
 */
export function registrationClosingOccurrenceKey(anchor: Date): string {
  return `closing:${utcDateKey(anchor)}`;
}

/**
 * The announcement occasion.
 *
 * The announcement itself, not a date. It is delivered once, whenever it is
 * scheduled for, and re-running fan-out must never produce a second copy.
 */
export function announcementOccurrenceKey(announcementId: string): string {
  return `announcement:${announcementId}`;
}

/**
 * The admin review occasion for one competition suggestion.
 *
 * Keyed on the suggestion **and the submission instant**, not the suggestion
 * alone, and that is the whole subtlety of this intent.
 *
 * `CompetitionSuggestionService.submit` refreshes `submittedAt` on every
 * submission, including the `CHANGES_REQUESTED -> DRAFT -> resubmit` round
 * trip. A resubmitted suggestion is genuinely back in the review queue and
 * admins have something to do again — so it is a new occasion, exactly as a
 * moved registration deadline is (ND-H-12). Keying on the id alone would
 * suppress it forever, and a queue item nobody is ever told about again is the
 * failure this intent exists to prevent.
 *
 * The instant is taken from the stored `submittedAt`, never from the sweep's
 * clock, so every pass over the same submission produces the same key.
 */
export function adminSuggestionOccurrenceKey(
  suggestionId: string,
  submittedAt: Date,
): string {
  return `suggestion:${suggestionId}:${submittedAt.toISOString()}`;
}

export interface EvaluationWindow {
  /** Inclusive. */
  readonly start: Date;
  /** Exclusive. */
  readonly end: Date;
}

/**
 * The band of deadlines one sweep is responsible for (ND-I-19).
 *
 * A scheduled job cannot fire at the exact instant each competition reaches
 * T-minus-two-days, so the target is approximated by a band anchored on the
 * sweep's own evaluation time.
 *
 * The band is **exactly one sweep interval wide**, and that is the only width
 * that is correct. Narrower leaves gaps — deadlines that fall between two
 * sweeps and are never caught at all. Wider overlaps, so every deadline is seen
 * by two sweeps and correctness rests entirely on deduplication catching the
 * second one.
 *
 * Deriving the width from the configured interval rather than hard-coding "2 to
 * 3 days" means changing the cadence cannot silently open a gap.
 */
export function deadlineWindow(
  anchor: Date,
  offsetSeconds: number,
  widthSeconds: number,
): EvaluationWindow {
  const start = new Date(anchor.getTime() + offsetSeconds * 1000);
  const end = new Date(start.getTime() + widthSeconds * 1000);

  return { start, end };
}

/**
 * The next occurrence of `hourUtc` strictly after `from`.
 *
 * Used to schedule the following day's evaluation. Strictly after, so a
 * scheduler running exactly on the hour schedules tomorrow rather than
 * re-scheduling the run it is currently part of.
 */
export function nextDailyRunAt(from: Date, hourUtc: number): Date {
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );

  if (candidate.getTime() > from.getTime()) return candidate;

  return new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * The identity of a unit of work: `<kind>:<scope>:<occurrence>`.
 *
 * `scope` is whatever the work is *for* — a user id for an evaluation, an
 * announcement id for a fan-out, a notification id for a delivery. Together
 * with the occurrence it makes "this exact work, for this exact thing, on this
 * exact occasion" a single unique string, which the database then enforces.
 */
export function jobDedupeKey(
  kind: NotificationJobKind,
  scope: string,
  occurrenceKey: string,
): string {
  return `${kind}:${scope}:${occurrenceKey}`;
}

/**
 * The occurrence key for a scheduled evaluation of `intent`.
 *
 * Exhaustive over the enum, so an intent added without deciding what its
 * occasion *is* fails to compile rather than silently sharing another intent's
 * identity — which would make the two deduplicate against each other.
 */
export function evaluationOccurrenceKey(
  intent: NotificationIntent,
  anchor: Date,
): string {
  switch (intent) {
    case NotificationIntent.TOP_RELEVANT_COMPETITION:
      return topRelevantOccurrenceKey(anchor);
    case NotificationIntent.REGISTRATION_CLOSING:
      return registrationClosingOccurrenceKey(anchor);
    case NotificationIntent.FEATURE_ANNOUNCEMENT:
      // Announcements are not produced by a scheduled evaluation — they are
      // fanned out from an authored record, and their occasion is that record.
      throw new Error(
        "FEATURE_ANNOUNCEMENT has no scheduled occurrence; use announcementOccurrenceKey",
      );
    case NotificationIntent.ADMIN_COMPETITION_SUGGESTION:
      // Nor is this one. Its occasion is a submission, not a date: the sweep
      // that finds it runs on a timer, but *what* it is about is the suggestion
      // that was submitted, which is what must not be notified about twice.
      throw new Error(
        "ADMIN_COMPETITION_SUGGESTION has no scheduled occurrence; use adminSuggestionOccurrenceKey",
      );
  }
}
