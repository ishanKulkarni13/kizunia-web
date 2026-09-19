import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  const { id } = await context.params;

  return CompetitionSuggestionController.submit(
    request,
    id,
  );
}