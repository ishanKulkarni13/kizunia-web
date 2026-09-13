import type { EligibilityType } from "@/generated/prisma";

/**
 * One eligibility value attached to a competition.
 *
 * `CompetitionEligibility` has no fields beyond the composite key
 * (`competitionId`, `type`) — the "other side" of this relation is a bare
 * enum member rather than a row in a catalog table, so there is nothing to
 * hydrate beyond the value itself.
 */
export interface CompetitionEligibilityDTO {
  type: EligibilityType;
}
