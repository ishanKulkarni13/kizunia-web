import { z } from "zod";

/**
 * Portfolio Technologies - Request schemas
 *
 * No schema carries a `portfolioId`. The portfolio is always resolved from
 * the authenticated session, so there is nothing for a client to assert.
 */

const StartedUsingAtSchema = z.coerce.date().nullable();
const DescriptionSchema = z.string().trim().min(1).max(2000).nullable();

export const AddPortfolioTechnologySchema = z.object({
  technologyId: z.string().trim().min(1, "A technology id is required."),

  startedUsingAt: StartedUsingAtSchema.optional(),

  description: DescriptionSchema.optional(),
});

export type AddPortfolioTechnologyInput = z.infer<
  typeof AddPortfolioTechnologySchema
>;

export const UpdatePortfolioTechnologySchema = z
  .object({
    startedUsingAt: StartedUsingAtSchema.optional(),

    description: DescriptionSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdatePortfolioTechnologyInput = z.infer<
  typeof UpdatePortfolioTechnologySchema
>;

/**
 * Full reordering by identity: position in the array becomes `displayOrder`.
 * The request must name every manageable technology of the portfolio
 * exactly once — a partial list would leave the remainder at stale
 * positions. The service validates that with an exact-cover check.
 */
export const ReorderPortfolioTechnologiesSchema = z.object({
  technologyIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one technology id must be provided."),
});

export type ReorderPortfolioTechnologiesInput = z.infer<
  typeof ReorderPortfolioTechnologiesSchema
>;
