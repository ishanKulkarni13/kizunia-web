import { NextRequest } from "next/server";
import { NotificationController } from "@/modules/notifications/backend/notification.controller";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NotificationController.markResponded(request, id);
}
