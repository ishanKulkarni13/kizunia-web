import { NextRequest } from "next/server";
import { AnnouncementController } from "@/modules/notifications/backend/announcement.controller";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return AnnouncementController.cancel(request, id);
}
