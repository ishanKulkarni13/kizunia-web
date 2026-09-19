import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

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
    {
        params,
    }: {
        params: Promise<{
            id: string;
        }>;
    },
) {
    const { id } = await params;

    return CompetitionController.update(
        request,
        id,
    );
}