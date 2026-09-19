import { z } from "zod";

export const AttachCompetitionSuggestionAssetSchema = z.object({
  assetId: z.string().cuid(),
});

export type AttachCompetitionSuggestionAssetInput = z.infer<
  typeof AttachCompetitionSuggestionAssetSchema
>;
