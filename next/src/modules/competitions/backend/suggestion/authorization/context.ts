import type { AuthorizationActor } from "@/authorization";

import type { CompetitionSuggestionRepository } from "../repository";

export interface CompetitionSuggestionContext {
  actor: AuthorizationActor;

  suggestion: NonNullable<
    Awaited<
      ReturnType<typeof CompetitionSuggestionRepository.findById>
    >
  >;
}