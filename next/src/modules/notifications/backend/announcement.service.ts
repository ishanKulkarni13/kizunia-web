/**
 * Notifications — Feature Announcements
 *
 * Business Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Authorize, then create, schedule and cancel announcements
 * ✓ Enqueue the fan-out that turns one announcement into many notifications
 *
 * Does NOT
 * ----------------
 * ✗ Fan out itself. A write that touches every user must not happen inside the
 *   request that authored it
 * ✗ Parse requests or read sessions
 *
 * ## Why authoring and sending are separate
 *
 * An admin pressing "publish" enqueues one job. The fan-out then runs in the
 * background, in resumable pages. Doing it inline would mean the author's
 * request holding a connection open across thousands of writes, timing out
 * partway, and leaving nobody able to say how far it got.
 */
import { FeatureAnnouncementStatus, NotificationJobKind } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import type { StrictAuthorizationActor } from "@/authorization";
import { ConflictError, HttpStatus, NotFoundError, ValidationError } from "@/lib/errors";

import { JOB_CONFIG } from "../config/notification-config";
import {
  ANNOUNCEMENT_URL_MESSAGE,
  isSafeAnnouncementUrl,
} from "../content/announcement-url";
import { NotificationErrorCode } from "../errors/error-code";
import { logNotificationEvent } from "../observability/log";
import { announcementOccurrenceKey, jobDedupeKey } from "../scheduling/occurrence";
import type { CreateAnnouncementInput } from "../schemas/announcement";
import { NotificationAnnouncementAuthorizer } from "./authorization/authorizer";

export interface AnnouncementDTO {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly status: FeatureAnnouncementStatus;
  readonly scheduledFor: string;
  readonly publishedAt: string | null;
  readonly createdAt: string;
}

export class AnnouncementService {
  /**
   * Creates an announcement and schedules its delivery.
   *
   * The fan-out job is enqueued in the same transaction as the announcement
   * row, for the same reason generation is atomic: an announcement that exists
   * but has no job would sit in `SCHEDULED` forever, and a job with no
   * announcement would fail its attempts and give up.
   */
  static async create(
    actor: StrictAuthorizationActor,
    input: CreateAnnouncementInput,
  ): Promise<AnnouncementDTO> {
    NotificationAnnouncementAuthorizer.manage({ actor });

    // Re-checked here, not trusted from the schema. This is the only
    // notification content a human authors, and the HTTP path is not the only
    // caller — a seed script or an internal tool never passes through zod. See
    // `content/announcement-url.ts`.
    if (input.url !== undefined && !isSafeAnnouncementUrl(input.url)) {
      throw new ValidationError({
        code: NotificationErrorCode.INVALID_ANNOUNCEMENT_URL,
        status: HttpStatus.BAD_REQUEST,
        message: ANNOUNCEMENT_URL_MESSAGE,
        details: { field: "url" },
      });
    }

    const now = new Date();
    const scheduledFor = input.scheduledFor ?? now;

    const announcement = await prisma.$transaction(async (tx) => {
      const created = await tx.featureAnnouncement.create({
        data: {
          title: input.title,
          body: input.body,
          url: input.url ?? null,
          createdById: actor.id,
          scheduledFor,
          status: FeatureAnnouncementStatus.SCHEDULED,
        },
      });

      await tx.notificationJob.create({
        data: {
          kind: NotificationJobKind.FANOUT_ANNOUNCEMENT,
          dedupeKey: jobDedupeKey(
            NotificationJobKind.FANOUT_ANNOUNCEMENT,
            created.id,
            announcementOccurrenceKey(created.id),
          ),
          // The scheduled time *is* the run time. No separate immediate path.
          runAt: scheduledFor,
          maxAttempts: JOB_CONFIG.maxAttempts,
          payload: {
            announcementId: created.id,
            occurrenceKey: announcementOccurrenceKey(created.id),
            evaluatedAt: now.toISOString(),
            cursor: null,
            processed: 0,
          },
        },
      });

      return created;
    });

    logNotificationEvent("announcement.scheduled", {
      announcementId: announcement.id,
      scheduledFor: scheduledFor.toISOString(),
      createdById: actor.id,
    });

    return toDTO(announcement);
  }

  static async list(
    actor: StrictAuthorizationActor,
    limit = 20,
  ): Promise<AnnouncementDTO[]> {
    NotificationAnnouncementAuthorizer.manage({ actor });

    const rows = await prisma.featureAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map(toDTO);
  }

  /**
   * Cancels an announcement that has not finished going out.
   *
   * Cancelling mid-fan-out stops *further* fan-out. It does not retract
   * notifications already created: those are history, and history is not
   * rewritten (ND-H-02). Worth knowing before pressing the button, which is why
   * the admin UI says so.
   */
  static async cancel(
    actor: StrictAuthorizationActor,
    announcementId: string,
  ): Promise<AnnouncementDTO> {
    NotificationAnnouncementAuthorizer.manage({ actor });

    const existing = await prisma.featureAnnouncement.findUnique({
      where: { id: announcementId },
    });

    if (!existing) {
      throw new NotFoundError({
        code: NotificationErrorCode.ANNOUNCEMENT_NOT_FOUND,
        message: "Announcement not found.",
      });
    }

    if (
      existing.status === FeatureAnnouncementStatus.PUBLISHED ||
      existing.status === FeatureAnnouncementStatus.CANCELLED
    ) {
      throw new ConflictError({
        code: NotificationErrorCode.ANNOUNCEMENT_NOT_EDITABLE,
        status: HttpStatus.CONFLICT,
        message:
          existing.status === FeatureAnnouncementStatus.PUBLISHED
            ? "This announcement has already gone out."
            : "This announcement is already cancelled.",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.featureAnnouncement.update({
        where: { id: announcementId },
        data: { status: FeatureAnnouncementStatus.CANCELLED },
      });

      // Cancel the job too, so a worker does not pick up work for something
      // that has been called off.
      await tx.notificationJob.updateMany({
        where: {
          dedupeKey: jobDedupeKey(
            NotificationJobKind.FANOUT_ANNOUNCEMENT,
            announcementId,
            announcementOccurrenceKey(announcementId),
          ),
          status: { in: ["PENDING", "PROCESSING"] },
        },
        data: { status: "CANCELLED", completedAt: new Date() },
      });

      return row;
    });

    logNotificationEvent("announcement.cancelled", {
      announcementId,
      cancelledBy: actor.id,
    });

    return toDTO(updated);
  }
}

function toDTO(row: {
  id: string;
  title: string;
  body: string;
  url: string | null;
  status: FeatureAnnouncementStatus;
  scheduledFor: Date;
  publishedAt: Date | null;
  createdAt: Date;
}): AnnouncementDTO {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    url: row.url,
    status: row.status,
    scheduledFor: row.scheduledFor.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
