import { z } from "zod";

/**
 * Attaches one Technology from the global catalog to a competition.
 *
 * Just an id — the server independently re-validates that the Technology
 * exists and is active (not soft-deleted) before attaching it; see
 * `CompetitionTechnologyService.attach`. Never trust the client/picker here,
 * even though the catalog endpoint it is populated from already excludes
 * deleted rows.
 */
export const AttachCompetitionTechnologySchema = z.object({
  technologyId: z.string().trim().min(1, "A technology is required."),
});

export type AttachCompetitionTechnologyInput = z.infer<
  typeof AttachCompetitionTechnologySchema
>;
