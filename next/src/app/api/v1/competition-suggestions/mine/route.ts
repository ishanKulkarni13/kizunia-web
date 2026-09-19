import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";


export async function GET(request: NextRequest) {
  return CompetitionSuggestionController.findMine(request);
}