import { z } from "zod";

import { DimensionId } from "@/modules/recommendations";

/**
 * One `(dimension, value, weight)` fact about what the user cares about.
 * Mirrors `PreferenceEntryOverrideSchema` in
 * `modules/recommendations/schemas/generate-recommendations.ts` — that
 * schema validates the same shape for the internal tuning route, and this
 * one validates it for real, persisted user input. Kept as a separate
 * definition (rather than imported) so this module never depends on
 * `recommendations`' schemas/backend, only on its pure, client-safe
 * `DimensionId` export.
 */
export const CompetitionPreferenceEntrySchema = z
  .object({
    dimension: z.nativeEnum(DimensionId),
    value: z.string().min(1).max(200),
    weight: z.number().min(0).max(1),
  })
  .strict();

/**
 * Full-replace payload: the client sends the complete desired profile, and
 * the service replaces the user's entire set of preferences transactionally.
 * An empty array is a valid, meaningful input — it resets the profile
 * (see ND-P-04: an empty profile disables personalized recommendation).
 */
export const UpdateCompetitionPreferencesSchema = z
  .object({
    preferences: z.array(CompetitionPreferenceEntrySchema).max(200),
  })
  .strict();

export type UpdateCompetitionPreferencesInput = z.infer<
  typeof UpdateCompetitionPreferencesSchema
>;
