import { HttpClient } from "@/lib/http/client";

import type { CompetitionLocationDTO } from "../types/competition-location.dto";
import type {
  CreateCompetitionLocationRequestDTO,
  ReorderCompetitionLocationsRequestDTO,
  UpdateCompetitionLocationRequestDTO,
} from "../types/competition-location-request.dto";

/**
 * Locations are a sub-resource with their own endpoints rather than part of the
 * competition PATCH, so every call here returns the competition's full,
 * server-ordered list — the caller never has to re-derive ordering locally.
 */
export class CompetitionLocationApi {
  static async list(competitionId: string): Promise<CompetitionLocationDTO[]> {
    const response = await HttpClient.get<CompetitionLocationDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/locations`,
    );

    return response.data;
  }

  static async add(
    competitionId: string,
    body: CreateCompetitionLocationRequestDTO,
  ): Promise<CompetitionLocationDTO[]> {
    const response = await HttpClient.post<
      CompetitionLocationDTO[],
      CreateCompetitionLocationRequestDTO
    >(`/api/v1/admin/competitions/${competitionId}/locations`, body);

    return response.data;
  }

  static async update(
    competitionId: string,
    competitionLocationId: string,
    body: UpdateCompetitionLocationRequestDTO,
  ): Promise<CompetitionLocationDTO[]> {
    const response = await HttpClient.patch<
      CompetitionLocationDTO[],
      UpdateCompetitionLocationRequestDTO
    >(
      `/api/v1/admin/competitions/${competitionId}/locations/${competitionLocationId}`,
      body,
    );

    return response.data;
  }

  static async remove(
    competitionId: string,
    competitionLocationId: string,
  ): Promise<CompetitionLocationDTO[]> {
    const response = await HttpClient.delete<CompetitionLocationDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/locations/${competitionLocationId}`,
    );

    return response.data;
  }

  static async reorder(
    competitionId: string,
    body: ReorderCompetitionLocationsRequestDTO,
  ): Promise<CompetitionLocationDTO[]> {
    const response = await HttpClient.patch<
      CompetitionLocationDTO[],
      ReorderCompetitionLocationsRequestDTO
    >(`/api/v1/admin/competitions/${competitionId}/locations`, body);

    return response.data;
  }
}
