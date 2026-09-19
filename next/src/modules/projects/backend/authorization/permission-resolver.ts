import { ProjectAction } from "./actions";
import type { ProjectContext } from "./context";
import { ProjectPolicy } from "./policy";

import type { ProjectPermissionsDTO } from "./dto";

export class ProjectPermissionResolver {
  /**
   * Resolves all permissions available to the current actor.
   */
  static resolve(
    context: ProjectContext,
  ): ProjectPermissionsDTO {
    return {
      canView: this.can(
        context,
        ProjectAction.VIEW,
      ),

      canEdit: this.can(
        context,
        ProjectAction.EDIT,
      ),

      canDelete: this.can(
        context,
        ProjectAction.DELETE,
      ),

      canPublish: this.can(
        context,
        ProjectAction.PUBLISH,
      ),

      canUnpublish: this.can(
        context,
        ProjectAction.UNPUBLISH,
      ),

      canManageMembers: this.can(
        context,
        ProjectAction.MANAGE_MEMBERS,
      ),

      canManageContent: this.can(
        context,
        ProjectAction.MANAGE_CONTENT,
      ),

      canManageMedia: this.can(
        context,
        ProjectAction.MANAGE_MEDIA,
      ),

      canManageLinks: this.can(
        context,
        ProjectAction.MANAGE_LINKS,
      ),

      canManageTechnologies: this.can(
        context,
        ProjectAction.MANAGE_TECHNOLOGIES,
      ),

      canManageCategories: this.can(
        context,
        ProjectAction.MANAGE_CATEGORIES,
      ),

      canManageBadges: this.can(
        context,
        ProjectAction.MANAGE_BADGES,
      ),

      canManageTestimonials: this.can(
        context,
        ProjectAction.MANAGE_TESTIMONIALS,
      ),

      canManageCompetitions: this.can(
        context,
        ProjectAction.MANAGE_COMPETITIONS,
      ),
    };
  }

  private static can(
    context: ProjectContext,
    action: ProjectAction,
  ): boolean {
    return ProjectPolicy.can(
      context,
      action,
    ).allowed;
  }
}