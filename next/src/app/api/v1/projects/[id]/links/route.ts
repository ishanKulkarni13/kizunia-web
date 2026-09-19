import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.listLinks(request, id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.addLink(request, id);
}

/**
 * Reorders the project's links.
 *
 * Lives on the collection rather than an individual link because ordering is
 * a property of the list — a single link cannot meaningfully change its own
 * position without moving the others.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return ProjectController.reorderLinks(request, id);
}
