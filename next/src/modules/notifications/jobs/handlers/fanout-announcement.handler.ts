/**
 * Job handler — fan one announcement out to every eligible user.
 *
 * The only unit of work in this system that is not already bounded by a single
 * user, which makes it the only one that has to manage its own progress.
 *
 * ## How it continues
 *
 * It processes one page, then **re-arms its own row** with the cursor advanced
 * and returns `continued`.
 *
 * It cannot enqueue a successor job instead, and the reason is worth stating
 * because the alternative looks obvious: a successor would carry the same
 * dedupe key as the row creating it — the key is derived from the announcement,
 * which has not changed — and collide with itself on insert. Re-arming keeps
 * one row, one identity, and a visible cursor.
 *
 * The runner then re-claims it within the same drain pass, so a fan-out
 * finishes in one execution rather than advancing one page per tick.
 *
 * ## Why the eligibility query looks backwards
 *
 * Announcements default **on** (ND-P-16), so "users who want this" is not a
 * list of preference rows — most eligible users have no row at all. The query
 * is therefore over users, excluding those who have explicitly opted out, which
 * is the inverse of how the opt-in intents are scheduled.
 */
import {
  FeatureAnnouncementStatus,
  NotificationIntent,
  type NotificationJobKind,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { SCHEDULE_CONFIG } from "../../config/notification-config";
import { NotificationGenerationService } from "../../backend/notification-generation.service";
import { renderFeatureAnnouncement } from "../../content/renderers";
import { logNotificationEvent } from "../../observability/log";
import { PermanentJobError } from "../job-error";
import { completed, continued, type JobHandler } from "../handler";

export const fanoutAnnouncementHandler: JobHandler<
  typeof NotificationJobKind.FANOUT_ANNOUNCEMENT
> = async ({ job, payload, now, queue }) => {
  const announcement = await prisma.featureAnnouncement.findUnique({
    where: { id: payload.announcementId },
  });

  if (!announcement) {
    // Deleted between scheduling and running. Retrying cannot bring it back.
    throw new PermanentJobError(
      `Announcement ${payload.announcementId} no longer exists`,
    );
  }

  if (announcement.status === FeatureAnnouncementStatus.CANCELLED) {
    logNotificationEvent("announcement.fanout_cancelled", {
      announcementId: announcement.id,
      processed: payload.processed,
    });

    return completed("cancelled");
  }

  if (announcement.status === FeatureAnnouncementStatus.SCHEDULED) {
    await prisma.featureAnnouncement.update({
      where: { id: announcement.id },
      data: { status: FeatureAnnouncementStatus.PUBLISHING },
    });
  }

  const pageSize = SCHEDULE_CONFIG.userPageSize;

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      banned: { not: true },
      ...(payload.cursor ? { id: { gt: payload.cursor } } : {}),
      // Opted *out*, not opted in: no row means enabled for this intent.
      NOT: {
        notificationPreferences: {
          some: {
            intent: NotificationIntent.FEATURE_ANNOUNCEMENT,
            enabled: false,
          },
        },
      },
    },
    select: { id: true },
    // By id: stable, unique and indexed, which is what makes keyset pagination
    // correct while rows are being inserted underneath it. An offset would skip
    // or repeat users as the set shifted.
    orderBy: { id: "asc" },
    take: pageSize,
  });

  let created = 0;

  for (const user of users) {
    const draft = renderFeatureAnnouncement(user.id, payload.occurrenceKey, {
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      url: announcement.url,
    });

    // Per user, so one user's failure cannot abandon the rest of the page. The
    // cursor still advances past them: a user missed by a transient error is a
    // far smaller problem than a fan-out that cannot get past them.
    try {
      const outcome = await NotificationGenerationService.generate(draft, now);
      if (outcome.created) created += 1;
    } catch (error) {
      logNotificationEvent("announcement.fanout_user_failed", {
        announcementId: announcement.id,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const processed = payload.processed + users.length;

  if (users.length === pageSize) {
    const cursor = users[users.length - 1]?.id ?? payload.cursor;

    await queue.reschedule({
      jobId: job.id,
      now,
      // Immediately: the runner re-claims it in the same pass, so a large
      // fan-out finishes in one execution.
      runAt: now,
      payload: { ...payload, cursor, processed },
    });

    logNotificationEvent("announcement.fanout_page", {
      announcementId: announcement.id,
      created,
      processed,
      cursor,
    });

    return continued(`processed:${processed}`);
  }

  await prisma.featureAnnouncement.update({
    where: { id: announcement.id },
    data: {
      status: FeatureAnnouncementStatus.PUBLISHED,
      publishedAt: now,
    },
  });

  logNotificationEvent("announcement.fanout_complete", {
    announcementId: announcement.id,
    processed,
  });

  return completed(`processed:${processed}`);
};
