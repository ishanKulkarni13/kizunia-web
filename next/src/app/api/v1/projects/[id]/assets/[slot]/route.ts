import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slot: string }> },
) {
  const { id, slot } = await params;

  // Slot is validated inside ProjectController.setAsset.
  return ProjectController.setAsset(request, id, slot);
}
