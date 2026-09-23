/**
 * Notifications — Repository
 *
 * Database Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Build Prisma queries
 * ✓ Execute database operations
 * ✓ Translate constraint violations into a domain-meaningful result
 *
 * Does NOT
 * ----------------
 * ✗ Business rules  ✗ Validation  ✗ Authentication  ✗ Authorization
 */
import { Prisma, type NotificationIntent, type NotificationTargetType } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import type { NotificationDraft } from "../content/notification-draft";

const UNIQUE_VIOLATION = "P2002";

export interface CreateNotificationResult {
  /** False when this occurrence already existed — a success (ND-D-06). */
  readonly created: boolean;
  readonly notificationId: string | null;
}

export interface DeliveredTargetKey {
  readonly targetType: NotificationTargetType;
  readonly targetId: string;
  readonly targetVersion: string | null;
}

export interface InboxPageInput {
  readonly userId: string;
  readonly take: number;
  /** Id of the last row from the previous page. */
  readonly cursor?: string;
  readonly unreadOnly?: boolean;
}

export class NotificationRepository {
  /**
   * Creates a notification with its targets, inside a caller-supplied
   * transaction.
   *
   * Takes `tx` rather than opening its own because the notification, its
   * targets, its deliveries and the job that delivers them have to commit
   * together or not at all — the caller owns that boundary.
   *
   * A uniqueness violation on `(userId, intent, occurrenceKey)` is reported as
   * `created: false` rather than thrown: it means the work already happened,
   * which is what the caller wanted (ND-D-06).
   */
  static async createWithTargets(
    tx: Prisma.TransactionClient,
    draft: NotificationDraft,
  ): Promise<CreateNotificationResult> {
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
              // Denormalised so the deduplication lookup needs no join. The
              // draft's user is authoritative; a target cannot belong to
              // someone else.
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

      return { created: true, notificationId: notification.id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return { created: false, notificationId: null };
      }

      throw error;
    }
  }

  /**
   * Which of these subjects has this user already been **delivered** a
   * notification about, for this intent?
   *
   * Delivered, not merely generated: an undelivered notification has told the
   * user nothing and must not consume the subject
   * ([ND-H-03](../../../../docs/project/feature-specification/notification/decisions/history.md)).
   *
   * Runs per user on every evaluation, which is why the target table carries a
   * denormalised `userId` and an index on exactly this shape.
   */
  static async findDeliveredTargetIds(input: {
    userId: string;
    intent: NotificationIntent;
    targetType: NotificationTargetType;
    targetIds: readonly string[];
  }): Promise<Set<string>> {
    if (input.targetIds.length === 0) return new Set();

    const rows = await prisma.notificationTarget.findMany({
      where: {
        userId: input.userId,
        targetType: input.targetType,
        targetId: { in: [...input.targetIds] },
        notification: {
          intent: input.intent,
          deliveries: {
            some: { status: { in: ["SENT", "DELIVERED"] } },
          },
        },
      },
      select: { targetId: true, targetVersion: true },
    });

    // Keyed by subject *and occasion*: the same competition with a moved
    // deadline is a new event and is deliberately not suppressed (ND-H-12).
    return new Set(
      rows.map((row) => targetKey(row.targetId, row.targetVersion)),
    );
  }

  /** Newest first, keyset-paginated. */
  static async findPageForUser(input: InboxPageInput) {
    return prisma.notification.findMany({
      where: {
        userId: input.userId,
        ...(input.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursor
        ? { cursor: { id: input.cursor }, skip: 1 }
        : {}),
      include: {
        targets: { orderBy: { rank: "asc" } },
      },
    });
  }

  static async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Marks one notification read, scoped by user.
   *
   * The user id is part of the `where`, not checked afterwards: a query that
   * cannot match another user's row is a stronger guarantee than a comparison
   * someone can forget to write.
   *
   * Returns whether a row changed, so a caller can tell "already read" from
   * "not yours" — which the service turns into a 404 rather than revealing that
   * the notification exists.
   */
  static async markRead(
    userId: string,
    notificationId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await prisma.notification.updateMany({
      // `readAt: null` keeps this idempotent and preserves the original
      // timestamp — re-reading something does not make it newly read.
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: now },
    });

    return result.count > 0;
  }

  static async markAllRead(userId: string, now: Date): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });

    return result.count;
  }

  /**
   * Marks a notification responded — the user opened its action.
   *
   * Also marks it read if it was not already: opening something is stronger
   * evidence of having seen it than the inbox's own read signal, and leaving it
   * unread afterwards would be visibly wrong.
   *
   * Each timestamp is only ever written once. Responding to something already
   * read must not move its `readAt`, and repeating the call — a double click,
   * a retried request, a second push click — must not move either.
   */
  static async markResponded(
    userId: string,
    notificationId: string,
    now: Date,
  ): Promise<boolean> {
    await prisma.$transaction([
      prisma.notification.updateMany({
        where: { id: notificationId, userId, respondedAt: null },
        data: { respondedAt: now },
      }),
      prisma.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: now },
      }),
    ]);

    // Distinguishes "already responded" (fine) from "not this user's", which
    // the service turns into a 404 without leaking that the id exists.
    const exists = await prisma.notification.count({
      where: { id: notificationId, userId },
    });

    return exists > 0;
  }

  static async findOwnedById(userId: string, notificationId: string) {
    return prisma.notification.findFirst({
      where: { id: notificationId, userId },
      include: { targets: { orderBy: { rank: "asc" } } },
    });
  }
}

/** The composite identity of a subject occasion, as one comparable string. */
export function targetKey(targetId: string, targetVersion: string | null): string {
  return `${targetId}::${targetVersion ?? ""}`;
}
