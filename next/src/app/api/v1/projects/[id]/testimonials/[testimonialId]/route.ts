import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; testimonialId: string }> },
) {
  const { id, testimonialId } = await params;

  return ProjectController.updateTestimonial(request, id, testimonialId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; testimonialId: string }> },
) {
  const { id, testimonialId } = await params;

  return ProjectController.removeTestimonial(request, id, testimonialId);
}
