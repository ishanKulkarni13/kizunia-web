import { NextRequest } from "next/server";

import { CompetitionController } from "@/modules/competitions/backend/controller";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params;

  return CompetitionController.findForEdit(
    request,
    id,
  );

  
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params;

  return CompetitionController.update(
    request,
    id,
  );
}




export async function DELETE(
  request: NextRequest,
 { params }: RouteParams,
) {
  const { id } = await params;

  return CompetitionController.delete(
    request,
    id,
  );
}