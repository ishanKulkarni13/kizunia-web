/**
 * Notifications — Inbox
 *
 * Business Layer
 *
 * Responsibilities
 * ----------------
 * ✓ Read one user's notifications, newest first
 * ✓ Move read and responded state forward
 * ✓ Map rows to DTOs
 *
 * Does NOT
 * ----------------
 * ✗ Parse requests or read sessions — the controller supplies the actor
 * ✗ Create notifications, or know how they were decided
 *
 * ## Ownership
 *
 * Every method takes a `userId` and passes it into the query's `where`, so a
 * query capable of touching another user's row is not expressible. That is
 * deliberately stronger than fetching a row and comparing afterwards: the
 * comparison is a line of code someone can forget, and forgetting it is
 * invisible until it matters.
 */
import { NotFoundError } from "@/lib/errors";

import { NotificationErrorCode } from "../errors/error-code";
import { NotificationRepository } from "./notification.repository";
import type {
  NotificationDTO,
  NotificationPageDTO,
} from "../types/notification.dto";

/** Bounded so a client cannot ask for an unbounded page. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

export class NotificationService {
  static async getInbox(input: {
    userId: string;
    limit?: number;
    cursor?: string;
    unreadOnly?: boolean;
  }): Promise<NotificationPageDTO> {
    const take = Math.min(
      Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );

    // One extra row, to tell "this is the last page" from "there is more"
    // without a second count query.
    const rows = await NotificationRepository.findPageForUser({
      userId: input.userId,
      take: take + 1,
      cursor: input.cursor,
      unreadOnly: input.unreadOnly,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    const unreadCount = await NotificationRepository.countUnread(input.userId);

    return {
      items: page.map(toDTO),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      unreadCount,
    };
  }

  static async getUnreadCount(userId: string): Promise<number> {
    return NotificationRepository.countUnread(userId);
  }

  /**
   * Marks one notification read.
   *
   * Idempotent: marking an already-read notification read again succeeds and
   * leaves the original timestamp alone. A client retrying a failed request
   * should not move the record.
   */
  static async markRead(userId: string, notificationId: string): Promise<void> {
    const changed = await NotificationRepository.markRead(
      userId,
      notificationId,
      new Date(),
    );

    if (changed) return;

    // Nothing changed: either already read, or not theirs. Only the second is
    // an error, and the difference is one existence check scoped to the user.
    await this.assertOwned(userId, notificationId);
  }

  static async markAllRead(userId: string): Promise<number> {
    return NotificationRepository.markAllRead(userId, new Date());
  }

  /**
   * Marks a notification responded — the user opened its action.
   *
   * Distinct from read (ND-H-10): read answers "does this still need my
   * attention", responded answers "did this notification achieve anything".
   * Neither is evidence about delivery.
   */
  static async markResponded(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const found = await NotificationRepository.markResponded(
      userId,
      notificationId,
      new Date(),
    );

    if (!found) {
      throw new NotFoundError({
        code: NotificationErrorCode.NOT_FOUND,
        message: "Notification not found.",
      });
    }
  }

  static async getOwned(
    userId: string,
    notificationId: string,
  ): Promise<NotificationDTO> {
    const row = await NotificationRepository.findOwnedById(userId, notificationId);

    if (!row) {
      throw new NotFoundError({
        code: NotificationErrorCode.NOT_FOUND,
        message: "Notification not found.",
      });
    }

    return toDTO(row);
  }

  /**
   * 404, never 403.
   *
   * Someone else's notification id is not information this user is entitled to
   * confirm. "Forbidden" would tell them the id exists, which is exactly the
   * fact being withheld.
   */
  private static async assertOwned(
    userId: string,
    notificationId: string,
  ): Promise<void> {
    const row = await NotificationRepository.findOwnedById(userId, notificationId);

    if (!row) {
      throw new NotFoundError({
        code: NotificationErrorCode.NOT_FOUND,
        message: "Notification not found.",
      });
    }
  }
}

type NotificationRow = Awaited<
  ReturnType<typeof NotificationRepository.findPageForUser>
>[number];

function toDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    intent: row.intent,
    title: row.title,
    body: row.body,
    actionPath: row.actionPath,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    targets: row.targets.map((target) => ({
      targetType: target.targetType,
      targetId: target.targetId,
      rank: target.rank,
    })),
    payload: row.payload,
  };
}
