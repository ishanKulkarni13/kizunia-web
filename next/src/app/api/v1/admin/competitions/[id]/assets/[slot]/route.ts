import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      slot: string;
    }>;
  },
) {
  const { id, slot } = await params;

  // Slot is validated inside CompetitionController.setAsset — see
  // isCompetitionAssetSlot in modules/competitions/types/asset-slot.ts.
  return CompetitionController.setAsset(request, id, slot);
}