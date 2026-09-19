import {
  CertificateType,
  DifficultyLevel,
  CompetitionMode,
  CompetitionStatus,
  CompetitionVisibility,
  OrganizerType,
  RegistrationFeeType,
  RegistrationPlatform,
} from "@/generated/prisma";


export interface UpdateCompetitionRequestDTO {
  title?: string;
  slug?: string;

  shortDescription?: string | null;

  organizer?: string | null;

  /** Omit to leave documentation unchanged; `null` explicitly clears it. */
  content?: string | null;

  website?: string | null;

  registrationLink?: string | null;

  registrationPlatform?: RegistrationPlatform | null;

  registrationFee?: string | null;

  registrationFeeType?: RegistrationFeeType | null;

  organizerType?: OrganizerType | null;

  difficulty?: DifficultyLevel | null;

  certificateType?: CertificateType | null;

  mode?: CompetitionMode | null;

  visibility?: CompetitionVisibility;

  status?: CompetitionStatus | null;

  prizePool?: string | null;

  registrationDeadline?: string | null;

  startDate?: string | null;

  endDate?: string | null;

  registrationStartDate?: string | null;

  /**
   * Opt-out from automatic lifecycle management. Omit to leave it
   * unchanged; manual status changes (the `status` field above) always
   * remain allowed regardless of this flag.
   */
  automaticStatusUpdatesDisabled?: boolean;

  minTeamSize?: number | null;

  maxTeamSize?: number | null;
}
