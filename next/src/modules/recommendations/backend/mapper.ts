/**
 * Recommendations — Mapper
 *
 * Converts a `CandidateRow` (Prisma) into the two shapes the rest of the
 * module needs:
 *
 * - `RecommendationCandidate` — the engine's pure input. No Prisma types,
 *   no Date-shaped surprises the engine would need to know about.
 * - `CompetitionCardDTO` — the existing, established public shape for
 *   showing a competition (`../../competitions/types/dto.ts`), reused as
 *   the result contract's display type rather than inventing a second one.
 *   Built field-by-field here (not via `competitionMapper.toCardDTO`)
 *   because that method's Prisma payload type is file-private to the
 *   competitions module's mapper — this keeps the dependency to the public
 *   DTO shape only, per `module-boundaries.md`'s "read through a defined
 *   boundary" rule.
 *
 * Prisma models are never returned directly, matching the rest of the
 * codebase's mapper convention (`docs/architecture/folder-structure.md`).
 */
import { competitionLocationMapper } from "@/modules/competitions/backend/competition-location.mapper";
import type { CompetitionCardDTO } from "@/modules/competitions/types/dto";

import type { RecommendationCandidate } from "../engine";
import type { CandidateRow } from "./candidate.repository";

export class RecommendationMapper {
  toCandidate(row: CandidateRow): RecommendationCandidate {
    const searchAreaIds = new Set<string>();
    for (const competitionLocation of row.locations) {
      for (const link of competitionLocation.location.searchAreas) {
        searchAreaIds.add(link.searchAreaId);
      }
    }

    return {
      id: row.id,
      mode: row.mode,
      status: row.status,
      minTeamSize: row.minTeamSize,
      maxTeamSize: row.maxTeamSize,
      registrationType: row.registrationType,
      registrationFeeType: row.registrationFeeType,
      registrationPlatform: row.registrationPlatform,
      organizerType: row.organizerType,
      difficulty: row.difficulty,
      certificateType: row.certificateType,
      categorySlugs: row.categories.map((c) => c.category.slug),
      technologySlugs: row.technologies.map((t) => t.technology.slug),
      eligibilityTypes: row.eligibilities.map((e) => e.type),
      searchAreaIds: [...searchAreaIds],
      startDate: row.startDate,
      registrationDeadline: row.registrationDeadline,
    };
  }

  toCardDTO(row: CandidateRow): CompetitionCardDTO {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      shortDescription: row.shortDescription,
      organizer: row.organizer,
      registrationPlatform: row.registrationPlatform,
      locations: competitionLocationMapper.toSummaryDTOs(row.locations),
      mode: row.mode,
      status: row.status,
      startDate: row.startDate,
      registrationDeadline: row.registrationDeadline,
      registrationFeeType: row.registrationFeeType,
      minTeamSize: row.minTeamSize,
      maxTeamSize: row.maxTeamSize,
      logoUrl: row.logoAsset?.secureUrl ?? null,
      coverUrl: row.coverAsset?.secureUrl ?? null,
      types: row.types.map((t) => t.type),
    };
  }
}

export const recommendationMapper = new RecommendationMapper();
