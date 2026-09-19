import { z } from "zod";

/**
 * Upper bound on one batch "my state for these competitions" lookup.
 *
 * The list page shows one page of results, well under this — a caller
 * asking for more is probing, not browsing. Mirrors
 * `MAX_BULK_COMPETITION_IDS`'s reasoning in `bulk-competition-action.ts`.
 */
export const MAX_COMPETITION_USER_STATE_IDS = 100;

/**
 * `competitionIds` arrives as a single comma-separated query parameter
 * (`?competitionIds=a,b,c`), not a repeated one — simpler for a same-origin
 * `fetch` client to build, and this is a query string only this feature's
 * client reads.
 *
 * Every id is validated as a cuid before anything reaches the database,
 * the same discipline `BulkTargetIdsSchema` applies.
 */
export const CompetitionUserStateQuerySchema = z.object({
  competitionIds: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(
      z
        .array(z.string().cuid())
        .min(1, "At least one competition id is required.")
        .max(
          MAX_COMPETITION_USER_STATE_IDS,
          `Cannot look up more than ${MAX_COMPETITION_USER_STATE_IDS} competitions at once.`,
        ),
    ),
});

export type CompetitionUserStateQueryInput = z.infer<
  typeof CompetitionUserStateQuerySchema
>;
