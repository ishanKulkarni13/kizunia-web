import type { CompetitionUserStateDTO } from "../types/competition-user-state.dto";

export const competitionUserStateMapper = {
  /**
   * One DTO per requested id, including ids the actor has neither
   * bookmarked nor registered for — the caller gets a complete answer and
   * never has to distinguish "absent from the response" from "false".
   */
  toDTOs(
    competitionIds: string[],
    bookmarkedIds: Set<string>,
    registeredIds: Set<string>,
  ): CompetitionUserStateDTO[] {
    return competitionIds.map((competitionId) => ({
      competitionId,
      bookmarked: bookmarkedIds.has(competitionId),
      registered: registeredIds.has(competitionId),
    }));
  },
};
