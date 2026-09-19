import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{
    id: string;
    assetId: string;
  }>;
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  const { id, assetId } = await context.params;

  return CompetitionSuggestionController.detachAsset(
    request,
    id,
    assetId,
  );
}
