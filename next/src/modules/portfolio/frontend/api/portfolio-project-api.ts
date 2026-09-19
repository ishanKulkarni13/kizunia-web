import { HttpClient } from "@/lib/http/client";

import type { PortfolioProjectSummaryDto } from "../../dtos";
import type {
  AddPortfolioProjectInput,
  ReorderPortfolioProjectsInput,
  UpdatePortfolioProjectInput,
} from "../../schemas/portfolio-project.schema";

/**
 * Portfolio Projects are a sub-resource with their own endpoints rather than
 * part of the profile PATCH, so every call here returns the portfolio's
 * full, server-ordered list — the caller never has to re-derive ordering
 * locally. Mirrors `ProjectLinkApi`.
 *
 * No method takes a portfolio id: the acting user's own portfolio is always
 * resolved server-side from the session.
 */
export class PortfolioProjectApi {
  static async list(): Promise<PortfolioProjectSummaryDto[]> {
    const response = await HttpClient.get<PortfolioProjectSummaryDto[]>(
      "/api/v1/portfolio/projects",
    );

    return response.data;
  }

  static async add(
    dto: AddPortfolioProjectInput,
  ): Promise<PortfolioProjectSummaryDto[]> {
    const response = await HttpClient.post<
      PortfolioProjectSummaryDto[],
      AddPortfolioProjectInput
    >("/api/v1/portfolio/projects", dto);

    return response.data;
  }

  static async remove(
    projectId: string,
  ): Promise<PortfolioProjectSummaryDto[]> {
    const response = await HttpClient.delete<PortfolioProjectSummaryDto[]>(
      `/api/v1/portfolio/projects/${projectId}`,
    );

    return response.data;
  }

  static async setFeatured(
    projectId: string,
    dto: UpdatePortfolioProjectInput,
  ): Promise<PortfolioProjectSummaryDto[]> {
    const response = await HttpClient.patch<
      PortfolioProjectSummaryDto[],
      UpdatePortfolioProjectInput
    >(`/api/v1/portfolio/projects/${projectId}`, dto);

    return response.data;
  }

  static async reorder(
    dto: ReorderPortfolioProjectsInput,
  ): Promise<PortfolioProjectSummaryDto[]> {
    const response = await HttpClient.patch<
      PortfolioProjectSummaryDto[],
      ReorderPortfolioProjectsInput
    >("/api/v1/portfolio/projects", dto);

    return response.data;
  }
}
