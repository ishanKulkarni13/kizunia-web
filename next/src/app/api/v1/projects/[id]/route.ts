import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export const DELETE = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => ProjectController.delete(request, (await params).id);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.updateProfile(request, id);
}


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.findById(request, id);
}