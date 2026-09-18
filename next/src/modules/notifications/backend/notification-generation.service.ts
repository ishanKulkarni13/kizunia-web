/**
 * Notifications — Generation
 *
 * Business Layer
 *
 * Turns a draft into everything that has to exist for a user to actually be
 * told: the inbox record, its subjects, its in-app delivery, and the job that
 * will attempt a push.
 *
 * Responsibilities
 * ----------------
 * ✓ Persist a notification and everything downstream of it, atomically
 * ✓ Treat an already-generated occurrence as success, not failure
 * ✓ Create the delivery work, so nothing has to remember to
 *
 * Does NOT
 * ----------------
 * ✗ Decide whether to notify — that is the policy's job
 * ✗ Render content — that is the renderer's job
 * ✗ Send anything. It creates work; the delivery layer does the sending
 *
 * ## The transactional outbox
 *
 * The notification, its targets, its in-app delivery, its push deliveries and
 * the delivery job are written in **one transaction**. This is the single most
 * important property of this file.
 *
 * Without it there are two ways to be wrong, and both are silent:
 *
 *  - commit the notification, fail before the job: an inbox row nobody will
 *    ever deliver, and no retry will find it because nothing knows it is owed;
 *  - commit the job, fail before the notification: a delivery job pointing at a
 *    row that does not exist, which fails its attempts and gives up.
 *
 * One transaction removes both. Either the user is owed a notification and the
 * work to deliver it exists, or nothing happened at all.
 */
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationJobKind,
  type Prisma,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { DELIVERY_CONFIG, JOB_CONFIG } from "../config/notification-config";
import type { NotificationDraft } from "../content/notification-draft";
import { jobDedupeKey } from "../scheduling/occurrence";
import { logNotificationEvent } from "../observability/log";

export type GenerationOutcome =
  | { readonly created: true; readonly notificationId: string }
  /** The occurrence already existed. A re-run, and the desired end state. */
  | { readonly created: false; readonly reason: "ALREADY_GENERATED" };

const UNIQUE_VIOLATION = "P2002";

export class NotificationGenerationService {
  /**
   * Persists one notification and the work to deliver it.
   *
   * `now` is supplied by the caller and is only ever used for timestamps and
   * scheduling — never for a decision, which was already made and frozen before
   * this point (ND-D-07).
   */
  static async generate(
    draft: NotificationDraft,
    now: Date,
  ): Promise<GenerationOutcome> {
    const outcome = await prisma.$transaction(async (tx) => {
      const created = await this.createNotification(tx, draft);

      if (!created) return null;

      await this.createInAppDelivery(tx, created);
      await this.enqueueDeliveryJob(tx, created, draft, now);

      return created;
    });

    if (outcome === null) {
      logNotificationEvent("generation.already_generated", {
        userId: draft.userId,
        intent: draft.intent,
        occurrenceKey: draft.occurrenceKey,
      });

      return { created: false, reason: "ALREADY_GENERATED" };
    }

    logNotificationEvent("generation.created", {
      notificationId: outcome,
      userId: draft.userId,
      intent: draft.intent,
      occurrenceKey: draft.occurrenceKey,
      targets: draft.targets.length,
    });

    return { created: true, notificationId: outcome };
  }

  /** Returns the new notification's id, or null if this occurrence already existed. */
  private static async createNotification(
    tx: Prisma.TransactionClient,
    draft: NotificationDraft,
  ): Promise<string | null> {
    try {
      const notification = await tx.notification.create({
        data: {
          userId: draft.userId,
          intent: draft.intent,
          occurrenceKey: draft.occurrenceKey,
          title: draft.title,
          body: draft.body,
          actionPath: draft.actionPath,
          payload: (draft.payload ?? undefined) as Prisma.InputJsonValue | undefined,
          targets: {
            create: draft.targets.map((target) => ({
              userId: draft.userId,
              targetType: target.targetType,
              targetId: target.targetId,
              targetVersion: target.targetVersion,
              rank: target.rank,
            })),
          },
        },
        select: { id: true },
      });

      return notification.id;
    } catch (error) {
      // Only the occurrence constraint means "already generated".
      //
      // Catching *any* unique violation here would be a silent trap: a genuine
      // data problem — two targets with the same identity, say — would be
      // reported as a harmless re-run, the notification would never be created,
      // and nothing would error, retry, or leave a trace. Narrowing the catch
      // is what keeps "this already happened" from absorbing "this is broken".
      if (isUniqueViolationOn(error, "occurrenceKey")) return null;
      throw error;
    }
  }

  /**
   * The in-app delivery, created already `DELIVERED`.
   *
   * For an inbox there is no transport and no acknowledgement — the row being
   * committed and visible *is* the delivery (ND-D-04). This is also what makes
   * deduplication work: `delivered` means the user is reasonably presumed to
   * have been told, and an inbox entry they can open satisfies that whether or
   * not a push ever succeeds.
   */
  private static async createInAppDelivery(
    tx: Prisma.TransactionClient,
    notificationId: string,
  ): Promise<void> {
    try {
      await tx.notificationDelivery.create({
        data: {
          notificationId,
          channel: NotificationChannel.IN_APP,
          status: NotificationDeliveryStatus.DELIVERED,
          attempts: 1,
          maxAttempts: 1,
          lastAttemptAt: new Date(),
        },
      });
    } catch (error) {
      // The uniqueness of one in-app row per notification is enforced by a
      // PARTIAL index the Prisma client does not know about, so this cannot be
      // an upsert — it has to be a create whose violation is caught here.
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }

  /**
   * Work to attempt a push.
   *
   * Enqueued unconditionally, without checking whether the user has any
   * subscriptions: that check belongs to the delivery layer, which is where it
   * can be re-done at send time. A user who registers a browser between
   * generation and delivery should still get the push, and a user with none
   * costs one cheap job that resolves to `SKIPPED`.
   *
   * Inside the same transaction as the notification, which is the whole point
   * (see the file docstring).
   */
  private static async enqueueDeliveryJob(
    tx: Prisma.TransactionClient,
    notificationId: string,
    draft: NotificationDraft,
    now: Date,
  ): Promise<void> {
    try {
      await tx.notificationJob.create({
        data: {
          kind: NotificationJobKind.DELIVER_NOTIFICATION,
          dedupeKey: jobDedupeKey(
            NotificationJobKind.DELIVER_NOTIFICATION,
            notificationId,
            draft.occurrenceKey,
          ),
          // Immediately. Push is the one part of this pipeline a user might
          // notice the latency of, so it waits only for the next drain.
          runAt: now,
          maxAttempts: Math.max(
            JOB_CONFIG.maxAttempts,
            DELIVERY_CONFIG.pushMaxAttempts,
          ),
          payload: { notificationId },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * A unique violation on a specific constraint.
 *
 * Prisma reports the offending constraint in `meta.target`, sometimes as the
 * field names and sometimes as the index name depending on the constraint and
 * the connector — so this matches a marker substring against whichever form
 * arrives rather than assuming one.
 */
function isUniqueViolationOn(error: unknown, marker: string): boolean {
  if (!isUniqueViolation(error)) return false;

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  // No target reported: refuse to guess. Treating an unattributed violation as
  // the expected one is how a real failure gets swallowed.
  if (target === undefined || target === null) return false;

  return JSON.stringify(target).includes(marker);
}
