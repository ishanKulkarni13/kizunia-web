/**
 * Notifications — Scheduler
 *
 * Business Layer
 *
 * Decides *that* work exists and enqueues it. Never does the work.
 *
 * Responsibilities
 * ----------------
 * ✓ Find users eligible for a scheduled intent
 * ✓ Find operational work that has come due, such as a suggestion awaiting review
 * ✓ Freeze the occasion and any evaluation window into each job's payload
 * ✓ Enqueue one job per unit of work, in bounded, resumable pages
 *
 * Does NOT
 * ----------------
 * ✗ Evaluate anything, or touch the recommendation engine
 * ✗ Create notifications
 * ✗ Know what invoked it — a cron request, an admin action and a test are the
 *   same caller as far as this file is concerned (principle 8)
 *
 * ## Why one job per user
 *
 * A sweep that evaluated every user inside one execution would be a single
 * unbounded unit of work: unresumable, unretryable per user, and fatal to
 * everyone if it failed for anyone. One job per user makes each user an
 * independent unit that can fail, retry and recover alone (NFR-1), and makes
 * the whole sweep resumable by construction (NFR-10).
 *
 * At 2,000 users that is 2,000 rows a day per intent. Cheap to insert in bulk,
 * cheap to claim in batches, and pruned once finished.
 *
 * ## Why the anchor is frozen here
 *
 * The occurrence key and the deadline window are computed once, in this file,
 * and carried in each payload. A worker recomputing them from its own clock
 * would produce a different occasion the moment a retry crossed UTC midnight,
 * and the unique constraint that prevents duplicates would never see a
 * collision (ND-D-07).
 */
import {
  NotificationIntent,
  NotificationJobKind,
  type Prisma,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import {
  ADMIN_NOTICE_CONFIG,
  INTENT_CONFIG,
  JOB_CONFIG,
  SCHEDULE_CONFIG,
} from "../config/notification-config";
import { logNotificationEvent } from "../observability/log";
import {
  adminSuggestionOccurrenceKey,
  deadlineWindow,
  evaluationOccurrenceKey,
  jobDedupeKey,
} from "../scheduling/occurrence";
import { entitledUsersWhereForIntent } from "./notification-entitlement";
import { SuggestionQueueRepository } from "./suggestion-queue.repository";
import type { EnqueueJobInput, WorkQueue } from "../jobs/work-queue.port";

/** Which intents have a scheduled sweep, and what job each produces. */
const SCHEDULED_INTENTS = [
  {
    intent: NotificationIntent.TOP_RELEVANT_COMPETITION,
    kind: NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
  },
  {
    intent: NotificationIntent.REGISTRATION_CLOSING,
    kind: NotificationJobKind.EVALUATE_REGISTRATION_CLOSING,
  },
] as const;

export interface ScheduleInput {
  readonly queue: WorkQueue;
  /** The evaluation anchor. Frozen into every job this pass creates. */
  readonly anchor: Date;
  readonly pageSize?: number;
  /** Restrict to one intent. Used by tests and by a targeted manual re-run. */
  readonly onlyIntent?: NotificationIntent;
}

export interface AdminNoticeScheduleInput {
  readonly queue: WorkQueue;
  /** The discovery anchor. Both window bounds are derived from it. */
  readonly anchor: Date;
  readonly pageSize?: number;
}

export interface ScheduleSummary {
  readonly enqueued: number;
  readonly duplicates: number;
  readonly usersConsidered: number;
}

export class NotificationSchedulerService {
  /**
   * Enqueues one evaluation job per eligible user, for every scheduled intent.
   *
   * Safe to run more than once for the same anchor: every job carries a dedupe
   * key built from the frozen occasion, so a second pass is absorbed as
   * duplicates rather than doubling the work (NFR-4).
   */
  static async scheduleDueEvaluations(
    input: ScheduleInput,
  ): Promise<ScheduleSummary> {
    const pageSize = input.pageSize ?? SCHEDULE_CONFIG.userPageSize;

    let enqueued = 0;
    let duplicates = 0;
    let usersConsidered = 0;

    const intents = input.onlyIntent
      ? SCHEDULED_INTENTS.filter((entry) => entry.intent === input.onlyIntent)
      : SCHEDULED_INTENTS;

    for (const { intent, kind } of intents) {
      const occurrenceKey = evaluationOccurrenceKey(intent, input.anchor);
      const payloadExtras = this.payloadExtrasFor(intent, input.anchor);

      let cursor: string | undefined;

      for (;;) {
        const userIds = await this.findEnabledUserIds(
          intent,
          input.anchor,
          pageSize,
          cursor,
        );

        if (userIds.length === 0) break;

        usersConsidered += userIds.length;

        const jobs: EnqueueJobInput[] = userIds.map((userId) => ({
          kind,
          dedupeKey: jobDedupeKey(kind, userId, occurrenceKey),
          runAt: input.anchor,
          maxAttempts: JOB_CONFIG.maxAttempts,
          payload: {
            userId,
            occurrenceKey,
            evaluatedAt: input.anchor.toISOString(),
            ...payloadExtras,
          },
        }));

        const result = await input.queue.enqueueMany(jobs);
        enqueued += result.created;
        duplicates += result.duplicates;

        if (userIds.length < pageSize) break;
        cursor = userIds[userIds.length - 1];
      }
    }

    const summary: ScheduleSummary = { enqueued, duplicates, usersConsidered };
    logNotificationEvent("scheduler.pass", { ...summary, anchor: input.anchor.toISOString() });

    return summary;
  }

  /**
   * Window bounds for intents that evaluate one, and nothing for those that do
   * not.
   *
   * Exhaustive over the enum, so an intent added with a window requirement
   * cannot silently be scheduled without one.
   */
  private static payloadExtrasFor(
    intent: NotificationIntent,
    anchor: Date,
  ): Record<string, unknown> {
    switch (intent) {
      case NotificationIntent.TOP_RELEVANT_COMPETITION:
        return {};
      case NotificationIntent.REGISTRATION_CLOSING: {
        const window = deadlineWindow(
          anchor,
          INTENT_CONFIG.registrationClosingOffsetSeconds,
          SCHEDULE_CONFIG.sweepIntervalSeconds,
        );

        return {
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
        };
      }
      case NotificationIntent.FEATURE_ANNOUNCEMENT:
        throw new Error("FEATURE_ANNOUNCEMENT is not a scheduled evaluation");
      case NotificationIntent.ADMIN_COMPETITION_SUGGESTION:
        // Not a per-user evaluation at all. Its work is discovered from the
        // review queue by `scheduleAdminSuggestionNotices`, which builds its own
        // payload — reaching here means an intent was added to
        // `SCHEDULED_INTENTS` that does not belong there.
        throw new Error(
          "ADMIN_COMPETITION_SUGGESTION is not a per-user scheduled evaluation",
        );
    }
  }

  /**
   * Enqueues one notice job per competition suggestion that has been waiting
   * long enough to be worth telling the reviewers about.
   *
   * ## Why this is a sweep and not a hook on submission
   *
   * Enqueueing at submit time would couple the competitions module to the
   * notification queue, and — more importantly — would put the only record that
   * a notice is owed inside a write that might not happen. A process that dies
   * between committing the submission and enqueueing the job would lose the
   * notice permanently, with nothing left to notice it was lost.
   *
   * Sweeping instead makes the **suggestion row itself** the durable record of
   * outstanding work. There is nothing to lose: a pass that dies mid-way simply
   * re-finds what it missed next time, because anything it already enqueued
   * collides on its dedupe key and costs nothing (NFR-2, NFR-4).
   *
   * ## Why the unit of work is the suggestion, not the reviewer
   *
   * Every other scheduled intent enqueues one job per *user*, because relevance
   * is computed per user and that is the expensive part. Here the expensive
   * part — "is this still awaiting review?" — is per suggestion and identical
   * for every reviewer, so evaluating it once per suggestion and fanning out
   * inside the job avoids doing the same read once per admin.
   *
   * ## Timing
   *
   * Two bounds, both derived from the frozen anchor. A suggestion is eligible
   * once it has waited `suggestionNoticeDelaySeconds` (the "not instant" half of
   * the product requirement) and stops being eligible after
   * `suggestionLookbackSeconds` (so enabling this feature does not page anyone
   * about a pre-existing backlog).
   *
   * The delivered latency is therefore `delay` to `delay + trigger cadence`.
   * Nothing here assumes what that cadence is — the same code yields ~30-45
   * minutes against a 15-minute trigger and up to a day against a daily one.
   */
  static async scheduleAdminSuggestionNotices(
    input: AdminNoticeScheduleInput,
  ): Promise<ScheduleSummary> {
    const pageSize = input.pageSize ?? SCHEDULE_CONFIG.userPageSize;
    const limit = ADMIN_NOTICE_CONFIG.suggestionDiscoveryLimit;

    const submittedBefore = new Date(
      input.anchor.getTime() -
        ADMIN_NOTICE_CONFIG.suggestionNoticeDelaySeconds * 1000,
    );
    const submittedAfter = new Date(
      input.anchor.getTime() -
        ADMIN_NOTICE_CONFIG.suggestionLookbackSeconds * 1000,
    );

    let enqueued = 0;
    let duplicates = 0;
    let considered = 0;
    let cursor: string | undefined;

    while (considered < limit) {
      const take = Math.min(pageSize, limit - considered);

      const suggestions = await SuggestionQueueRepository.findAwaitingReview({
        submittedAfter,
        submittedBefore,
        take,
        cursor,
      });

      if (suggestions.length === 0) break;

      considered += suggestions.length;

      const jobs: EnqueueJobInput[] = suggestions.map((suggestion) => {
        const occurrenceKey = adminSuggestionOccurrenceKey(
          suggestion.id,
          suggestion.submittedAt,
        );

        return {
          kind: NotificationJobKind.NOTIFY_ADMINS_OF_SUGGESTION,
          dedupeKey: jobDedupeKey(
            NotificationJobKind.NOTIFY_ADMINS_OF_SUGGESTION,
            suggestion.id,
            occurrenceKey,
          ),
          // Already due: the wait is expressed by *when this suggestion became
          // visible to the sweep*, not by a future run time. Deferring again
          // here would add a second, invisible delay on top of the first.
          runAt: input.anchor,
          maxAttempts: JOB_CONFIG.maxAttempts,
          payload: {
            suggestionId: suggestion.id,
            occurrenceKey,
            evaluatedAt: input.anchor.toISOString(),
            submittedAt: suggestion.submittedAt.toISOString(),
            cursor: null,
            processed: 0,
          },
        };
      });

      const result = await input.queue.enqueueMany(jobs);
      enqueued += result.created;
      duplicates += result.duplicates;

      if (suggestions.length < take) break;
      cursor = suggestions[suggestions.length - 1]?.id;
    }

    const summary: ScheduleSummary = {
      enqueued,
      duplicates,
      usersConsidered: considered,
    };

    logNotificationEvent("scheduler.admin_suggestion_pass", {
      ...summary,
      anchor: input.anchor.toISOString(),
      submittedAfter: submittedAfter.toISOString(),
      submittedBefore: submittedBefore.toISOString(),
    });

    return summary;
  }

  /**
   * Users who have this intent on, one page at a time, ordered by id.
   *
   * Ordering by id rather than by anything semantic is deliberate: it is stable,
   * unique and indexed, which is what makes keyset pagination correct while rows
   * are being inserted underneath it. An offset would skip or repeat users as
   * the set shifted.
   *
   * Note this reads **rows**, so it finds only users who have explicitly set the
   * preference. That is right for the opt-in intents; the announcement intent
   * defaults on and is fanned out differently, against the user table, precisely
   * because "no row" means enabled there (ND-P-16).
   */
  private static async findEnabledUserIds(
    intent: NotificationIntent,
    now: Date,
    take: number,
    cursor?: string,
  ): Promise<string[]> {
    const where: Prisma.NotificationPreferenceWhereInput = {
      intent,
      enabled: true,
      ...(cursor ? { userId: { gt: cursor } } : {}),
      user: {
        // A banned or deleted user should not be evaluated; the work would be
        // discarded at best and delivered at worst.
        banned: { not: true },
        status: "ACTIVE",
        // Only users whose effective access includes the capability this
        // intent requires (IB-2) — the set-based form of the same rule the
        // handler and delivery re-check per user, in this one query, with no
        // per-user round trips. No admin bypass: there is no actor here
        // (IB-7). Preferences of the users it excludes are left untouched.
        ...entitledUsersWhereForIntent(intent, now),
      },
    };

    const rows = await prisma.notificationPreference.findMany({
      where,
      select: { userId: true },
      orderBy: { userId: "asc" },
      take,
    });

    return rows.map((row) => row.userId);
  }
}
