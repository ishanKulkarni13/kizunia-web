import { HttpClient } from "@/lib/http/client";
import type { NotificationIntent } from "@/generated/prisma";

import type { NotificationPreferenceDTO } from "../types/notification-preference.dto";

const BASE_URL = "/api/v1/me/notification-preferences";

export class NotificationPreferenceApi {
  static async list(): Promise<NotificationPreferenceDTO[]> {
    const response = await HttpClient.get<{
      preferences: NotificationPreferenceDTO[];
    }>(BASE_URL);

    return response.data.preferences;
  }

  static async update(
    intent: NotificationIntent,
    enabled: boolean,
  ): Promise<NotificationPreferenceDTO> {
    const response = await HttpClient.patch<
      NotificationPreferenceDTO,
      { intent: NotificationIntent; enabled: boolean }
    >(BASE_URL, { intent, enabled });

    return response.data;
  }
}
