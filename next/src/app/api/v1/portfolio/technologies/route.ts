import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

/**
 * The acting user's own portfolio technologies.
 *
 * No portfolio id appears in the path — the portfolio is resolved from the
 * session, mirroring `/api/v1/portfolio/projects` and
 * `/api/v1/portfolio/testimonials`.
 */

export async function GET(request: NextRequest) {
  return PortfolioController.listTechnologies(request);
}

export async function POST(request: NextRequest) {
  return PortfolioController.addTechnology(request);
}

/**
 * Reorder lives on the collection: ordering is a property of the list, not
 * of any one relationship.
 */
export async function PATCH(request: NextRequest) {
  return PortfolioController.reorderTechnologies(request);
}
