import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      locationId: string;
    }>;
  },
) {
  const { id, locationId } = await params;

  return CompetitionController.updateLocation(request, id, locationId);
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      locationId: string;
    }>;
  },
) {
  const { id, locationId } = await params;

  return CompetitionController.removeLocation(request, id, locationId);
}
