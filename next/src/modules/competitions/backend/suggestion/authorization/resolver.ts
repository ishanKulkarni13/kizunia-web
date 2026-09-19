import type { AuthorizationActor } from "@/authorization";
import { ValidationError } from "@/lib/errors";

import type { CompetitionSuggestionContext } from "./context";
import { CompetitionSuggestionRepository } from "../repository";

export class CompetitionSuggestionContextResolver {
  static async resolve(params: {
    actor: AuthorizationActor;
    suggestionId: string;
  }): Promise<CompetitionSuggestionContext> {
    const { actor, suggestionId } = params;

    if (!actor.id) {
      throw new ValidationError({
        code: "ACTOR_ID_REQUIRED",
        status: 400,
        message:
          "Actor ID is required to resolve competition suggestion context",
      });
    }

    const suggestion =
      await CompetitionSuggestionRepository.findByIdOrThrow(
        suggestionId,
      );

    return {
      actor,
      suggestion,
    };
  }

  static fromData(params: {
    actor: AuthorizationActor;
    suggestion: CompetitionSuggestionContext["suggestion"];
  }): CompetitionSuggestionContext {
    return {
      actor: params.actor,
      suggestion: params.suggestion,
    };
  }
}