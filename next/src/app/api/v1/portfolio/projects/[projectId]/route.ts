import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

/**
 * A single Portfolio ↔ Project relationship, addressed by the project id.
 *
 * The other half of the composite key comes from the session, so a project id
 * belonging to someone else's portfolio simply matches no row.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  return PortfolioController.updateProject(request, projectId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  return PortfolioController.removeProject(request, projectId);
}
