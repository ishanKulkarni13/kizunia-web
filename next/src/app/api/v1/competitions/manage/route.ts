import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return CompetitionController.searchManageable(request);
}