import { HttpClient } from "@/lib/http/client";

import type {
  NotificationPageDTO,
  PushSubscriptionDTO,
} from "../types/notification.dto";

const NOTIFICATIONS_URL = "/api/v1/me/notifications";
const PUSH_URL = "/api/v1/me/push-subscriptions";

export interface ListNotificationsParams {
  readonly limit?: number;
  readonly cursor?: string;
  readonly unreadOnly?: boolean;
}

export class NotificationApi {
  static async list(
    params: ListNotificationsParams = {},
  ): Promise<NotificationPageDTO> {
    const query = new URLSearchParams();
    if (params.limit) query.set("limit", String(params.limit));
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.unreadOnly) query.set("unreadOnly", "true");

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const response = await HttpClient.get<NotificationPageDTO>(
      `${NOTIFICATIONS_URL}${suffix}`,
    );

    return response.data;
  }

  static async unreadCount(): Promise<number> {
    const response = await HttpClient.get<{ unreadCount: number }>(
      `${NOTIFICATIONS_URL}/unread-count`,
    );

    return response.data.unreadCount;
  }

  static async markRead(notificationId: string): Promise<void> {
    await HttpClient.patch(`${NOTIFICATIONS_URL}/${notificationId}/read`, {});
  }

  static async markAllRead(): Promise<number> {
    const response = await HttpClient.patch<{ updated: number }, object>(
      `${NOTIFICATIONS_URL}/read-all`,
      {},
    );

    return response.data.updated;
  }

  /**
   * Records that the user opened a notification's action.
   *
   * Distinct from marking it read: read answers "does this still need my
   * attention", responded answers "did this notification achieve anything".
   */
  static async markResponded(notificationId: string): Promise<void> {
    await HttpClient.patch(
      `${NOTIFICATIONS_URL}/${notificationId}/responded`,
      {},
    );
  }
}

export class PushSubscriptionApi {
  static async register(
    token: string,
    userAgent?: string,
  ): Promise<PushSubscriptionDTO> {
    const response = await HttpClient.post<
      PushSubscriptionDTO,
      { token: string; userAgent?: string }
    >(PUSH_URL, { token, userAgent });

    return response.data;
  }

  static async list(): Promise<PushSubscriptionDTO[]> {
    const response = await HttpClient.get<{
      subscriptions: PushSubscriptionDTO[];
    }>(PUSH_URL);

    return response.data.subscriptions;
  }

  static async revoke(subscriptionId: string): Promise<void> {
    await HttpClient.delete(`${PUSH_URL}/${subscriptionId}`);
  }
}
