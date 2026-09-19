import { z } from "zod";

/**
 * Upper bound on one lifecycle apply request. Mirrors
 * `MAX_BULK_COMPETITION_IDS` — the same reasoning applies: a ceiling on how
 * many rows one transactional apply covers, not a performance guess.
 */
export const MAX_LIFECYCLE_APPLY_IDS = 100;

/**
 * The lifecycle apply request carries competition ids and nothing else — no
 * target status. The server re-reads each row and derives the status itself
 * from authoritative database state; a client can never assert "set
 * competition X to ONGOING" through this endpoint. See
 * `CompetitionLifecycleService.apply`.
 */
export const ApplyLifecycleSchema = z.object({
  ids: z
    .array(z.string().cuid())
    .min(1, "At least one competition id is required.")
    .max(
      MAX_LIFECYCLE_APPLY_IDS,
      `A lifecycle apply cannot target more than ${MAX_LIFECYCLE_APPLY_IDS} competitions at once.`,
    ),
});

export type ApplyLifecycleInput = z.infer<typeof ApplyLifecycleSchema>;
