import { HttpClient } from "@/lib/http/client";
import type { EligibilityType } from "@/generated/prisma";

import type { CompetitionEligibilityDTO } from "../types/competition-eligibility.dto";

/**
 * Eligibilities are a sub-resource with their own endpoints rather than
 * part of the competition PATCH, so every call here returns the
 * competition's full eligibility list — the caller never has to patch it
 * in locally.
 */
export class CompetitionEligibilityApi {
  static async list(
    competitionId: string,
  ): Promise<CompetitionEligibilityDTO[]> {
    const response = await HttpClient.get<CompetitionEligibilityDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/eligibilities`,
    );

    return response.data;
  }

  static async attach(
    competitionId: string,
    type: EligibilityType,
  ): Promise<CompetitionEligibilityDTO[]> {
    const response = await HttpClient.post<
      CompetitionEligibilityDTO[],
      { type: EligibilityType }
    >(`/api/v1/admin/competitions/${competitionId}/eligibilities`, {
      type,
    });

    return response.data;
  }

  static async detach(
    competitionId: string,
    type: EligibilityType,
  ): Promise<CompetitionEligibilityDTO[]> {
    const response = await HttpClient.delete<CompetitionEligibilityDTO[]>(
      `/api/v1/admin/competitions/${competitionId}/eligibilities/${type}`,
    );

    return response.data;
  }
}
