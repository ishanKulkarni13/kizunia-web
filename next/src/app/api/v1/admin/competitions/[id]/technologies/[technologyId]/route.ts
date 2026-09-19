import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      technologyId: string;
    }>;
  },
) {
  const { id, technologyId } = await params;

  return CompetitionController.detachTechnology(request, id, technologyId);
}
