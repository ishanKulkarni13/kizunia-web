import { HttpClient } from "@/lib/http/client";
import type { GenerateRecommendationsInput } from "../schemas/generate-recommendations";
import type { RecommendationResultDTO } from "../types/recommendation.dto";

export class RecommendationApi {
  /**
   * Generates recommendations for the current signed-in user. There is no
   * way to pass a different user's id — the endpoint always uses the
   * caller's own session.
   */
  static async generateForCurrentUser(
    input: GenerateRecommendationsInput = {},
  ): Promise<RecommendationResultDTO> {
    const response = await HttpClient.post<
      RecommendationResultDTO,
      GenerateRecommendationsInput
    >("/api/v1/me/recommendations/competitions", input);

    return response.data;
  }
}
