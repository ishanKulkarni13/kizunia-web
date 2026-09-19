import { HttpClient } from "@/lib/http/client";

import type { PortfolioTechnologySummaryDto } from "../../dtos";
import type {
  AddPortfolioTechnologyInput,
  ReorderPortfolioTechnologiesInput,
  UpdatePortfolioTechnologyInput,
} from "../../schemas/portfolio-technology.schema";

/**
 * Portfolio Technologies are a sub-resource with their own endpoints rather
 * than part of the profile PATCH, so every call here returns the
 * portfolio's full, server-ordered list — the caller never has to
 * re-derive ordering locally. Mirrors `PortfolioProjectApi`.
 *
 * No method takes a portfolio id: the acting user's own portfolio is always
 * resolved server-side from the session.
 */
export class PortfolioTechnologyApi {
  static async list(): Promise<PortfolioTechnologySummaryDto[]> {
    const response = await HttpClient.get<PortfolioTechnologySummaryDto[]>(
      "/api/v1/portfolio/technologies",
    );

    return response.data;
  }

  static async add(
    dto: AddPortfolioTechnologyInput,
  ): Promise<PortfolioTechnologySummaryDto[]> {
    const response = await HttpClient.post<
      PortfolioTechnologySummaryDto[],
      AddPortfolioTechnologyInput
    >("/api/v1/portfolio/technologies", dto);

    return response.data;
  }

  static async update(
    technologyId: string,
    dto: UpdatePortfolioTechnologyInput,
  ): Promise<PortfolioTechnologySummaryDto[]> {
    const response = await HttpClient.patch<
      PortfolioTechnologySummaryDto[],
      UpdatePortfolioTechnologyInput
    >(`/api/v1/portfolio/technologies/${technologyId}`, dto);

    return response.data;
  }

  static async remove(
    technologyId: string,
  ): Promise<PortfolioTechnologySummaryDto[]> {
    const response = await HttpClient.delete<PortfolioTechnologySummaryDto[]>(
      `/api/v1/portfolio/technologies/${technologyId}`,
    );

    return response.data;
  }

  static async reorder(
    dto: ReorderPortfolioTechnologiesInput,
  ): Promise<PortfolioTechnologySummaryDto[]> {
    const response = await HttpClient.patch<
      PortfolioTechnologySummaryDto[],
      ReorderPortfolioTechnologiesInput
    >("/api/v1/portfolio/technologies", dto);

    return response.data;
  }
}
