import { HttpClient } from "@/lib/http/client";

import type { CompetitionUserStateDTO } from "../types/competition-user-state.dto";

/**
 * Bookmark and mark-as-registered mutations, plus the batch read that
 * resolves both for a set of competitions.
 *
 * Every mutation returns `{}` (200), not the new state — the caller
 * already knows the state it asked for, since these endpoints are
 * idempotent PUT/DELETE. Contrast `CompetitionTechnologyApi`, which
 * returns the full list because attach/detach changes a shared collection
 * the client cannot predict; here the caller fully determines the outcome.
 *
 * Relative, same-origin URLs — the session cookie rides along automatically.
 */
export class CompetitionUserStateApi {
  static async list(
    competitionIds: string[],
  ): Promise<CompetitionUserStateDTO[]> {
    const response = await HttpClient.get<{ states: CompetitionUserStateDTO[] }>(
      `/api/v1/me/competition-states?competitionIds=${competitionIds.join(",")}`,
    );

    return response.data.states;
  }

  static async addBookmark(competitionId: string): Promise<void> {
    await HttpClient.put(`/api/v1/me/competitions/${competitionId}/bookmark`);
  }

  static async removeBookmark(competitionId: string): Promise<void> {
    await HttpClient.delete(`/api/v1/me/competitions/${competitionId}/bookmark`);
  }

  static async markRegistered(competitionId: string): Promise<void> {
    await HttpClient.put(
      `/api/v1/me/competitions/${competitionId}/registration`,
    );
  }

  static async unmarkRegistered(competitionId: string): Promise<void> {
    await HttpClient.delete(
      `/api/v1/me/competitions/${competitionId}/registration`,
    );
  }
}
