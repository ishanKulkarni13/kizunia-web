import { HttpClient } from "@/lib/http/client";

import type { CompetitionTechnologyDTO } from "../types/competition-technology.dto";

/**
 * Technologies are a sub-resource with their own endpoints rather than part
 * of the competition PATCH, so every call here returns the competition's
 * full technology list — the caller never has to patch it in locally.
 */
export class CompetitionTechnologyApi {
  static async list(
    competitionId: string,
  ): Promise<CompetitionTechnologyDTO[]> {
    const response = await HttpClient.get<CompetitionTechnologyDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/technologies`,
    );

    return response.data;
  }

  static async attach(
    competitionId: string,
    technologyId: string,
  ): Promise<CompetitionTechnologyDTO[]> {
    const response = await HttpClient.post<
      CompetitionTechnologyDTO[],
      { technologyId: string }
    >(`/api/v1/admin/competitions/${competitionId}/technologies`, {
      technologyId,
    });

    return response.data;
  }

  static async detach(
    competitionId: string,
    technologyId: string,
  ): Promise<CompetitionTechnologyDTO[]> {
    const response = await HttpClient.delete<CompetitionTechnologyDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/technologies/${technologyId}`,
    );

    return response.data;
  }
}
