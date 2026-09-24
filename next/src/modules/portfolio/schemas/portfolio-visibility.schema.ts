import { z } from "zod";

import { PortfolioVisibility } from "@/generated/prisma";

/**
 * Portfolio visibility - Request schema
 *
 * Exactly the two stored levels. `nativeEnum` over the generated enum keeps
 * this in step with the schema if a level is ever added or removed, rather
 * than restating the values here. No `portfolioId`: the portfolio is always
 * resolved from the authenticated session.
 */
export const ChangePortfolioVisibilitySchema = z.object({
  visibility: z.nativeEnum(PortfolioVisibility),
});

export type ChangePortfolioVisibilityInput = z.infer<
  typeof ChangePortfolioVisibilitySchema
>;
