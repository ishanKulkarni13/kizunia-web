import { z } from "zod";

export const createPortfolioSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(100)
    .optional(),

  headline: z
    .string()
    .trim()
    .max(150)
    .optional(),

  bio: z
    .string()
    .trim()
    .max(5000)
    .optional(),

  phone: z
    .string()
    .trim()
    .max(30)
    .optional(),

  publicContactEmail: z
    .email()
    .optional(),

  location: z
    .string()
    .trim()
    .max(150)
    .optional(),

  resumeAssetId: z
    .string()
    .cuid()
    .optional(),
});

// export type CreatePortfolioDto = z.infer<
//   typeof createPortfolioSchema
// >; // exported in dtos/input/create.dto.ts