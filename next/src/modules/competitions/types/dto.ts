import type {
  CompetitionMode,
  CompetitionStatus,
  RegistrationPlatform,
  RegistrationFeeType,
  Competition,
  Asset,
  CompetitionTechnology,
  CompetitionCategory,
  Prisma,
} from "@/generated/prisma";
import type { CompetitionLocationSummaryDTO } from "./competition-location.dto";

/**
 * Data required by the Competition Card.
 *
 * This DTO is consumed by the UI.
 * It intentionally hides database implementation details.
 */
export interface CompetitionCardDTO {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  organizer: string | null;
  registrationPlatform: RegistrationPlatform | null;
  /**
   * Ordered by the competition's own presentation order. Empty means no
   * location is known yet — not that the competition is online; that is `mode`.
   */
  locations: CompetitionLocationSummaryDTO[];
  mode: CompetitionMode | null;
  status: CompetitionStatus | null;
  startDate: Date | null;
  registrationDeadline: Date | null;
  registrationFeeType: RegistrationFeeType | null;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  logoUrl: string | null;
  coverUrl: string | null;
}




//TODO: remove some of these fields that are not needed in the UI, and add any additional fields that are needed for the UI.
export type CompetitionDetailDTO = Prisma.CompetitionGetPayload<{ //Public DTO for competition details
  include: {
    logoAsset: true;
    coverAsset: true;
    bannerAsset: true;
    content: true,
    categories: {
      include: {
        category: true;
      };
    };

    technologies: {
      include: {
        technology: true;
      };
    };

    eligibilities: true;

    locations: {
      include: {
        location: true;
      };
    };
  };
}>;

export type CompetitionWithRelations = CompetitionDetailDTO;
