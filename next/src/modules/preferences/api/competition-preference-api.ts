import { HttpClient } from "@/lib/http/client";

import { UpdateCompetitionPreferencesSchema } from "../schemas/competition-preference";
import type { CompetitionPreferenceEntryDTO } from "../types/competition-preference.dto";

const BASE_URL = "/api/v1/me/competition-preferences";

export class CompetitionPreferenceApi {
  static async list(): Promise<CompetitionPreferenceEntryDTO[]> {
    const response = await HttpClient.get<{
      preferences: CompetitionPreferenceEntryDTO[];
    }>(BASE_URL);

    return response.data.preferences;
  }

  /**
   * Full-replace: sends the complete desired set of preferences. Validated
   * client-side against the same schema the backend enforces, so a malformed
   * entry never reaches the network.
   */
  static async replace(
    preferences: CompetitionPreferenceEntryDTO[],
  ): Promise<CompetitionPreferenceEntryDTO[]> {
    const body = UpdateCompetitionPreferencesSchema.parse({ preferences });

    const response = await HttpClient.put<
      { preferences: CompetitionPreferenceEntryDTO[] },
      typeof body
    >(BASE_URL, body);

    return response.data.preferences;
  }
}
