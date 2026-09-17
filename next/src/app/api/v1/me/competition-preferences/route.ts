import { NextRequest } from "next/server";

import { CompetitionPreferenceController } from "@/modules/preferences/backend/competition-preference.controller";

export async function GET(request: NextRequest) {
  return CompetitionPreferenceController.getForCurrentUser(request);
}

export async function PUT(request: NextRequest) {
  return CompetitionPreferenceController.replaceForCurrentUser(request);
}
