import {
  CertificateType,
  DifficultyLevel,
  CompetitionMemberRole,
  CompetitionMode,
  CompetitionStatus,
  CompetitionVisibility,
  OrganizerType,
  RegistrationFeeType,
  RegistrationPlatform,
} from "@/generated/prisma";
import { CompetitionPermissionsDTO } from "../backend/authorization/dto";
import type { CompetitionLocationDTO } from "./competition-location.dto";
import type { CompetitionTechnologyDTO } from "./competition-technology.dto";
import type { CompetitionEligibilityDTO } from "./competition-eligibility.dto";


export interface CompetitionEditDTO {
  id: string;

  // ---------------------------------------------------------------------------
  // Basic
  // ---------------------------------------------------------------------------

  title: string;
  slug: string;

  shortDescription: string | null;

  organizer: string | null;

  /** `null` means no documentation has ever been written — distinct from a
   * saved-but-empty document, which cannot occur once cleared (see
   * `CompetitionRepository.update`, the `content: null` branch). */
  content: string | null;

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  website: string | null;

  registrationLink: string | null;

  registrationPlatform: RegistrationPlatform | null;

  registrationFee: string | null;

  registrationFeeType: RegistrationFeeType | null;

  // ---------------------------------------------------------------------------
  // Event
  // ---------------------------------------------------------------------------

  mode: CompetitionMode | null;

  visibility: CompetitionVisibility;

  status: CompetitionStatus | null;

  organizerType: OrganizerType | null;

  difficulty: DifficultyLevel | null;

  certificateType: CertificateType | null;

  prizePool: string | null;

  /**
   * Managed through the dedicated locations endpoints, not the competition
   * PATCH — each entry owns its own place row, dates, and ordering, which a
   * whole-object save could not reconcile safely.
   */
  locations: CompetitionLocationDTO[];

  // ---------------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------------

  registrationDeadline: string | null;

  startDate: string | null;

  endDate: string | null;

  /**
   * When registration opens. Null means there is no automatic
   * registration-opening transition — not that registration is always open.
   */
  registrationStartDate: string | null;

  // ---------------------------------------------------------------------------
  // Lifecycle automation
  // ---------------------------------------------------------------------------

  /** Opt-out from automatic lifecycle management. Manual status changes via
   * the dropdown always remain allowed regardless of this flag. */
  automaticStatusUpdatesDisabled: boolean;

  /** When `status` last changed, by any path. Null if never observed. */
  statusUpdatedAt: string | null;

  // ---------------------------------------------------------------------------
  // Team
  // ---------------------------------------------------------------------------

  minTeamSize: number | null;

  maxTeamSize: number | null;

  // ---------------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------------

  logoAsset: {
    secureUrl: string;
  } | null;

  coverAsset: {
    secureUrl: string;
  } | null;

  bannerAsset: {
    secureUrl: string;
  } | null;

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------

  categories: {
    id: string;
    name: string;
    slug: string;
  }[];

  /**
   * Technologies relevant to the competition — not a required-tools list.
   * Managed through the dedicated technologies endpoints, not the
   * competition PATCH, same as `locations`. Unlike Project and Portfolio
   * technologies, this relationship has no ordering.
   */
  technologies: CompetitionTechnologyDTO[];

  /**
   * Who the competition is open to. Managed through the dedicated
   * eligibilities endpoints, not the competition PATCH, same as
   * `locations`/`technologies` — an empty array is a valid, distinct state
   * ("no eligibility declared"), not the same as `OPEN`.
   */
  eligibilities: CompetitionEligibilityDTO[];

}
export interface CompetitionEditDTOWithPermissions extends CompetitionEditDTO {


  role: CompetitionMemberRole | null;

  updatedAt: Date;

  permissions: CompetitionPermissionsDTO;
}
