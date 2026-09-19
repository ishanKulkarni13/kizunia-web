import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id, linkId } = await params;

  return ProjectController.updateLink(request, id, linkId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id, linkId } = await params;

  return ProjectController.removeLink(request, id, linkId);
}
