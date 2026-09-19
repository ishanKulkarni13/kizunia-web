import { NextRequest } from "next/server";

import { CompetitionController } from "@/modules/competitions/backend/controller";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  return CompetitionController.restore(request, id);
}
