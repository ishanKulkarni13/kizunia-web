import { NextRequest } from "next/server";
import { AnnouncementController } from "@/modules/notifications/backend/announcement.controller";

export async function GET(request: NextRequest) {
  return AnnouncementController.list(request);
}

export async function POST(request: NextRequest) {
  return AnnouncementController.create(request);
}
