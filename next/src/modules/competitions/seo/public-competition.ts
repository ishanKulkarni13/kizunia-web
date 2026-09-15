import { cache } from "react";

import { CompetitionRepository } from "@/modules/competitions/backend/repository";
import { CompetitionVisibility } from "@/generated/prisma";

/**
 * Loads the public competition representation used by the route, metadata,
 * and social preview image.
 *
 * `cache` deduplicates requests within the same render. Cross-request caching
 * is intentionally left to the data layer/Next.js runtime once its cache API
 * is introduced here, rather than duplicating fetch logic in consumers.
 */
export const getPublicCompetition = cache(async (slug: string) => {
  const competition = await CompetitionRepository.findBySlug(slug);

  if (!competition || competition.visibility !== CompetitionVisibility.PUBLIC) {
    return null;
  }

  return competition;
});
