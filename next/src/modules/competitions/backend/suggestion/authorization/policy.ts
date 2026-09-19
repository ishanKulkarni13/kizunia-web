import {
  AuthorizationCode,
  AuthorizationDecision,
  AuthorizationEvaluator,
} from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformPermissionSet } from "@/authorization/platform/permission-set";
import type { PlatformRole } from "@/authorization/platform/roles";

import { CompetitionSuggestionAction } from "./actions";
import type { CompetitionSuggestionContext } from "./context";

export class CompetitionSuggestionPolicy {
  static can(
    context: CompetitionSuggestionContext,
    action: CompetitionSuggestionAction,
  ): AuthorizationDecision {
    switch (action) {
      case CompetitionSuggestionAction.VIEW:
        return this.canView(context);

      case CompetitionSuggestionAction.UPDATE:
        return this.canUpdate(context);

      case CompetitionSuggestionAction.SUBMIT:
        return this.canSubmit(context);

      case CompetitionSuggestionAction.DELETE:
        return this.canDelete(context);

      case CompetitionSuggestionAction.VIEW_ANY:
        return this.canViewAny(context);

      case CompetitionSuggestionAction.REVIEW:
        return this.canReview(context);

      case CompetitionSuggestionAction.MODERATE_ASSETS:
        return this.canModerateAssets(context);

      case CompetitionSuggestionAction.REOPEN:
        return this.canReopen(context);

      default:
        return this.canManage(context);
    }
  }

  // ===========================================================================
  // View
  // ===========================================================================

  private static canView(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .platformOverride()

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .require(
        (ctx) =>
          ctx.actor.id === ctx.suggestion.submittedById,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You can only access your own competition suggestions.",
      )

      .require(
        (ctx) => !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .grant()

      .evaluate();
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  private static canUpdate(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .platformOverride()

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .require(
        (ctx) =>
          ctx.actor.id === ctx.suggestion.submittedById,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You can only edit your own competition suggestions.",
      )

      .require(
        (ctx) =>
          !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      // A suggestion is editable only while still a DRAFT. Once submitted
      // (UNDER_REVIEW) it is read-only for the contributor — this also
      // gates asset attach/detach, which reuses this same UPDATE action.
      .require(
        (ctx) => ctx.suggestion.status === "DRAFT",
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "This competition suggestion cannot be edited.",
      )

      .grant()

      .evaluate();
  }

  // ===========================================================================
  // Submit
  // ===========================================================================

  private static canSubmit(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .platformOverride()

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .require(
        (ctx) =>
          ctx.actor.id === ctx.suggestion.submittedById,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You can only submit your own competition suggestions.",
      )

      .require(
        (ctx) =>
          !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .require(
        (ctx) =>
          ctx.suggestion.status === "DRAFT",
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "Only draft competition suggestions can be submitted.",
      )

      .grant()

      .evaluate();
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  private static canDelete(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .platformOverride()

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .require(
        (ctx) =>
          ctx.actor.id === ctx.suggestion.submittedById,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You can only delete your own competition suggestions.",
      )

      .require(
        (ctx) =>
          !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .require(
        (ctx) =>
          ctx.suggestion.status === "DRAFT",
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "Only draft competition suggestions can be deleted.",
      )

      .grant()

      .evaluate();
  }

  // ===========================================================================
  // Admin: View Any
  // ===========================================================================
  //
  // Deliberately does NOT call `.platformOverride()`. That evaluator step is
  // a blanket "is this actor ADMIN/SUPER_ADMIN" bypass keyed off role
  // identity, not the granular `VIEW_COMPETITION_SUGGESTIONS` permission —
  // using it here would let any admin bypass this check regardless of
  // whether the permission set actually grants them suggestion visibility,
  // and would never let a MODERATOR gain this ability by permission alone.
  // Every admin/review branch below follows the same rule.

  private static canViewAny(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start<CompetitionSuggestionContext, PlatformAction, PlatformRole>(
        context,
      )

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .permission(
        PlatformPermissionSet,
        context.actor.role as PlatformRole,
        PlatformAction.VIEW_COMPETITION_SUGGESTIONS,
      )

      .require(
        (ctx) => !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .evaluate();
  }

  // ===========================================================================
  // Admin: Review (approve / reject / request changes)
  // ===========================================================================

  private static canReview(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start<CompetitionSuggestionContext, PlatformAction, PlatformRole>(
        context,
      )

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .permission(
        PlatformPermissionSet,
        context.actor.role as PlatformRole,
        PlatformAction.REVIEW_COMPETITION_SUGGESTIONS,
      )

      .require(
        (ctx) => !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .require(
        (ctx) => ctx.suggestion.status === "UNDER_REVIEW",
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "Only a suggestion that is under review can be decided on.",
      )

      .evaluate();
  }

  // ===========================================================================
  // Admin: Moderate Assets
  // ===========================================================================
  //
  // Same permission as REVIEW, but deliberately without the UNDER_REVIEW
  // requirement — admins may remove an unwanted attached file at any time,
  // including after the suggestion has already been approved or rejected.

  private static canModerateAssets(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start<CompetitionSuggestionContext, PlatformAction, PlatformRole>(
        context,
      )

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .permission(
        PlatformPermissionSet,
        context.actor.role as PlatformRole,
        PlatformAction.REVIEW_COMPETITION_SUGGESTIONS,
      )

      .require(
        (ctx) => !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .evaluate();
  }

  // ===========================================================================
  // Contributor: Reopen (CHANGES_REQUESTED -> DRAFT)
  // ===========================================================================

  private static canReopen(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .platformOverride()

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .require(
        (ctx) =>
          ctx.actor.id === ctx.suggestion.submittedById,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You can only reopen your own competition suggestions.",
      )

      .require(
        (ctx) => !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .require(
        (ctx) => ctx.suggestion.status === "CHANGES_REQUESTED",
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "Only a suggestion with requested changes can be reopened for editing.",
      )

      .grant()

      .evaluate();
  }

  // ===========================================================================
  // Management
  // ===========================================================================

  private static canManage(
    context: CompetitionSuggestionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .platformOverride()

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .require(
        (ctx) =>
          ctx.actor.id === ctx.suggestion.submittedById,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You can only manage your own competition suggestions.",
      )

      .require(
        (ctx) => !ctx.suggestion.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition suggestion has been deleted.",
      )

      .grant()

      .evaluate();
  }
}