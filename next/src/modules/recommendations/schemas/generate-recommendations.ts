import { z } from "zod";
import { DimensionId } from "../engine";

/**
 * Optional tuning knobs for the internal testing route only. Deliberately
 * `.strict()` and, just as deliberately, has no `userId` field — the actor
 * making the request is always the subject (`SessionService.getStrictActor`
 * supplies it in the controller), so a client cannot ask for someone else's
 * recommendations even by omission-then-guessing; the field does not exist
 * to omit.
 */
export const PreferenceEntryOverrideSchema = z
  .object({
    dimension: z.nativeEnum(DimensionId),
    value: z.string().min(1).max(200),
    weight: z.number().min(0).max(1),
  })
  .strict();

export const GenerateRecommendationsSchema = z
  .object({
    profileOverrides: z.array(PreferenceEntryOverrideSchema).max(50).optional(),
    threshold: z.number().min(0).max(1).optional(),
    topN: z.number().int().min(1).max(50).optional(),
    enabledDimensions: z.array(z.nativeEnum(DimensionId)).min(1).optional(),
    includeDiagnostics: z.boolean().optional(),
  })
  .strict();

export type GenerateRecommendationsInput = z.infer<
  typeof GenerateRecommendationsSchema
>;
