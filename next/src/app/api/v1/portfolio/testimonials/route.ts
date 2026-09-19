import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

/**
 * The acting user's own portfolio testimonials.
 *
 * No portfolio id appears in the path — the portfolio is resolved from the
 * session, mirroring `/api/v1/portfolio/projects`.
 */

export async function GET(request: NextRequest) {
  return PortfolioController.listTestimonials(request);
}

export async function POST(request: NextRequest) {
  return PortfolioController.addTestimonial(request);
}

/**
 * Reorder lives on the collection: ordering is a property of the list, not
 * of any one testimonial.
 */
export async function PATCH(request: NextRequest) {
  return PortfolioController.reorderTestimonials(request);
}
