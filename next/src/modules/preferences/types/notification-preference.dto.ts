import type { NotificationIntent } from "@/generated/prisma";

export interface NotificationPreferenceDTO {
  readonly intent: NotificationIntent;
  readonly enabled: boolean;
}
