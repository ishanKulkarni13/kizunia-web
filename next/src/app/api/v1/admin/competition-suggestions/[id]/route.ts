import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return CompetitionSuggestionController.findByIdForReview(request, id);
}
