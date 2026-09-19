import type { AuthorizationActor } from "@/authorization";

import { CompetitionBookmarkRepository } from "./competition-bookmark.repository";
import { CompetitionRegistrationRepository } from "./competition-registration.repository";
import { competitionUserStateMapper } from "./competition-user-state.mapper";
import type { CompetitionUserStateDTO } from "../types/competition-user-state.dto";

export class CompetitionUserStateService {
  /**
   * Business Layer
   *
   * Batch-reads the signed-in actor's own bookmark/registration state for a
   * set of competition ids, in one round trip.
   *
   * A single combined read exists because the two states are displayed
   * together on the same pixels every time a card or the detail page
   * renders — not because they are coupled in the domain. This class never
   * writes either table, and the two repository calls below run
   * independently; nothing here creates a dependency between them.
   *
   * Anonymous and banned actors get an empty answer, not an error: "I am
   * nobody, I have no state" is a successful read, and the controller's
   * `getOptionalActor` path relies on that so an anonymous visitor's
   * request is not logged as a failure.
   *
   * Deliberately does not filter by visibility — the caller already has
   * these ids (they came from a rendered card or detail page), so echoing
   * back whether the actor bookmarked/registered them leaks nothing new.
   */
  static async findForCompetitions(params: {
    competitionIds: string[];
    actor: AuthorizationActor | null;
  }): Promise<CompetitionUserStateDTO[]> {
    const { competitionIds, actor } = params;

    if (!actor?.id || actor.banned) {
      return competitionUserStateMapper.toDTOs(
        competitionIds,
        new Set(),
        new Set(),
      );
    }

    const [bookmarkedIds, registeredIds] = await Promise.all([
      CompetitionBookmarkRepository.findUserBookmarkedIds(
        actor.id,
        competitionIds,
      ),
      CompetitionRegistrationRepository.findUserRegisteredIds(
        actor.id,
        competitionIds,
      ),
    ]);

    return competitionUserStateMapper.toDTOs(
      competitionIds,
      bookmarkedIds,
      registeredIds,
    );
  }
}
