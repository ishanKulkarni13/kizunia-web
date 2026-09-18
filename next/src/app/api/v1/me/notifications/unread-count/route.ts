import { NextRequest } from "next/server";
import { NotificationController } from "@/modules/notifications/backend/notification.controller";

export async function GET(request: NextRequest) {
  return NotificationController.unreadCountForCurrentUser(request);
}
