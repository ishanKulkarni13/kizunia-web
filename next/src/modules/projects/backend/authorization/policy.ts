import {
  AuthorizationCode,
  AuthorizationDecision,
  AuthorizationEvaluator,
} from "@/authorization";

import { ProjectStatus, ProjectVisibility } from "@/generated/prisma";

import { ProjectAction } from "./actions";
import type { ProjectContext, ProjectOwnershipQuotaContext } from "./context";
import { ProjectPermissionSet } from "./permission-set";

export class ProjectPolicy {
  static can(
    context: ProjectContext,
    action: ProjectAction,
  ): AuthorizationDecision {
    switch (action) {
      case ProjectAction.VIEW:
        return this.canView(context);

      default:
        return this.canManage(context, action);
    }
  }

  // ===========================================================================
  // Public View
  // ===========================================================================

  private static canView(
    context: ProjectContext,
  ): AuthorizationDecision {
    // Members can always view the project.
    if (context.membership) {
      return AuthorizationEvaluator
        .start(context)

        .security(
          (ctx) => !ctx.actor.banned,
          AuthorizationCode.ACCOUNT_BANNED,
          "Your account has been banned.",
        )

        .platformOverride()

        .require(
          (ctx) => !ctx.project.deletedAt,
          AuthorizationCode.RESOURCE_DELETED,
          "Project has been deleted.",
        )

        .grant()

        .evaluate();
    }

    // Non-members may only view published, non-private projects.
    // PUBLIC and UNLISTED are both directly viewable when published —
    // UNLISTED merely stays out of the public discovery listing (see
    // the search scope guard), it is not an additional view restriction.
    // DRAFT projects are always member-only, regardless of visibility.
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => !ctx.project.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Project has been deleted.",
      )

      .require(
        (ctx) =>
          ctx.project.visibility !==
          ProjectVisibility.PRIVATE,
        AuthorizationCode.RESOURCE_PRIVATE,
        "Project is private.",
      )

      .require(
        (ctx) => ctx.project.status === ProjectStatus.PUBLISHED,
        AuthorizationCode.RESOURCE_PRIVATE,
        "Project is not published.",
      )

      .grant()

      .evaluate();
  }

  // ===========================================================================
  // Management
  // ===========================================================================

  private static canManage(
    context: ProjectContext,
    action: ProjectAction,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => !ctx.project.deletedAt,
        AuthorizationCode.RESOURCE_DELETED,
        "Project has been deleted.",
      )

      .require(
        (ctx) => ctx.membership !== null,
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You are not a project member.",
      )

      .permission(
        ProjectPermissionSet,
        context.membership?.role ?? null,
        action,
      )

      .evaluate();
  }

  // ===========================================================================
  // Owned-project quota
  // ===========================================================================

  /**
   * May the actor create one more project that they will own?
   *
   * Runs after `PlatformAuthorizer.can(CREATE_PROJECT)`, which stays in
   * `BASELINE` and already refuses banned accounts. Admins bypass the quota
   * (IB-7); everyone else needs `owned < limit`. A user above their quota
   * after a downgrade keeps every project and only loses creation until they
   * are back under it (SB-DP-01).
   */
  static canCreateOwned(
    context: ProjectOwnershipQuotaContext,
  ): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => ctx.owned < ctx.limit,
        AuthorizationCode.UPGRADE_REQUIRED,
        `You have reached your plan's limit of ${context.limit} owned projects.`,
      )

      .grant()

      .evaluate();
  }
}
