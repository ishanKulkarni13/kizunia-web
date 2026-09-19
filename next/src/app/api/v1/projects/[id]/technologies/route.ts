import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.listTechnologies(request, id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.attachTechnology(request, id);
}

/**
 * Reorders the project's technologies.
 *
 * Lives on the collection rather than an individual technology because
 * ordering is a property of the list — a single technology cannot
 * meaningfully change its own position without moving the others.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.reorderTechnologies(request, id);
}
