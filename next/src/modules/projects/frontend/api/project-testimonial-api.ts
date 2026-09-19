import { HttpClient } from "@/lib/http/client";

import type { ProjectTestimonialDto } from "../../backend/dto/output";
import type {
  CreateProjectTestimonialInput,
  ReorderProjectTestimonialsInput,
  UpdateProjectTestimonialInput,
} from "../../schemas/project-testimonial.schema";

/**
 * Testimonials are a sub-resource with their own endpoints, so every call
 * here returns the project's full, server-ordered list — the caller never
 * has to re-derive ordering locally.
 */
export class ProjectTestimonialApi {
  static async list(projectId: string): Promise<ProjectTestimonialDto[]> {
    const response = await HttpClient.get<ProjectTestimonialDto[]>(
      `/api/v1/projects/${projectId}/testimonials`,
    );

    return response.data;
  }

  static async create(
    projectId: string,
    dto: CreateProjectTestimonialInput,
  ): Promise<ProjectTestimonialDto[]> {
    const response = await HttpClient.post<
      ProjectTestimonialDto[],
      CreateProjectTestimonialInput
    >(`/api/v1/projects/${projectId}/testimonials`, dto);

    return response.data;
  }

  static async update(
    projectId: string,
    testimonialId: string,
    dto: UpdateProjectTestimonialInput,
  ): Promise<ProjectTestimonialDto[]> {
    const response = await HttpClient.patch<
      ProjectTestimonialDto[],
      UpdateProjectTestimonialInput
    >(`/api/v1/projects/${projectId}/testimonials/${testimonialId}`, dto);

    return response.data;
  }

  static async delete(
    projectId: string,
    testimonialId: string,
  ): Promise<ProjectTestimonialDto[]> {
    const response = await HttpClient.delete<ProjectTestimonialDto[]>(
      `/api/v1/projects/${projectId}/testimonials/${testimonialId}`,
    );

    return response.data;
  }

  static async reorder(
    projectId: string,
    dto: ReorderProjectTestimonialsInput,
  ): Promise<ProjectTestimonialDto[]> {
    const response = await HttpClient.patch<
      ProjectTestimonialDto[],
      ReorderProjectTestimonialsInput
    >(`/api/v1/projects/${projectId}/testimonials`, dto);

    return response.data;
  }
}
