import { NextRequest } from "next/server";

import { CompetitionController } from "@/modules/competitions/backend/controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return CompetitionController.setRegistration(request, id);
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return CompetitionController.removeRegistration(request, id);
}
