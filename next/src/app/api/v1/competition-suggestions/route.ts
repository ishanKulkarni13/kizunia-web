import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";


export async function POST(request: NextRequest) {
  return CompetitionSuggestionController.create(request);
}