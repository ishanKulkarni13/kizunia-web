import { z } from "zod";

import { CompetitionImportSchema } from "./competition-import.schema";

/**
 * `create_competition` input: the shared import contract, unchanged.
 *
 * Kept as its own named schema (rather than every tool importing
 * `CompetitionImportSchema` directly) so `create_competition`'s contract can
 * diverge from `update_competition`'s later — e.g. requiring a field on
 * create that stays optional on update — without disturbing the shared
 * definition both start from.
 */
export const CreateCompetitionToolSchema = CompetitionImportSchema;

export type CreateCompetitionToolInput = z.infer<typeof CreateCompetitionToolSchema>;
