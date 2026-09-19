import { NextRequest } from "next/server";

import { ProjectController } from "@/modules/projects/backend/controller";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.updateContent(request, id);
}