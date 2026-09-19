import {
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";

/**
 * One row of the authenticated actor's own "my projects" listing.
 *
 * Distinct from `ProjectSummaryDto` on purpose: this DTO carries membership
 * data (`myRole`, `canEdit`) that the public summary must never expose.
 */
export interface ProjectMineSummaryDto {
  id: string;

  title: string;

  slug: string;

  shortDescription: string;

  logo: {
    id: string;
    url: string;
  } | null;

  visibility: ProjectVisibility;

  status: ProjectStatus;

  startDate: Date | null;

  endDate: Date | null;

  updatedAt: Date;

  /**
   * The actor's own `ProjectMember.role` for this project. Read from the
   * same membership-scoped query result the row itself came from — never
   * client-supplied.
   */
  myRole: ProjectRole;

  /**
   * Whether the actor may edit this project, resolved through the same
   * `ProjectPolicy`/`ProjectPermissionResolver` the editor uses. Frontend
   * components must render the Edit action from this flag, not by
   * re-deriving it from `myRole`.
   */
  canEdit: boolean;
}
