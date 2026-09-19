import { CompetitionSuggestionController } from "@/modules/competitions/backend/suggestion/controller";
import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{
    id: string;
    assetId: string;
  }>;
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id, assetId } = await params;

  return CompetitionSuggestionController.adminDetachAsset(
    request,
    id,
    assetId,
  );
}
