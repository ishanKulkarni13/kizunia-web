import { NextRequest } from "next/server";
import { PushSubscriptionController } from "@/modules/notifications/backend/notification.controller";

export async function GET(request: NextRequest) {
  return PushSubscriptionController.listForCurrentUser(request);
}

export async function POST(request: NextRequest) {
  return PushSubscriptionController.registerForCurrentUser(request);
}
