import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

/**
 * The acting user's own portfolio projects.
 *
 * No portfolio id appears in the path — the portfolio is resolved from the
 * session, mirroring `/api/v1/portfolio/profile`.
 */

export async function GET(request: NextRequest) {
  return PortfolioController.listProjects(request);
}

export async function POST(request: NextRequest) {
  return PortfolioController.addProject(request);
}

/**
 * Reorder lives on the collection: ordering is a property of the list, not of
 * any one relationship. Follows the Project Links convention.
 */
export async function PATCH(request: NextRequest) {
  return PortfolioController.reorderProjects(request);
}
