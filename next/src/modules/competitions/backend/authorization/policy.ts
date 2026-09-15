import {
  AuthorizationCode,
  AuthorizationDecision,
  AuthorizationEvaluator,
} from "@/authorization";

import { CompetitionAction } from "./actions";
import type { CompetitionContext } from "./context";
import { CompetitionPermissionSet } from "./permission-set";
import { CompetitionVisibility } from "@/generated/prisma";

export class CompetitionPolicy {
  static can(
    context: CompetitionContext,
    action: CompetitionAction,
  ): AuthorizationDecision {
    switch (action) {
      case CompetitionAction.VIEW:
        return this.canView(context);

      default:
        return this.canManage(context, action);
    }
  }

  /**
   * ===========================================================================
   * View
   * ===========================================================================
   *
   * PUBLIC competitions are discoverable and viewable. UNLISTED competitions
   * are not discoverable, but remain directly viewable when their slug is
   * known. PRIVATE and ARCHIVED competitions require membership.
   */
  private static canView(
    context: CompetitionContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator.start(context)

      // Banned users cannot access anything
      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      // Deleted competitions are not visible
      .require(
        (ctx) => !ctx.competition.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition has been deleted.",
      )

      // Platform admins can access any non-deleted competition
      .platformOverride()

      // Members can view any visibility; non-members can directly view only
      // PUBLIC and UNLISTED competitions. Search discovery remains PUBLIC-only.
      .require(
        (ctx) =>
          ctx.membership !== null ||
          ctx.competition.visibility === CompetitionVisibility.PUBLIC ||
          ctx.competition.visibility === CompetitionVisibility.UNLISTED,
        AuthorizationCode.RESOURCE_PRIVATE,
        "Competition is private or archived.",
      )

      // Explicitly allow
      .grant()

      .evaluate();
  }

  /**
   * ===========================================================================
   * Management
   * ===========================================================================
   */
  private static canManage(
    context: CompetitionContext,
    action: CompetitionAction,
  ): AuthorizationDecision {
    return AuthorizationEvaluator.start(context)

      // Platform admins bypass everything
      // Banned users cannot access anything
      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )
      .platformOverride()

      // Deleted competitions cannot be managed
      .require(
        (ctx) => !ctx.competition.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Competition has been deleted.",
      )

      // Must be a member
      .require(
        (ctx) => ctx.membership !== null,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You are not a maintainer.",
      )

      // Must have permission
      .permission(
        CompetitionPermissionSet,
        context.membership?.role ?? null,
        action,
      )

      .evaluate();
  }
}