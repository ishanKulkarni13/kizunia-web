import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

/**
 * A single Portfolio ↔ Technology relationship, addressed by the technology
 * id.
 *
 * The other half of the composite key comes from the session, so a
 * technology id belonging to someone else's portfolio simply matches no
 * row.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ technologyId: string }> },
) {
  const { technologyId } = await params;

  return PortfolioController.updateTechnology(request, technologyId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ technologyId: string }> },
) {
  const { technologyId } = await params;

  return PortfolioController.removeTechnology(request, technologyId);
}
