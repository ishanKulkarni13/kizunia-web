import { NextRequest } from "next/server";
import { NotificationController } from "@/modules/notifications/backend/notification.controller";

export async function PATCH(request: NextRequest) {
  return NotificationController.markAllRead(request);
}
