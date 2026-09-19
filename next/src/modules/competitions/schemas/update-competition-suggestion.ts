import { z } from "zod";

export const UpdateCompetitionSuggestionSchema = z
  .object({
    suggestionTitle: z
      .string()
      .trim()
      .min(3, "Suggestion title must be at least 3 characters.")
      .max(150, "Suggestion title cannot exceed 150 characters.")
      .optional(),

    suggestionContent: z
      .string()
      .trim()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateCompetitionSuggestionInput = z.infer<
  typeof UpdateCompetitionSuggestionSchema
>;