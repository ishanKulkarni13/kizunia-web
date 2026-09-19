import type {
  CompetitionMemberRole,
  CompetitionStatus,
  CompetitionVisibility,
} from "@/generated/prisma";

import type { CompetitionPermissionsDTO } from "./competition-permissions.dto";

/**
 * Lightweight DTO used by management tables.
 *
 * This is intentionally different from the public competition DTO.
 * It contains only the information required for list views.
 */
export interface CompetitionManagementTableDTO {
  id: string;

  slug: string;

  title: string;

  organizer: string | null;

  logoUrl: string | null;

  status: CompetitionStatus | null;

  visibility: CompetitionVisibility;

  registrationDeadline: Date | null;

  role: CompetitionMemberRole;

  memberCount: number;

  updatedAt: Date;

  permissions: CompetitionPermissionsDTO;
}
