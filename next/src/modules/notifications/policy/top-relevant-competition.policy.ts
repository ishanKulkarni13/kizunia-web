/**
 * Notification policy — `TOP_RELEVANT_COMPETITION`.
 *
 * Answers exactly one question: *should this user's top relevant competition
 * become a notification?* The recommendation engine has already answered the
 * different question of what is relevant
 * (`docs/architecture/notifications/principles.md`, principle 3).
 *
 * Pure: no Prisma, no network, no clock, no I/O of any kind. Every input is
 * supplied by the caller, which is what lets the whole decision be unit-tested
 * in milliseconds without a database.
 *
 * Does NOT
 * ----------------
 * ✗ Compute relevance, scores, ranking, thresholds or eligibility
 * ✗ Read preferences or competitions from storage
 * ✗ Know about email, push, WhatsApp, queues, workers or schedules
 */
import type { NotificationIntent } from "@/generated/prisma";
import type { RecommendationItemDTO } from "@/modules/recommendations";

import type { NotificationDecision } from "./types";

/**
 * Written as a typed literal rather than `NotificationIntent.TOP_RELEVANT_COMPETITION`
 * so this module needs only a type-only import of `@/generated/prisma`. A value
 * import would pull the generated Prisma client into every bundle that touches
 * the module barrel — the hazard `modules/preferences/index.ts` and
 * `modules/recommendations/index.ts` both document.
 */
const INTENT: NotificationIntent = "TOP_RELEVANT_COMPETITION";

export interface TopRelevantCompetitionInput {
  readonly userId: string;
  /** Whether the user has this intent enabled. Opt-in: absent means `false`. */
  readonly enabled: boolean;
  /** The recommendation engine's output for this user — consumed, not recomputed. */
  readonly recommendations: readonly RecommendationItemDTO[];
  /** Established once per evaluation by the caller. */
  readonly now: Date;
}

/**
 * The rules, in order:
 *
 * 1. Intent disabled → suppressed. Checked *first* so a user who opted out is
 *    reported as opted out rather than as "we found nothing" — the reason has
 *    to be the true one, because a future layer may surface or count it.
 * 2. No recommendations → suppressed. Silence is a valid and frequent outcome
 *    (`decisions/intents.md`, ND-I-05).
 * 3. Otherwise → exactly one competition: the highest-ranked recommendation
 *    (ND-I-06 — one competition, not a user-configurable volume).
 *
 * There is deliberately no separate "preference profile exists" check, though
 * the intent specification lists one. A user with no competition preferences
 * normalizes to an empty profile, every candidate then scores 0, and the
 * engine's threshold rejects them all — so that case already arrives here as
 * an empty `recommendations` array and is reported as `NO_RECOMMENDATIONS`.
 * A second check would be a second code path describing the same reality.
 */
export function evaluateTopRelevantCompetition(
  input: TopRelevantCompetitionInput,
): NotificationDecision {
  const { userId, enabled, recommendations, now } = input;

  if (!enabled) {
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "INTENT_DISABLED",
    };
  }

  const top = selectTop(recommendations);

  if (!top) {
    return {
      eligible: false,
      intent: INTENT,
      userId,
      evaluatedAt: now,
      reason: "NO_RECOMMENDATIONS",
    };
  }

  return {
    eligible: true,
    intent: INTENT,
    userId,
    evaluatedAt: now,
    subject: {
      competitionId: top.competition.id,
      competition: top.competition,
      score: top.score,
      rank: top.rank,
    },
  };
}

/**
 * The engine already returns items in rank order, but this picks the best one
 * explicitly rather than reading index 0. Depending on someone else's ordering
 * guarantee is the kind of coupling that breaks silently and cheaply avoided:
 * lowest `rank` wins, higher `score` breaks a tie.
 */
function selectTop(
  items: readonly RecommendationItemDTO[],
): RecommendationItemDTO | null {
  let best: RecommendationItemDTO | null = null;

  for (const item of items) {
    if (
      best === null ||
      item.rank < best.rank ||
      (item.rank === best.rank && item.score > best.score)
    ) {
      best = item;
    }
  }

  return best;
}
