
import { ProjectRole } from "@/generated/prisma";
import { ProjectAction } from "./actions";

/**
 * Static RBAC permission sets for Project members.
 *
 * This file only maps member roles to actions.
 *
 * It does NOT evaluate:
 * - Platform roles
 * - Deleted projects
 * - Project visibility
 * - Banned users
 * - Ownership
 *
 * Those rules belong in the Policy.
 */
export const ProjectPermissionSet: Readonly<
  Record<ProjectRole, ReadonlySet<ProjectAction>>
> = {
  OWNER: new Set([
    ProjectAction.VIEW,

    ProjectAction.EDIT,
    ProjectAction.DELETE,

    ProjectAction.PUBLISH,
    ProjectAction.UNPUBLISH,

    ProjectAction.MANAGE_MEMBERS,

    ProjectAction.MANAGE_CONTENT,

    ProjectAction.MANAGE_MEDIA,

    ProjectAction.MANAGE_LINKS,

    ProjectAction.MANAGE_TECHNOLOGIES,

    ProjectAction.MANAGE_CATEGORIES,

    ProjectAction.MANAGE_BADGES,

    ProjectAction.MANAGE_TESTIMONIALS,

    ProjectAction.MANAGE_COMPETITIONS,
  ]),

  MAINTAINER: new Set([
    ProjectAction.VIEW,

    ProjectAction.EDIT,

    ProjectAction.MANAGE_CONTENT,

    ProjectAction.MANAGE_MEDIA,

    ProjectAction.MANAGE_LINKS,

    ProjectAction.MANAGE_TECHNOLOGIES,

    ProjectAction.MANAGE_CATEGORIES,

    ProjectAction.MANAGE_BADGES,

    ProjectAction.MANAGE_TESTIMONIALS,
  ]),

  CONTRIBUTOR: new Set([
    ProjectAction.VIEW,
  ]),
};