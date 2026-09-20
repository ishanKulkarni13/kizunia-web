/**
 * Job handler — evaluate `TOP_RELEVANT_COMPETITION` for one user.
 *
 * The whole span from "it is this user's turn" to "the notification exists and
 * a push is queued", and nothing more. Every step it performs already belongs
 * to something else:
 *
 *   policy     decides whether to notify, and about what
 *   renderer   decides what it says
 *   generation decides how it is stored and delivered
 *
 * This file only sequences them and reports the outcome, which is why it is
 * short and why adding an intent does not make it longer.
 */
import type { NotificationJobKind } from "@/generated/prisma";

import { NotificationGenerationService } from "../../backend/notification-generation.service";
import { NotificationPolicyService } from "../../backend/notification-policy.service";
import { renderTopRelevantCompetition } from "../../content/renderers";
import { logNotificationEvent } from "../../observability/log";
import { completed, type JobHandler } from "../handler";

export const evaluateTopRelevantCompetitionHandler: JobHandler<
  typeof NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION
> = async ({ payload }) => {
  // The anchor the scheduler froze, not the worker's clock. A retry that
  // crosses UTC midnight must still be evaluating *that* day's occasion.
  const evaluatedAt = new Date(payload.evaluatedAt);

  const decision = await NotificationPolicyService.evaluateTopRelevantCompetition(
    payload.userId,
    evaluatedAt,
  );

  if (!decision.eligible) {
    // Silence is a normal, frequent outcome (ND-I-05), so it leaves no row —
    // which is exactly why it has to leave a log line. Otherwise "no
    // notification today" and "the sweep never ran" look identical afterwards.
    logNotificationEvent("evaluation.suppressed", {
      userId: payload.userId,
      intent: decision.intent,
      occurrenceKey: payload.occurrenceKey,
      reason: decision.reason,
    });

    return completed(`suppressed:${decision.reason}`);
  }

  const draft = renderTopRelevantCompetition(
    payload.userId,
    payload.occurrenceKey,
    decision.subjects,
  );

  const outcome = await NotificationGenerationService.generate(draft, evaluatedAt);

  // An already-generated occurrence is a completed job, not a failed one: the
  // end state the caller wanted is the end state that exists (ND-D-06).
  return completed(
    outcome.created ? `created:${outcome.notificationId}` : "already-generated",
  );
};
