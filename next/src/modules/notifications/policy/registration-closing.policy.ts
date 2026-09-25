/**
 * Notification policy — `REGISTRATION_CLOSING`.
 *
 * PURE. No Prisma, no network, no clock, no I/O. Every input is already
 * fetched, so the whole rule set is testable in milliseconds without a
 * database — which is the point of the `policy/` ÷ `backend/` split this module
 * established for the discovery intent.
 *
 * ## What it decides, in order
 *
 * 1. Is the intent on? An opted-out user is reported as opted out, before
 *    anything else is examined.
 * 1a. Is the user entitled to it (the deadline-notifications capability)?
 *    If not, `NOT_ENTITLED` — the preference is left as it is.
 * 2. Which of the competitions closing in this window does the user actually
 *    care about — relevant **or** bookmarked (ND-I-11)?
 * 3. Minus anything they have told us they already registered for.
 * 4. Minus anything they have already been told about *for this deadline*
 *    (ND-H-12).
 * 5. Rank what is left, take the top few, and aggregate into one notification
 *    (ND-I-13).
 *
 * ## What it deliberately does not do
 *
 * It does not score anything. Relevance has exactly one owner, the
 * recommendation engine (principle 3), and this policy consumes its ranking
 * rather than forming an opinion of its own. A bookmarked competition that the
 * engine ranked nowhere is still included — an explicit save is its own reason
 * to care, and not a claim about relevance.
 */
import { NotificationIntent } from "@/generated/prisma";
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

import type {
  NotificationDecision,
  NotificationSubject,
} from "./types";

const INTENT: NotificationIntent = NotificationIntent.REGISTRATION_CLOSING;

/** One competition closing inside the window, with everything known about it. */
export interface DeadlineCandidate {
  readonly competitionId: string;
  readonly competition: CompetitionCardDTO;
  readonly deadline: Date;
}

export interface RegistrationClosingInput {
  readonly userId: string;
  readonly enabled: boolean;
  /**
   * Whether the user's effective access includes the capability this intent
   * requires (`intent-capability.ts`). No admin bypass: background
   * evaluation has no actor (IB-7).
   */
  readonly entitled: boolean;
  /** Everything closing in this sweep's window. */
  readonly candidates: readonly DeadlineCandidate[];
  /**
   * Relevance score by competition id, from the recommendation engine.
   *
   * Absent means the engine did not rank it — which is not a reason to exclude
   * it, only a reason it cannot qualify on relevance alone.
   */
  readonly relevanceById: ReadonlyMap<string, number>;
  readonly bookmarkedIds: ReadonlySet<string>;
  readonly registeredIds: ReadonlySet<string>;
  /**
   * `(competitionId, deadline)` pairs already delivered to this user for this
   * intent, as `targetKey` strings. Keyed on the occasion, not the competition,
   * so a moved deadline is a new event (ND-H-12).
   */
  readonly alreadyNotifiedKeys: ReadonlySet<string>;
  readonly maxSubjects: number;
  readonly now: Date;
}

/**
 * The stable identity of one deadline occasion.
 *
 * Exported because generation and deduplication must agree on it exactly — two
 * independent definitions of "the same deadline" is the kind of drift that
 * produces duplicate notifications months later.
 */
export function deadlineOccasion(deadline: Date): string {
  return String(deadline.getTime());
}

export function occasionKey(competitionId: string, deadline: Date): string {
  return `${competitionId}::${deadlineOccasion(deadline)}`;
}

export function evaluateRegistrationClosing(
  input: RegistrationClosingInput,
): NotificationDecision {
  const { userId, now } = input;

  // Checked first, so someone who opted out is reported as having opted out —
  // not as someone for whom nothing was found.
  if (!input.enabled) {
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "INTENT_DISABLED",
    };
  }

  if (!input.entitled) {
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "NOT_ENTITLED",
    };
  }

  if (input.candidates.length === 0) {
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "NO_SUBJECTS_IN_WINDOW",
    };
  }

  const qualified = input.candidates.filter((candidate) => {
    // Telling someone to register for something they have said they registered
    // for is the clearest possible signal that nobody is paying attention.
    if (input.registeredIds.has(candidate.competitionId)) return false;

    const relevant = input.relevanceById.has(candidate.competitionId);
    const bookmarked = input.bookmarkedIds.has(candidate.competitionId);

    // Alternatives, not a conjunction (ND-I-11).
    return relevant || bookmarked;
  });

  if (qualified.length === 0) {
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "NO_RECOMMENDATIONS",
    };
  }

  const fresh = qualified.filter(
    (candidate) =>
      !input.alreadyNotifiedKeys.has(
        occasionKey(candidate.competitionId, candidate.deadline),
      ),
  );

  if (fresh.length === 0) {
    // Everything qualifying was already sent. A distinct outcome from finding
    // nothing: the system worked and correctly stayed quiet.
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "ALREADY_NOTIFIED",
    };
  }

  const ranked = [...fresh].sort(compareCandidates(input));
  const selected = ranked.slice(0, Math.max(1, input.maxSubjects));

  const subjects = selected.map<NotificationSubject>((candidate, index) => ({
    competitionId: candidate.competitionId,
    competition: candidate.competition,
    // A bookmarked competition the engine did not rank has no relevance score.
    // Zero is honest here: it means "not ranked", and the user still qualifies
    // through the bookmark.
    score: input.relevanceById.get(candidate.competitionId) ?? 0,
    rank: index + 1,
    occasionVersion: deadlineOccasion(candidate.deadline),
  }));

  return {
    eligible: true,
    intent: INTENT,
    userId,
    evaluatedAt: now,
    subjects: subjects as [NotificationSubject, ...NotificationSubject[]],
  };
}

/**
 * Soonest deadline first, then most relevant, then by id.
 *
 * Urgency leads because that is what the notification is *about* — a competition
 * closing tomorrow matters more than a better-matched one closing in three
 * days, and the user can act on only one of them today. Relevance breaks ties,
 * and the id makes the order total so the same inputs always produce the same
 * notification.
 */
function compareCandidates(input: RegistrationClosingInput) {
  return (a: DeadlineCandidate, b: DeadlineCandidate): number => {
    const byDeadline = a.deadline.getTime() - b.deadline.getTime();
    if (byDeadline !== 0) return byDeadline;

    const scoreA = input.relevanceById.get(a.competitionId) ?? 0;
    const scoreB = input.relevanceById.get(b.competitionId) ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    return a.competitionId.localeCompare(b.competitionId);
  };
}
