import {
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
} from "@/generated/prisma";
import type { ProjectPermissionsDTO } from "../../authorization/dto";
import type { ProjectLinkDto } from "./project-link.dto";
import type { ProjectTestimonialDto } from "./project-testimonial.dto";

interface ProjectPublicAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}

/**
 * The project shape returned by the public `/projects/[slug]` view page.
 *
 * Callers reaching this DTO have already passed `ProjectPolicy.canView`,
 * so a row here is either a project the actor is a member of (any
 * visibility/status), or a PUBLIC/UNLISTED + PUBLISHED project visible to
 * anyone. Member fields are limited to what is already safe to show on a
 * public team listing (no email or account-sensitive data). `isMember` is
 * computed once here from the same membership lookup already performed for
 * authorization — it must never be inferred from `permissions` on the
 * frontend, since a CONTRIBUTOR is a member with every `canManage*` flag
 * false.
 */
export interface ProjectPublicDetailsDto {
  // ===========================================================================
  // Basic Information
  // ===========================================================================

  id: string;

  title: string;

  slug: string;

  shortDescription: string;

  content: string | null;

  visibility: ProjectVisibility;

  status: ProjectStatus;

  startDate: Date | null;

  endDate: Date | null;

  // ===========================================================================
  // Assets
  // ===========================================================================

  logo: ProjectPublicAssetDto | null;

  cover: ProjectPublicAssetDto | null;

  // ===========================================================================
  // Members
  // ===========================================================================

  members: {
    role: ProjectRole;

    joinedAt: Date;

    user: {
      id: string;

      name: string;

      username: string | null;

      image: string | null;

      avatar: ProjectPublicAssetDto | null;
    };
  }[];

  // ===========================================================================
  // Categories
  // ===========================================================================

  categories: {
    id: string;

    name: string;

    slug: string;
  }[];

  // ===========================================================================
  // Technologies
  // ===========================================================================

  technologies: {
    id: string;

    name: string;

    slug: string;
  }[];

  // ===========================================================================
  // Links
  // ===========================================================================

  links: ProjectLinkDto[];

  // ===========================================================================
  // Testimonials
  // ===========================================================================

  testimonials: ProjectTestimonialDto[];

  // ===========================================================================
  // Statistics
  // ===========================================================================

  statistics: {
    memberCount: number;

    technologyCount: number;

    categoryCount: number;

    testimonialCount: number;
  };

  // ===========================================================================
  // Viewer context
  // ===========================================================================

  /**
   * Whether the current viewer is a member of this project. Computed
   * server-side from the same membership lookup used for authorization —
   * never infer this from `permissions`.
   */
  isMember: boolean;

  /**
   * The current actor's abilities on this project. Frontend components
   * should render read-only vs. editable state from this object rather
   * than inspecting roles/membership themselves.
   */
  permissions: ProjectPermissionsDTO;
}
