import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  const { id } = await context.params;

  return CompetitionSuggestionController.findById(
    request,
    id,
  );
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { id } = await context.params;

  return CompetitionSuggestionController.update(
    request,
    id,
  );
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  const { id } = await context.params;

  return CompetitionSuggestionController.delete(
    request,
    id,
  );
}