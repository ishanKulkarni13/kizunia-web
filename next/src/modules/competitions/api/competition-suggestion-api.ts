import { HttpClient } from "@/lib/http/client";

import type { CreateCompetitionSuggestionInput } from "../schemas/create-competition-suggestion";
import type { UpdateCompetitionSuggestionInput } from "../schemas/update-competition-suggestion";
import type { CompetitionSuggestionDTO } from "../types/suggestion";

export class CompetitionSuggestionApi {
  // ===========================================================================
  // Create
  // ===========================================================================

  static async create(
    data: CreateCompetitionSuggestionInput,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<
      CompetitionSuggestionDTO,
      CreateCompetitionSuggestionInput
    >("/api/v1/competition-suggestions", data);

    return response.data;
  }

  // ===========================================================================
  // Read
  // ===========================================================================

  static async findById(id: string): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.get<CompetitionSuggestionDTO>(
      `/api/v1/competition-suggestions/${id}`,
    );

    return response.data;
  }

  static async findMine(): Promise<CompetitionSuggestionDTO[]> {
    const response = await HttpClient.get<CompetitionSuggestionDTO[]>(
      "/api/v1/competition-suggestions/mine",
    );

    return response.data;
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  static async update(
    id: string,
    data: UpdateCompetitionSuggestionInput,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.patch<
      CompetitionSuggestionDTO,
      UpdateCompetitionSuggestionInput
    >(`/api/v1/competition-suggestions/${id}`, data);

    return response.data;
  }

  // ===========================================================================
  // Submit
  // ===========================================================================

  static async submit(id: string): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<CompetitionSuggestionDTO>(
      `/api/v1/competition-suggestions/${id}/submit`,
    );

    return response.data;
  }

  // ===========================================================================
  // Reopen
  // ===========================================================================

  static async reopen(id: string): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<CompetitionSuggestionDTO>(
      `/api/v1/competition-suggestions/${id}/reopen`,
    );

    return response.data;
  }

  // ===========================================================================
  // Assets
  // ===========================================================================

  static async attachAsset(
    id: string,
    assetId: string,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<
      CompetitionSuggestionDTO,
      { assetId: string }
    >(`/api/v1/competition-suggestions/${id}/assets`, { assetId });

    return response.data;
  }

  static async detachAsset(
    id: string,
    assetId: string,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.delete<CompetitionSuggestionDTO>(
      `/api/v1/competition-suggestions/${id}/assets/${assetId}`,
    );

    return response.data;
  }
}
