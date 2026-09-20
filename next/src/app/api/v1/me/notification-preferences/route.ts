import { NextRequest } from "next/server";

import { NotificationPreferenceController } from "@/modules/preferences/backend/notification-preference.controller";

export async function GET(request: NextRequest) {
  return NotificationPreferenceController.getForCurrentUser(request);
}

export async function PATCH(request: NextRequest) {
  return NotificationPreferenceController.updateForCurrentUser(request);
}
