import { HttpClient } from "@/lib/http/client";

import type {
  CompetitionSuggestionAdminDetailDTO,
  CompetitionSuggestionDTO,
} from "../types/suggestion";

/**
 * Admin-only Competition Suggestion review actions. Kept separate from
 * `CompetitionSuggestionApi` (the contributor client) — that one is bundled
 * into contributor-facing pages, and admin methods there would be dead
 * weight there and easy to call from the wrong surface.
 */
export class CompetitionSuggestionAdminApi {
  static async findById(
    id: string,
  ): Promise<CompetitionSuggestionAdminDetailDTO> {
    const response = await HttpClient.get<CompetitionSuggestionAdminDetailDTO>(
      `/api/v1/admin/competition-suggestions/${id}`,
    );

    return response.data;
  }

  static async approve(id: string): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<CompetitionSuggestionDTO>(
      `/api/v1/admin/competition-suggestions/${id}/approve`,
    );

    return response.data;
  }

  static async reject(
    id: string,
    reason?: string,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<
      CompetitionSuggestionDTO,
      { reason?: string }
    >(`/api/v1/admin/competition-suggestions/${id}/reject`, { reason });

    return response.data;
  }

  static async requestChanges(
    id: string,
    reason?: string,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.post<
      CompetitionSuggestionDTO,
      { reason?: string }
    >(`/api/v1/admin/competition-suggestions/${id}/request-changes`, {
      reason,
    });

    return response.data;
  }

  static async detachAsset(
    suggestionId: string,
    assetId: string,
  ): Promise<CompetitionSuggestionDTO> {
    const response = await HttpClient.delete<CompetitionSuggestionDTO>(
      `/api/v1/admin/competition-suggestions/${suggestionId}/assets/${assetId}`,
    );

    return response.data;
  }
}
