import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      type: string;
    }>;
  },
) {
  const { id, type } = await params;

  return CompetitionController.detachEligibility(request, id, type);
}
