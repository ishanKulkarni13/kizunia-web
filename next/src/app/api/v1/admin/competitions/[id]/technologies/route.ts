import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function GET(
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

  return CompetitionController.listTechnologies(request, id);
}

export async function POST(
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

  return CompetitionController.attachTechnology(request, id);
}
