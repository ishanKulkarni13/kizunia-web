import { HttpClient } from "@/lib/http/client";

import type { AnnouncementDTO } from "../backend/announcement.service";

const BASE_URL = "/api/v1/admin/notification-announcements";

export interface CreateAnnouncementBody {
  readonly title: string;
  readonly body: string;
  readonly url?: string;
  readonly scheduledFor?: string;
}

/**
 * The admin announcement client.
 *
 * `AnnouncementDTO` is imported from the service, which is a `backend/` file —
 * unusual, and safe here only because it is a `type` import that erases at
 * compile time, so no server code reaches the browser bundle. It is worth the
 * small irregularity to keep one definition of the shape rather than two that
 * can drift.
 */
export class AnnouncementApi {
  static async list(): Promise<AnnouncementDTO[]> {
    const response = await HttpClient.get<{ announcements: AnnouncementDTO[] }>(
      BASE_URL,
    );

    return response.data.announcements;
  }

  static async create(body: CreateAnnouncementBody): Promise<AnnouncementDTO> {
    const response = await HttpClient.post<AnnouncementDTO, CreateAnnouncementBody>(
      BASE_URL,
      body,
    );

    return response.data;
  }

  static async cancel(id: string): Promise<AnnouncementDTO> {
    const response = await HttpClient.delete<AnnouncementDTO>(`${BASE_URL}/${id}`);

    return response.data;
  }
}
