/**
 * Competitions Module - Mapper
 *
 * Responsible for converting between database models and DTOs.
 * Prisma models should never be returned directly.
 */
import { RegistrationPlatform, type Prisma } from "@/generated/prisma";
import type { CompetitionEditDTO, CompetitionEditDTOWithPermissions } from "../types/edit-dto";
import type { CompetitionMemberRole } from "@/generated/prisma";
import type {
  CompetitionDetailDTO,
  CompetitionWithRelations,
  CompetitionCardDTO,
} from "../types/dto";
import type { LifecyclePreviewRowDTO } from "../types/lifecycle.dto";
import type { LifecycleEvaluation } from "../lifecycle";
import { CompetitionRepository } from "./repository";
import type { LifecycleRow } from "./lifecycle.repository";
import {
  CompetitionPermissionsDTO,
  CompetitionManagementTableDTO,
  CompetitionAdminTableDTO,
} from "./authorization/dto";
import { competitionLocationMapper } from "./competition-location.mapper";
import { competitionTechnologyMapper } from "./competition-technology.mapper";
import { competitionEligibilityMapper } from "./competition-eligibility.mapper";

/**
 * Prisma payload used when loading Competition cards.
 *
 * Keep this type in sync with the repository's `include` clause.
 */
type CompetitionWithAssets = Prisma.CompetitionGetPayload<{
  include: {
    logoAsset: true;
    coverAsset: true;

    locations: {
      include: {
        location: true;
      };
    };
  };
}>;

type ManageableCompetition = Prisma.CompetitionGetPayload<{
  include: {
    logoAsset: true;
    coverAsset: true;

    members: true;

    _count: {
      select: {
        members: true;
      };
    };
  };
}>;

export class CompetitionMapper {
  /**
   * Converts a Prisma Competition model into a UI-friendly public DTO.\
   */
  toCardDTO(competition: CompetitionWithAssets): CompetitionCardDTO {
    return {
      id: competition.id,
      slug: competition.slug,
      title: competition.title,
      shortDescription: competition.shortDescription,
      organizer: competition.organizer,
      registrationPlatform: competition.registrationPlatform,
      mode: competition.mode,
      startDate: competition.startDate,
      logoUrl: competition.logoAsset?.secureUrl ?? null,
      coverUrl: competition.coverAsset?.secureUrl ?? null,
      locations: competitionLocationMapper.toSummaryDTOs(competition.locations),
      registrationDeadline: competition.registrationDeadline,
      minTeamSize: competition.minTeamSize,
      maxTeamSize: competition.maxTeamSize,
      status: competition.status,
      registrationFeeType: competition.registrationFeeType,
    };
  }

  toDetailDTO(competition: CompetitionWithRelations): CompetitionDetailDTO {
    // public DTO for competition details
    return {
      ...competition,
    };
  }

  /**
   * Converts multiple Competitions.
   */
  toCardDTOs(competitions: CompetitionWithAssets[]): CompetitionCardDTO[] {
    return competitions.map((competition) => this.toCardDTO(competition));
  }

  toManagementTableDTO(params: {
    // for competition management table for competition orgs/owner/maintainers
    competition: ManageableCompetition;
    role: CompetitionMemberRole;
    permissions: CompetitionPermissionsDTO;
  }): CompetitionManagementTableDTO {
    const { competition, role, permissions } = params;

    return {
      id: competition.id,

      slug: competition.slug,

      title: competition.title,

      organizer: competition.organizer,

      logoUrl: competition.logoAsset?.secureUrl ?? null,

      status: competition.status,

      visibility: competition.visibility,

      role,

      memberCount: competition._count.members,

      registrationDeadline: competition.registrationDeadline,

      updatedAt: competition.updatedAt,

      permissions,
    };
  }
  toManagementTableDTOs(
    competitions: ManageableCompetition[],
  ): CompetitionManagementTableDTO[] {
    throw new Error("Use the service to map management DTOs.");
  }

  /**
   * The admin table's row — everything `toManagementTableDTO` returns, plus
   * `deletedAt`. Used only by `CompetitionService.searchAdmin`; every other
   * caller of the shared fields keeps using `toManagementTableDTO`, whose
   * return type has no deletion-state field for `deletedAt` to occupy.
   */
  toAdminTableDTO(params: {
    competition: ManageableCompetition;
    role: CompetitionMemberRole;
    permissions: CompetitionPermissionsDTO;
    canRestore: boolean;
  }): CompetitionAdminTableDTO {
    return {
      ...this.toManagementTableDTO(params),
      deletedAt: params.competition.deletedAt,
      canRestore: params.canRestore,
      automaticStatusUpdatesDisabled:
        params.competition.automaticStatusUpdatesDisabled,
    };
  }

    toEditDTO(params: {
    // for competition management table for competition orgs/owner/maintainers
    competition: Awaited<
      ReturnType<typeof CompetitionRepository.findByIdForEdit>
    >;
  
  }): CompetitionEditDTO {
    const { competition } = params;

    return {
      id: competition.id,

      title: competition.title,
      slug: competition.slug,
      shortDescription: competition.shortDescription,

      organizer: competition.organizer,

      website: competition.website,

      registrationLink: competition.registrationLink,

      content: competition.content?.content ?? null,

      mode: competition.mode,

      visibility: competition.visibility,

      status: competition.status,

      locations: competitionLocationMapper.toDTOs(competition.locations),

      prizePool: competition.prizePool?.toString() ?? null,

      minTeamSize: competition.minTeamSize,

      maxTeamSize: competition.maxTeamSize,

      registrationDeadline:
        competition.registrationDeadline?.toISOString() ?? null,

      startDate: competition.startDate?.toISOString() ?? null,

      endDate: competition.endDate?.toISOString() ?? null,

      registrationStartDate:
        competition.registrationStartDate?.toISOString() ?? null,

      automaticStatusUpdatesDisabled:
        competition.automaticStatusUpdatesDisabled,

      statusUpdatedAt: competition.statusUpdatedAt?.toISOString() ?? null,

      registrationPlatform: competition.registrationPlatform,

      registrationFee: competition.registrationFee,

      registrationFeeType: competition.registrationFeeType,

      organizerType: competition.organizerType,

      difficulty: competition.difficulty,

      certificateType: competition.certificateType,

      logoAsset: competition.logoAsset
        ? {
            secureUrl: competition.logoAsset.secureUrl,
          }
        : null,

      coverAsset: competition.coverAsset
        ? {
            secureUrl: competition.coverAsset.secureUrl,
          }
        : null,

      bannerAsset: competition.bannerAsset
        ? {
            secureUrl: competition.bannerAsset.secureUrl,
          }
        : null,

      categories: competition.categories.map((c) => ({
        id: c.category.id,
        name: c.category.name,
        slug: c.category.slug,
      })),

      technologies: competitionTechnologyMapper.toDTOs(competition.technologies),

      eligibilities: competitionEligibilityMapper.toDTOs(competition.eligibilities),


    };
  }


  toEditDTOWithPermissions(params: {
    // for competition management table for competition orgs/owner/maintainers
    competition: Awaited<
      ReturnType<typeof CompetitionRepository.findByIdForEdit>
    >;
    role: CompetitionMemberRole | null;
    permissions: CompetitionPermissionsDTO;
  }): CompetitionEditDTOWithPermissions {
    const { competition, role, permissions } = params;

    return {
      id: competition.id,

      title: competition.title,
      slug: competition.slug,
      shortDescription: competition.shortDescription,

      organizer: competition.organizer,

      website: competition.website,

      registrationLink: competition.registrationLink,

      content: competition.content?.content ?? null,

      mode: competition.mode,

      visibility: competition.visibility,

      status: competition.status,

      locations: competitionLocationMapper.toDTOs(competition.locations),

      prizePool: competition.prizePool?.toString() ?? null,

      minTeamSize: competition.minTeamSize,

      maxTeamSize: competition.maxTeamSize,

      registrationDeadline:
        competition.registrationDeadline?.toISOString() ?? null,

      startDate: competition.startDate?.toISOString() ?? null,

      endDate: competition.endDate?.toISOString() ?? null,

      registrationStartDate:
        competition.registrationStartDate?.toISOString() ?? null,

      automaticStatusUpdatesDisabled:
        competition.automaticStatusUpdatesDisabled,

      statusUpdatedAt: competition.statusUpdatedAt?.toISOString() ?? null,

      registrationPlatform: competition.registrationPlatform,

      registrationFee: competition.registrationFee,

      registrationFeeType: competition.registrationFeeType,

      organizerType: competition.organizerType,

      difficulty: competition.difficulty,

      certificateType: competition.certificateType,

      logoAsset: competition.logoAsset
        ? {
            secureUrl: competition.logoAsset.secureUrl,
          }
        : null,

      coverAsset: competition.coverAsset
        ? {
            secureUrl: competition.coverAsset.secureUrl,
          }
        : null,

      bannerAsset: competition.bannerAsset
        ? {
            secureUrl: competition.bannerAsset.secureUrl,
          }
        : null,

      categories: competition.categories.map((c) => ({
        id: c.category.id,
        name: c.category.name,
        slug: c.category.slug,
      })),

      technologies: competitionTechnologyMapper.toDTOs(competition.technologies),

      eligibilities: competitionEligibilityMapper.toDTOs(competition.eligibilities),

      role,
      permissions,
      updatedAt: competition.updatedAt,
    };
  }

  /**
   * One row of the admin lifecycle preview. Only ever called for a row
   * `evaluateLifecycle` reported as `changed: true` — the service filters
   * before mapping, so this has no "would this row appear at all" logic of
   * its own.
   */
  toLifecyclePreviewRowDTO(params: {
    row: LifecycleRow;
    evaluation: LifecycleEvaluation;
  }): LifecyclePreviewRowDTO {
    const { row, evaluation } = params;

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,

      currentStatus: row.status,
      proposedStatus: evaluation.status,

      reason: evaluation.reason,
      drivingDate: evaluation.drivingDate?.toISOString() ?? null,

      automaticStatusUpdatesDisabled: row.automaticStatusUpdatesDisabled,
      statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
    };
  }

  

  // toEditDTO(
  //   // admin DTO for competition edit
  //   competition: Awaited<
  //     ReturnType<typeof CompetitionRepository.findByIdForEdit>
  //   >,
  // ): CompetitionEditDTO {
  //   return {
  //     id: competition.id,

  //     title: competition.title,
  //     slug: competition.slug,
  //     shortDescription: competition.shortDescription,

  //     organizer: competition.organizer,

  //     website: competition.website,

  //     registrationLink: competition.registrationLink,

  //     content: competition.content?.content ?? null,

  //     mode: competition.mode,

  //     visibility: competition.visibility,

  //     status: competition.status,

  //     location: competition.location,

  //     prizePool: competition.prizePool?.toString() ?? null,

  //     minTeamSize: competition.minTeamSize,

  //     maxTeamSize: competition.maxTeamSize,

  //     registrationDeadline:
  //       competition.registrationDeadline?.toISOString() ?? null,

  //     startDate: competition.startDate?.toISOString() ?? null,

  //     endDate: competition.endDate?.toISOString() ?? null,

  //     registrationPlatform: competition.registrationPlatform,

  //     registrationFee: competition.registrationFee,

  //     registrationFeeType: competition.registrationFeeType,

  //     organizerType: competition.organizerType,

  //     difficulty: competition.difficulty,

  //     certificateType: competition.certificateType,

  //     logoAsset: competition.logoAsset
  //       ? {
  //           secureUrl: competition.logoAsset.secureUrl,
  //         }
  //       : null,

  //     coverAsset: competition.coverAsset
  //       ? {
  //           secureUrl: competition.coverAsset.secureUrl,
  //         }
  //       : null,

  //     bannerAsset: competition.bannerAsset
  //       ? {
  //           secureUrl: competition.bannerAsset.secureUrl,
  //         }
  //       : null,

  //     categories: competition.categories.map((c) => ({
  //       id: c.category.id,
  //       name: c.category.name,
  //       slug: c.category.slug,
  //     })),

  //     technologies: competition.technologies.map((t) => ({
  //       id: t.technology.id,
  //       name: t.technology.name,
  //       slug: t.technology.slug,
  //     })),
  //   };
  // }
}

export const competitionMapper = new CompetitionMapper();
