import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

/**
 * A single Portfolio testimonial, addressed by its id.
 *
 * The portfolio half of the scope comes from the session, so a testimonial
 * id belonging to someone else's portfolio simply matches no row.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ testimonialId: string }> },
) {
  const { testimonialId } = await params;

  return PortfolioController.updateTestimonial(request, testimonialId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ testimonialId: string }> },
) {
  const { testimonialId } = await params;

  return PortfolioController.removeTestimonial(request, testimonialId);
}
