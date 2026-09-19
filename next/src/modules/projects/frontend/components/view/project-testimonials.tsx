import { TestimonialCardGrid } from "@/components/testimonials/testimonial-card";
import type { ProjectPublicDetailsDto } from "@/modules/projects/backend/dto/output";

interface ProjectTestimonialsProps {
  testimonials: ProjectPublicDetailsDto["testimonials"];
}

/**
 * Renders in the order the backend already returns (`displayOrder asc` at
 * the query level, see `projectDetailsInclude.testimonials` in
 * repository.ts) — no client-side re-sort.
 */
export function ProjectTestimonials({ testimonials }: ProjectTestimonialsProps) {
  return <TestimonialCardGrid testimonials={testimonials} />;
}
