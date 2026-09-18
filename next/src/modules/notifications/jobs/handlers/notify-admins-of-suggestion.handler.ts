/**
 * Job handler — tell the reviewers about one competition suggestion.
 *
 * Sequences the same three steps every other evaluation handler does — policy
 * decides, renderer words it, generation persists and queues delivery — with
 * one structural difference: the unit of work is a *suggestion*, and the
 * fan-out is over recipients rather than over subjects.
 *
 * ## Why it re-reads the suggestion
 *
 * This is the one handler whose job is scheduled deliberately *late*. Between
 * discovery and here, the ordinary things happen: an admin already watching the
 * queue reviews it, the contributor withdraws it, a resubmission supersedes it.
 * Re-reading is what turns that delay into a feature instead of a source of
 * stale notices (ND-D-12).
 *
 * What it does **not** re-derive is the occasion. `occurrenceKey` and
 * `submittedAt` come from the payload exactly as the discovery pass froze them
 * (ND-D-07) — they are the identity this job deduplicates on, and recomputing
 * them from a row that may have moved is how a resubmission would quietly
 * notify twice about the same submission.
 *
 * ## Why it re-arms its own row
 *
 * Same reason as the announcement fan-out: a successor job would derive the
 * same dedupe key from the same suggestion and the same occasion, and collide
 * with the row that created it. One row, one identity, a visible cursor.
 *
 * In practice reviewers number in the low tens, so the loop almost always
 * finishes in one page. It pages anyway — "there are only ever a few admins" is
 * an assumption about deployment, not an invariant, and the cost of being wrong
 * is an unbounded unit of work.
 */
import type { NotificationJobKind } from "@/generated/prisma";

import { SCHEDULE_CONFIG } from "../../config/notification-config";
import { NotificationGenerationService } from "../../backend/notification-generation.service";
import { SuggestionQueueRepository } from "../../backend/suggestion-queue.repository";
import { renderAdminSuggestionReview } from "../../content/renderers";
import { logNotificationEvent } from "../../observability/log";
import {
  isSuggestionStillAwaitingReview,
  shouldNotifyReviewer,
} from "../../policy/admin-suggestion-review.policy";
import { PermanentJobError } from "../job-error";
import { completed, continued, type JobHandler } from "../handler";

export const notifyAdminsOfSuggestionHandler: JobHandler<
  typeof NotificationJobKind.NOTIFY_ADMINS_OF_SUGGESTION
> = async ({ job, payload, now, queue }) => {
  const suggestion = await SuggestionQueueRepository.findReviewState(
    payload.suggestionId,
  );

  if (!suggestion) {
    // Hard-deleted between discovery and now. A retry cannot bring it back, so
    // failing permanently is the honest outcome — burning four more attempts to
    // rediscover that would only delay the same conclusion.
    throw new PermanentJobError(
      `Competition suggestion ${payload.suggestionId} no longer exists`,
    );
  }

  const submittedAt = new Date(payload.submittedAt);
  const stillPending = isSuggestionStillAwaitingReview(suggestion, submittedAt);

  if (!stillPending.eligible) {
    // A completed job, not a failed one. Nothing went wrong: the queue item was
    // dealt with, which is the outcome everyone wanted. Logged because a
    // suppressed notice leaves no row, and without this line "handled quickly"
    // and "the sweep never ran" look identical a week later.
    logNotificationEvent("admin_suggestion.suppressed", {
      suggestionId: suggestion.id,
      occurrenceKey: payload.occurrenceKey,
      reason: stillPending.reason,
      processed: payload.processed,
    });

    return completed(`suppressed:${stillPending.reason}`);
  }

  const pageSize = SCHEDULE_CONFIG.userPageSize;

  const reviewers = await SuggestionQueueRepository.findReviewersPage({
    take: pageSize,
    cursor: payload.cursor,
  });

  let created = 0;
  let skipped = 0;

  for (const reviewer of reviewers) {
    const decision = shouldNotifyReviewer(
      { recipientId: reviewer.id, intentEnabled: reviewer.intentEnabled },
      suggestion,
    );

    if (!decision.eligible) {
      skipped += 1;
      continue;
    }

    const draft = renderAdminSuggestionReview(
      reviewer.id,
      payload.occurrenceKey,
      {
        id: suggestion.id,
        title: suggestion.suggestionTitle,
        submittedBy: suggestion.submittedByName,
        submittedAt,
      },
    );

    // Per recipient, so one reviewer's failure cannot abandon the rest of the
    // page. The cursor still advances past them: a reviewer missed by a
    // transient error is a far smaller problem than a fan-out that cannot get
    // past them — and the notification they missed is still in the review
    // queue, which is the actual source of truth for their work.
    try {
      const outcome = await NotificationGenerationService.generate(draft, now);
      if (outcome.created) created += 1;
    } catch (error) {
      logNotificationEvent("admin_suggestion.recipient_failed", {
        suggestionId: suggestion.id,
        recipientId: reviewer.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const processed = payload.processed + reviewers.length;

  if (reviewers.length === pageSize) {
    const cursor = reviewers[reviewers.length - 1]?.id ?? payload.cursor;

    await queue.reschedule({
      jobId: job.id,
      now,
      // Immediately: the runner re-claims it inside the same drain pass, so a
      // fan-out finishes in one execution rather than one page per tick.
      runAt: now,
      payload: { ...payload, cursor, processed },
    });

    logNotificationEvent("admin_suggestion.fanout_page", {
      suggestionId: suggestion.id,
      created,
      skipped,
      processed,
      cursor,
    });

    return continued(`processed:${processed}`);
  }

  logNotificationEvent("admin_suggestion.fanout_complete", {
    suggestionId: suggestion.id,
    occurrenceKey: payload.occurrenceKey,
    created,
    skipped,
    processed,
  });

  return completed(`notified:${created}`);
};
