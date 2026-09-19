import { HttpClient } from "@/lib/http/client";

import type { PortfolioTestimonialSummaryDto } from "../../dtos";
import type {
  AddPortfolioTestimonialInput,
  ReorderPortfolioTestimonialsInput,
  UpdatePortfolioTestimonialInput,
} from "../../schemas/portfolio-testimonial.schema";

/**
 * Portfolio Testimonials are a sub-resource with their own endpoints, so
 * every call here returns the portfolio's full, server-ordered list —
 * mirrors `PortfolioProjectApi`.
 *
 * No method takes a portfolio id: the acting user's own portfolio is always
 * resolved server-side from the session.
 */
export class PortfolioTestimonialApi {
  static async list(): Promise<PortfolioTestimonialSummaryDto[]> {
    const response = await HttpClient.get<PortfolioTestimonialSummaryDto[]>(
      "/api/v1/portfolio/testimonials",
    );

    return response.data;
  }

  static async add(
    dto: AddPortfolioTestimonialInput,
  ): Promise<PortfolioTestimonialSummaryDto[]> {
    const response = await HttpClient.post<
      PortfolioTestimonialSummaryDto[],
      AddPortfolioTestimonialInput
    >("/api/v1/portfolio/testimonials", dto);

    return response.data;
  }

  static async update(
    testimonialId: string,
    dto: UpdatePortfolioTestimonialInput,
  ): Promise<PortfolioTestimonialSummaryDto[]> {
    const response = await HttpClient.patch<
      PortfolioTestimonialSummaryDto[],
      UpdatePortfolioTestimonialInput
    >(`/api/v1/portfolio/testimonials/${testimonialId}`, dto);

    return response.data;
  }

  static async remove(
    testimonialId: string,
  ): Promise<PortfolioTestimonialSummaryDto[]> {
    const response = await HttpClient.delete<PortfolioTestimonialSummaryDto[]>(
      `/api/v1/portfolio/testimonials/${testimonialId}`,
    );

    return response.data;
  }

  static async reorder(
    dto: ReorderPortfolioTestimonialsInput,
  ): Promise<PortfolioTestimonialSummaryDto[]> {
    const response = await HttpClient.patch<
      PortfolioTestimonialSummaryDto[],
      ReorderPortfolioTestimonialsInput
    >("/api/v1/portfolio/testimonials", dto);

    return response.data;
  }
}
