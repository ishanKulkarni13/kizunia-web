/**
 * Notifications — Public DTOs
 *
 * The shapes the frontend sees. Pure types, safe for the module barrel and for
 * a client bundle.
 *
 * Timestamps are ISO strings rather than `Date`: these cross a JSON boundary,
 * where a `Date` becomes a string anyway, and typing it as a `Date` on both
 * sides would be a lie the client discovers at runtime.
 */
import type {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationIntent,
  NotificationTargetType,
} from "@/generated/prisma";

export interface NotificationTargetDTO {
  readonly targetType: NotificationTargetType;
  readonly targetId: string;
  readonly rank: number;
}

export interface NotificationDTO {
  readonly id: string;
  readonly intent: NotificationIntent;
  readonly title: string;
  readonly body: string;
  /** Site-relative, or null when there is nowhere to go. */
  readonly actionPath: string | null;
  readonly createdAt: string;
  /** Null while unread. Independent of delivery, and of `respondedAt`. */
  readonly readAt: string | null;
  /** Null until the user opens the action. */
  readonly respondedAt: string | null;
  readonly targets: readonly NotificationTargetDTO[];
  /**
   * The structured snapshot taken at generation. Present so a client can render
   * richer content than the title and body; absent for older or simpler
   * notifications, so a client must cope without it.
   */
  readonly payload: unknown;
}

export interface NotificationPageDTO {
  readonly items: readonly NotificationDTO[];
  /** Pass back as `cursor` for the next page. Null when this is the last. */
  readonly nextCursor: string | null;
  readonly unreadCount: number;
}

export interface PushSubscriptionDTO {
  readonly id: string;
  readonly provider: string;
  readonly userAgent: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

/**
 * Per-channel delivery state for one notification.
 *
 * Exposed only to the notification's owner, and only as a status — a user may
 * reasonably ask "was this pushed to my phone?", but provider message ids and
 * raw error codes are operational detail with no user-facing meaning.
 */
export interface NotificationDeliveryDTO {
  readonly channel: NotificationChannel;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
}
