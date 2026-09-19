import type {
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";

/**
 * A project as the Portfolio *editor* sees it — a deliberate, hand-mapped
 * contract, never a raw entity passthrough.
 *
 * Purposely not `ProjectDetailsDto`: the editor manages a relationship, not a
 * project, so members, content, permissions, badges, competitions and
 * statistics have no place here.
 *
 * `status` and `visibility` ARE exposed, unlike the public portfolio DTO.
 * The owner needs to tell a DRAFT or PRIVATE project apart from a published
 * one, because only the latter will ever render on their public portfolio —
 * the editor shows both, the public view shows one.
 *
 * Never exposed: `deletedAt` (such rows are filtered out, never labelled),
 * `hidden` (deprecated — see schema.prisma), and anything about membership
 * beyond the actor's own role.
 */
export interface PortfolioProjectSummaryDto {
  /**
   * Half of the relationship's composite key, and the address used by every
   * mutation. The other half is always derived from the session, so there is
   * no relationship id a client could guess.
   */
  projectId: string;

  title: string;

  slug: string;

  shortDescription: string;

  logo: PortfolioProjectAssetDto | null;

  status: ProjectStatus;

  visibility: ProjectVisibility;

  /**
   * The portfolio owner's own role in the project, read from the trusted
   * membership row the query already joins. Never client-supplied.
   */
  myRole: ProjectRole;

  /** Relationship state, not a property of the project itself. */
  featured: boolean;

  displayOrder: number;

  /** When the project was added to the portfolio. */
  createdAt: Date;
}

export interface PortfolioProjectAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}
