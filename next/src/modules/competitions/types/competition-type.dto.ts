import type { CompetitionType } from "@/generated/prisma";

/**
 * One type value attached to a competition.
 *
 * `CompetitionTypeRelation` has no fields beyond the composite key
 * (`competitionId`, `type`) -- the value is a fixed domain enum, not a
 * reference to a catalog table, so there is nothing to hydrate beyond the
 * value itself.
 */
export interface CompetitionTypeDTO {
  type: CompetitionType;
}
