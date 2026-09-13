import { CompetitionAction } from "./actions";
import type { CompetitionContext } from "./context";
import { CompetitionPolicy } from "./policy";

import type { CompetitionPermissionsDTO } from "./dto";

export class CompetitionPermissionResolver {
  /**
   * Resolves all permissions available to the current actor.
   */
  static resolve(
    context: CompetitionContext,
  ): CompetitionPermissionsDTO {
    return {
      canView: this.can(context, CompetitionAction.VIEW),

      canEdit: this.can(context, CompetitionAction.EDIT),

      canDelete: this.can(context, CompetitionAction.DELETE),

      canPublish: this.can(
        context,
        CompetitionAction.PUBLISH,
      ),

      canUnpublish: this.can(
        context,
        CompetitionAction.UNPUBLISH,
      ),

      canManageMembers: this.can(
        context,
        CompetitionAction.MANAGE_MEMBERS,
      ),

      canManageMedia: this.can(
        context,
        CompetitionAction.MANAGE_MEDIA,
      ),

      canManageLinks: this.can(
        context,
        CompetitionAction.MANAGE_LINKS,
      ),

      canManageTechnologies: this.can(
        context,
        CompetitionAction.MANAGE_TECHNOLOGIES,
      ),

      canManageEligibility: this.can(
        context,
        CompetitionAction.MANAGE_ELIGIBILITY,
      ),
    };
  }

  /**
   * Whether the current actor may restore this competition.
   *
   * Kept separate from `resolve()`'s `CompetitionPermissionsDTO` rather than
   * added to it — that DTO is shared with the management scope, which never
   * returns a deleted row for this to be meaningful on. Admin-scope callers
   * use this directly; see `CompetitionAdminTableDTO.canRestore`.
   */
  static canRestore(context: CompetitionContext): boolean {
    return this.can(context, CompetitionAction.RESTORE);
  }

  private static can(
    context: CompetitionContext,
    action: CompetitionAction,
  ): boolean {
    return CompetitionPolicy.can(
      context,
      action,
    ).allowed;
  }
}