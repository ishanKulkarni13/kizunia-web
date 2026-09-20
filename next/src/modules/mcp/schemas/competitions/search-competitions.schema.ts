import { z } from "zod";

import {
  CertificateType,
  CompetitionMode,
  CompetitionStatus,
  DifficultyLevel,
  EligibilityType,
  OrganizerType,
  RegistrationFeeType,
  RegistrationPlatform,
  RegistrationType,
} from "@/generated/prisma";
import type { RawSearchParams } from "@/lib/search";

/**
 * `search_competitions` input — a structured, typed subset of the filters
 * `CompetitionService.search` already accepts.
 *
 * Deliberately not every filter the web UI exposes (see `search/ui.ts`).
 * Location search, for instance, resolves against a billed external
 * provider and is unlikely to be how an agent narrows results, so it is
 * left out of this first version rather than plumbed through speculatively.
 * Adding a field here is additive and safe: `toRawSearchParams` below is the
 * only place that has to change.
 */
export const SearchCompetitionsSchema = z.object({
  /** Matches competition title and organizer name, case-insensitively. */
  query: z.string().trim().min(1).max(200).optional(),

  modes: z.array(z.nativeEnum(CompetitionMode)).optional(),

  statuses: z.array(z.nativeEnum(CompetitionStatus)).optional(),

  difficultyLevels: z.array(z.nativeEnum(DifficultyLevel)).optional(),

  registrationFeeTypes: z.array(z.nativeEnum(RegistrationFeeType)).optional(),

  registrationTypes: z.array(z.nativeEnum(RegistrationType)).optional(),

  organizerTypes: z.array(z.nativeEnum(OrganizerType)).optional(),

  certificateTypes: z.array(z.nativeEnum(CertificateType)).optional(),

  registrationPlatforms: z.array(z.nativeEnum(RegistrationPlatform)).optional(),

  eligibilities: z.array(z.nativeEnum(EligibilityType)).optional(),

  /** Category slugs, as returned by `search_competitions`/`get_competition`. */
  categories: z.array(z.string().trim().min(1)).optional(),

  /** Technology slugs. */
  technologies: z.array(z.string().trim().min(1)).optional(),

  page: z.number().int().min(1).max(1000).optional(),

  /** Capped below the engine's own ceiling — see `RawSearchParams`'s pagination. */
  limit: z.number().int().min(1).max(50).optional(),
});

export type SearchCompetitionsInput = z.infer<typeof SearchCompetitionsSchema>;

/**
 * Translates the typed MCP input into the flat string-keyed record
 * `CompetitionService.search` (via `planCompetitionSearch`) already expects.
 *
 * This is the one seam that has to track `search/ui.ts`'s parameter names —
 * everything else in this schema is independent of that module's shape.
 */
export function toRawSearchParams(input: SearchCompetitionsInput): RawSearchParams {
  const params: RawSearchParams = {};

  if (input.query) params.search = input.query;
  if (input.modes?.length) params.modes = input.modes.join(",");
  if (input.statuses?.length) params.statuses = input.statuses.join(",");
  if (input.difficultyLevels?.length)
    params.difficultyLevels = input.difficultyLevels.join(",");
  if (input.registrationFeeTypes?.length)
    params.registrationFeeTypes = input.registrationFeeTypes.join(",");
  if (input.registrationTypes?.length)
    params.registrationTypes = input.registrationTypes.join(",");
  if (input.organizerTypes?.length)
    params.organizerTypes = input.organizerTypes.join(",");
  if (input.certificateTypes?.length)
    params.certificateTypes = input.certificateTypes.join(",");
  if (input.registrationPlatforms?.length)
    params.registrationPlatforms = input.registrationPlatforms.join(",");
  if (input.eligibilities?.length)
    params.eligibilities = input.eligibilities.join(",");
  if (input.categories?.length) params.categories = input.categories.join(",");
  if (input.technologies?.length) params.technologies = input.technologies.join(",");
  if (input.page) params.page = String(input.page);
  if (input.limit) params.limit = String(input.limit);

  return params;
}
