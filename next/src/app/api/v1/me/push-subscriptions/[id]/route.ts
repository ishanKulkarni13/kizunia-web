import { NextRequest } from "next/server";
import { PushSubscriptionController } from "@/modules/notifications/backend/notification.controller";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return PushSubscriptionController.revokeForCurrentUser(request, id);
}
