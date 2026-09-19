import { z } from "zod";

/**
 * Portfolio Projects - Request schemas
 *
 * No schema carries a `portfolioId`. The portfolio is always resolved from
 * the authenticated session, so there is nothing for a client to assert.
 */

export const AddPortfolioProjectSchema = z.object({
  projectId: z.string().trim().min(1, "A project id is required."),
});

export type AddPortfolioProjectInput = z.infer<
  typeof AddPortfolioProjectSchema
>;

export const UpdatePortfolioProjectSchema = z.object({
  featured: z.boolean(),
});

export type UpdatePortfolioProjectInput = z.infer<
  typeof UpdatePortfolioProjectSchema
>;

/**
 * Full reordering by identity: position in the array becomes `displayOrder`.
 * The request must name every manageable project of the portfolio exactly
 * once — a partial list would leave the remainder at stale positions. The
 * service validates that with an exact-cover check.
 */
export const ReorderPortfolioProjectsSchema = z.object({
  projectIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one project id must be provided."),
});

export type ReorderPortfolioProjectsInput = z.infer<
  typeof ReorderPortfolioProjectsSchema
>;
