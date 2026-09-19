import { Authorization } from "@/authorization";

import { CompetitionSuggestionAction } from "./actions";
import type { CompetitionSuggestionContext } from "./context";
import { CompetitionSuggestionPolicy } from "./policy";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

export class CompetitionSuggestionAuthorizer {
  static create(context: PlatformContext): void {
    Authorization.assert(
      PlatformPolicy.can(context, PlatformAction.CREATE_COMPETITION_SUGGESTION),
    );
  }

  static read(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.VIEW,
      ),
    );
  }

  static edit(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.UPDATE,
      ),
    );
  }

  static submit(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.SUBMIT,
      ),
    );
  }

  static delete(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.DELETE,
      ),
    );
  }

  static readAny(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.VIEW_ANY,
      ),
    );
  }

  static review(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.REVIEW,
      ),
    );
  }

  static moderateAssets(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.MODERATE_ASSETS,
      ),
    );
  }

  static reopen(context: CompetitionSuggestionContext): void {
    Authorization.assert(
      CompetitionSuggestionPolicy.can(
        context,
        CompetitionSuggestionAction.REOPEN,
      ),
    );
  }

  static can(
    context: CompetitionSuggestionContext,
    action: CompetitionSuggestionAction,
  ): void {
    Authorization.assert(CompetitionSuggestionPolicy.can(context, action));
  }
}
