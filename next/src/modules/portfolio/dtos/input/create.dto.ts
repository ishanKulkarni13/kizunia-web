import z from "zod";
import { createPortfolioSchema } from "../../schemas";

export type CreatePortfolioDto =
  z.infer<typeof createPortfolioSchema>;