import { z } from "zod";

import { CompetitionType } from "@/generated/prisma";

/**
 * Attaches one type value to a competition.
 *
 * The value must be a member of the domain's `CompetitionType` enum --
 * there is no free-form type string, and no separate catalog to validate
 * against the way `AttachCompetitionTechnologySchema` re-checks a
 * Technology's active state.
 */
export const AttachCompetitionTypeSchema = z.object({
  type: z.nativeEnum(CompetitionType),
});

export type AttachCompetitionTypeInput = z.infer<
  typeof AttachCompetitionTypeSchema
>;

/**
 * Validates the `[type]` route segment on the detach endpoint against the
 * same enum, so an unknown value fails validation through the ordinary
 * request-parsing path rather than reaching Prisma as a raw string.
 */
export const CompetitionTypeParamSchema = z.object({
  type: z.nativeEnum(CompetitionType),
});
