import { z } from "zod";

export const CreateCompetitionSuggestionSchema = z.object({
  suggestionTitle: z
    .string()
    .trim()
    .min(3, "Suggestion title must be at least 3 characters.")
    .max(150, "Suggestion title cannot exceed 150 characters."),

  suggestionContent: z
    .string()
    .trim()
    .optional(),
});

export type CreateCompetitionSuggestionInput = z.infer<
  typeof CreateCompetitionSuggestionSchema
>;