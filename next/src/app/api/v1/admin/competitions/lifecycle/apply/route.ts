import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return CompetitionController.applyLifecycle(request);
}
