import { z } from "zod";

import { EligibilityType } from "@/generated/prisma";

/**
 * Attaches one eligibility value to a competition.
 *
 * The value must be a member of the domain's `EligibilityType` enum —
 * there is no free-form eligibility string, and no separate catalog to
 * validate against the way `AttachCompetitionTechnologySchema` re-checks a
 * Technology's active state.
 */
export const AttachCompetitionEligibilitySchema = z.object({
  type: z.nativeEnum(EligibilityType),
});

export type AttachCompetitionEligibilityInput = z.infer<
  typeof AttachCompetitionEligibilitySchema
>;

/**
 * Validates the `[type]` route segment on the detach endpoint against the
 * same enum, so an unknown value fails validation through the ordinary
 * request-parsing path rather than reaching Prisma as a raw string.
 */
export const EligibilityTypeParamSchema = z.object({
  type: z.nativeEnum(EligibilityType),
});
