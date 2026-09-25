/**
 * Job handler — evaluate `REGISTRATION_CLOSING` for one user.
 *
 * ## Why this is per-user rather than per-competition
 *
 * The obvious shape is competition-first: find what closes soon, then find who
 * cares. It does not work. "Who cares" means relevance, and relevance is
 * per-user — so that shape recomputes relevance for every (user × competition)
 * pair, which is exactly the cost problem open decision A-4 named.
 *
 * Inverting it dissolves the problem. One engine run per user produces a full
 * ranking; intersecting that with the handful of competitions closing in the
 * window is a set operation. The cost is one engine run per enabled user per
 * day — the same shape the discovery sweep already has — and each user stays an
 * independent, resumable unit of work (ND-I-20).
 *
 * ## What it does not do
 *
 * No scoring, no ranking rules, no eligibility logic. All of that is either the
 * engine's or the policy's. This file fetches the policy's inputs and hands
 * them over.
 */
import {
  NotificationIntent,
  NotificationJobKind,
  NotificationTargetType,
} from "@/generated/prisma";
import { RecommendationService } from "@/modules/recommendations/backend/recommendation.service";

import { DeadlineWindowRepository } from "../../backend/deadline-window.repository";
import { NotificationGenerationService } from "../../backend/notification-generation.service";
import { isEntitledToIntent } from "../../backend/notification-entitlement";
import {
  NotificationRepository,
  targetKey,
} from "../../backend/notification.repository";
import { NotificationPreferenceService } from "@/modules/preferences/backend/notification-preference.service";
import { INTENT_CONFIG } from "../../config/notification-config";
import { renderRegistrationClosing } from "../../content/renderers";
import { logNotificationEvent } from "../../observability/log";
import {
  deadlineOccasion,
  evaluateRegistrationClosing,
  occasionKey,
} from "../../policy/registration-closing.policy";
import { completed, type JobHandler } from "../handler";

/**
 * A ceiling on how many closing competitions one window may contain.
 *
 * A window holding more than this is a data anomaly rather than a busy week,
 * and loading all of it per user would turn that anomaly into an outage.
 */
const WINDOW_LIMIT = 500;

export const evaluateRegistrationClosingHandler: JobHandler<
  typeof NotificationJobKind.EVALUATE_REGISTRATION_CLOSING
> = async ({ payload }) => {
  const evaluatedAt = new Date(payload.evaluatedAt);

  const enabled = await NotificationPreferenceService.isEnabledForUser(
    payload.userId,
    NotificationIntent.REGISTRATION_CLOSING,
  );

  // Short-circuit before the expensive part. Running the engine for someone who
  // opted out is work whose result is discarded by the next line.
  if (!enabled) {
    logNotificationEvent("evaluation.suppressed", {
      userId: payload.userId,
      intent: NotificationIntent.REGISTRATION_CLOSING,
      occurrenceKey: payload.occurrenceKey,
      reason: "INTENT_DISABLED",
    });

    return completed("suppressed:INTENT_DISABLED");
  }

  // Re-check of the scheduler's entitlement filter (IB-2): the deadline
  // capability may have been lost since this job was scheduled. Asked of the
  // current clock, and before the window query and the engine run. No admin
  // bypass — this job has no actor (IB-7).
  const entitled = await isEntitledToIntent(
    payload.userId,
    NotificationIntent.REGISTRATION_CLOSING,
  );

  if (!entitled) {
    logNotificationEvent("evaluation.suppressed", {
      userId: payload.userId,
      intent: NotificationIntent.REGISTRATION_CLOSING,
      occurrenceKey: payload.occurrenceKey,
      reason: "NOT_ENTITLED",
    });

    return completed("suppressed:NOT_ENTITLED");
  }

  // The window the scheduler froze. Recomputing it here would mean a job
  // retried a day later silently evaluated a different set of competitions
  // under the same occurrence key (ND-D-07).
  const closing = await DeadlineWindowRepository.findClosingBetween({
    start: new Date(payload.windowStart),
    end: new Date(payload.windowEnd),
    limit: WINDOW_LIMIT,
  });

  if (closing.length === 0) {
    logNotificationEvent("evaluation.suppressed", {
      userId: payload.userId,
      intent: NotificationIntent.REGISTRATION_CLOSING,
      occurrenceKey: payload.occurrenceKey,
      reason: "NO_SUBJECTS_IN_WINDOW",
    });

    return completed("suppressed:NO_SUBJECTS_IN_WINDOW");
  }

  const competitionIds = closing.map((entry) => entry.competitionId);

  // `topN` is deliberately large: the engine ranks every open competition, and
  // the few closing inside a two-day band are an essentially arbitrary slice of
  // that ranking. Asking for the top five would almost always intersect to
  // nothing.
  const [recommendations, bookmarkedIds, registeredIds, alreadyNotified] =
    await Promise.all([
      RecommendationService.generateForUser({
        userId: payload.userId,
        topN: INTENT_CONFIG.registrationClosingRelevanceTopN,
      }),
      DeadlineWindowRepository.findBookmarkedIds(payload.userId, competitionIds),
      DeadlineWindowRepository.findRegisteredIds(payload.userId, competitionIds),
      NotificationRepository.findDeliveredTargetIds({
        userId: payload.userId,
        intent: NotificationIntent.REGISTRATION_CLOSING,
        targetType: NotificationTargetType.COMPETITION,
        targetIds: competitionIds,
      }),
    ]);

  const relevanceById = new Map(
    recommendations.items.map((item) => [item.competition.id, item.score]),
  );

  // The repository keys history by `(targetId, targetVersion)`; the policy
  // keys it by `(competitionId, deadline)`. Same thing, and they are translated
  // here rather than each deriving it, so the two cannot drift apart.
  const alreadyNotifiedKeys = new Set(
    closing
      .filter((entry) =>
        alreadyNotified.has(
          targetKey(entry.competitionId, deadlineOccasion(entry.deadline)),
        ),
      )
      .map((entry) => occasionKey(entry.competitionId, entry.deadline)),
  );

  const decision = evaluateRegistrationClosing({
    userId: payload.userId,
    enabled: true,
    // Both established above; passed so the pure policy states the full rule.
    entitled: true,
    candidates: closing.map((entry) => ({
      competitionId: entry.competitionId,
      competition: entry.card,
      deadline: entry.deadline,
    })),
    relevanceById,
    bookmarkedIds,
    registeredIds,
    alreadyNotifiedKeys,
    maxSubjects: INTENT_CONFIG.registrationClosingMaxSubjects,
    now: evaluatedAt,
  });

  if (!decision.eligible) {
    logNotificationEvent("evaluation.suppressed", {
      userId: payload.userId,
      intent: decision.intent,
      occurrenceKey: payload.occurrenceKey,
      reason: decision.reason,
      windowSize: closing.length,
    });

    return completed(`suppressed:${decision.reason}`);
  }

  const draft = renderRegistrationClosing(
    payload.userId,
    payload.occurrenceKey,
    decision.subjects,
  );

  const outcome = await NotificationGenerationService.generate(draft, evaluatedAt);

  return completed(
    outcome.created ? `created:${outcome.notificationId}` : "already-generated",
  );
};
