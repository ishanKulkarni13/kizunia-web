import { TestimonialCardGrid } from "@/components/testimonials/testimonial-card";
import type { PortfolioPublicDto } from "@/modules/portfolio/dtos";

interface PortfolioTestimonialsProps {
  testimonials: PortfolioPublicDto["testimonials"];
}

/**
 * Public-presentation component for a Portfolio's testimonials, mirroring
 * `ProjectTestimonials`. Not yet wired into any page — no public Portfolio
 * page exists in the frontend today (only the public API/DTO). Renders in
 * the order the backend already returns (`displayOrder asc`, see
 * `portfolioPublicDetailsInclude.testimonials` in repository.ts) — no
 * client-side re-sort.
 */
export function PortfolioTestimonials({
  testimonials,
}: PortfolioTestimonialsProps) {
  return <TestimonialCardGrid testimonials={testimonials} />;
}
