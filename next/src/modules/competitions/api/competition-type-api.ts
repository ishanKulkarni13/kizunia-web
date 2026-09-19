import { HttpClient } from "@/lib/http/client";
import type { CompetitionType } from "@/generated/prisma";

import type { CompetitionTypeDTO } from "../types/competition-type.dto";

/**
 * Types are a sub-resource with their own endpoints rather than part of the
 * competition PATCH, so every call here returns the competition's full type
 * list -- the caller never has to patch it in locally.
 */
export class CompetitionTypeApi {
  static async list(competitionId: string): Promise<CompetitionTypeDTO[]> {
    const response = await HttpClient.get<CompetitionTypeDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/types`,
    );

    return response.data;
  }

  static async attach(
    competitionId: string,
    type: CompetitionType,
  ): Promise<CompetitionTypeDTO[]> {
    const response = await HttpClient.post<
      CompetitionTypeDTO[],
      { type: CompetitionType }
    >(`/api/v1/admin/competitions/${competitionId}/types`, {
      type,
    });

    return response.data;
  }

  static async detach(
    competitionId: string,
    type: CompetitionType,
  ): Promise<CompetitionTypeDTO[]> {
    const response = await HttpClient.delete<CompetitionTypeDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/types/${type}`,
    );

    return response.data;
  }
}
