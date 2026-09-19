import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return CompetitionSuggestionController.requestChanges(request, id);
}
