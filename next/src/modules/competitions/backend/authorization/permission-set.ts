import { CompetitionAction } from "./actions";
import { CompetitionMemberRole } from "@/generated/prisma";

/**
 * Static RBAC permission sets for Competition members.
 *
 * This file only maps roles to actions.
 *
 * It does NOT evaluate:
 * - Platform roles
 * - Archived state
 * - Locked state
 * - Verification
 * - Ownership
 *
 * Those rules belong in the Policy.
 */
export const CompetitionPermissionSet: Readonly<
  Record<CompetitionMemberRole, ReadonlySet<CompetitionAction>>
> = {
  OWNER: new Set([
    CompetitionAction.VIEW,
    CompetitionAction.EDIT,
    CompetitionAction.DELETE,
    CompetitionAction.PUBLISH,
    CompetitionAction.UNPUBLISH,
    CompetitionAction.MANAGE_MEMBERS,
    CompetitionAction.MANAGE_MEDIA,
    CompetitionAction.MANAGE_LINKS,
    CompetitionAction.MANAGE_TECHNOLOGIES,
    CompetitionAction.MANAGE_ELIGIBILITY,
  ]),
  ORGANIZER: new Set([
    CompetitionAction.VIEW,
    CompetitionAction.EDIT,
    CompetitionAction.DELETE,
    CompetitionAction.PUBLISH,
    CompetitionAction.UNPUBLISH,
    CompetitionAction.MANAGE_MEMBERS,
    CompetitionAction.MANAGE_MEDIA,
    CompetitionAction.MANAGE_LINKS,
    CompetitionAction.MANAGE_TECHNOLOGIES,
    CompetitionAction.MANAGE_ELIGIBILITY,
  ]), //todo

  MAINTAINER: new Set([
    CompetitionAction.VIEW,
    CompetitionAction.EDIT,
    CompetitionAction.MANAGE_MEDIA,
    CompetitionAction.MANAGE_LINKS,
    CompetitionAction.MANAGE_TECHNOLOGIES,
    CompetitionAction.MANAGE_ELIGIBILITY,
  ]),
};
