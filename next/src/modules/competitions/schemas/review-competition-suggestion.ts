import { z } from "zod";

/**
 * Reject and Request Changes both take a genuinely optional reason — an
 * admin must be able to submit either action with no text at all. Approve
 * has no schema: it takes no body.
 */

export const RejectCompetitionSuggestionSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

export type RejectCompetitionSuggestionInput = z.infer<
  typeof RejectCompetitionSuggestionSchema
>;

export const RequestChangesCompetitionSuggestionSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

export type RequestChangesCompetitionSuggestionInput = z.infer<
  typeof RequestChangesCompetitionSuggestionSchema
>;
