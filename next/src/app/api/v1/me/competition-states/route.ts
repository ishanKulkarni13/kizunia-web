import { NextRequest } from "next/server";

import { CompetitionController } from "@/modules/competitions/backend/controller";

export async function GET(request: NextRequest) {
  return CompetitionController.findMyCompetitionStates(request);
}
