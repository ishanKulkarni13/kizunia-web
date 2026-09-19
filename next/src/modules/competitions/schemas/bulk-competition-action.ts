import { z } from "zod";

import { CompetitionStatus, CompetitionVisibility } from "@/generated/prisma";

/**
 * Upper bound on one bulk request.
 *
 * Not a performance guess — it is the ceiling on how many rows one
 * `updateMany` (and, before that, one authorization pass) is asked to cover
 * in a single request. Kept small and explicit rather than left unbounded,
 * the same reasoning `MAX_LOCATIONS_PER_COMPETITION` uses elsewhere in this
 * module.
 */
export const MAX_BULK_COMPETITION_IDS = 50;

/**
 * The set of rows a bulk request targets.
 *
 * Every id is validated as a cuid before anything else happens — an
 * malformed id can never reach a database lookup or an authorization check,
 * the same discipline already applied to `placeId` in the locations module.
 */
const BulkTargetIdsSchema = z
  .array(z.string().cuid())
  .min(1, "At least one competition id is required.")
  .max(
    MAX_BULK_COMPETITION_IDS,
    `A bulk action cannot target more than ${MAX_BULK_COMPETITION_IDS} competitions at once.`,
  );

/**
 * One bulk mutation, as a discriminated union.
 *
 * Each variant carries exactly the data its action needs and nothing more —
 * `SET_STATUS` cannot be sent without a `status`, `DELETE` cannot carry a
 * stray `status` that would be silently ignored. The shape itself rules out
 * a malformed request rather than a runtime check having to notice one.
 */
export const BulkCompetitionActionSchema = z.object({
  ids: BulkTargetIdsSchema,

  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("SET_STATUS"),
      status: z.nativeEnum(CompetitionStatus),
    }),
    z.object({
      type: z.literal("SET_VISIBILITY"),
      visibility: z.nativeEnum(CompetitionVisibility),
    }),
    z.object({ type: z.literal("DELETE") }),
    z.object({ type: z.literal("RESTORE") }),
  ]),
});

export type BulkCompetitionActionInput = z.infer<
  typeof BulkCompetitionActionSchema
>;

export type BulkCompetitionAction = BulkCompetitionActionInput["action"];
