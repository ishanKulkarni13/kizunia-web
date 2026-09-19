import { z } from "zod";

export const UpdatePortfolioProfileSchema = z.object({
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
    .nullable()
    .optional(),

  bio: z
    .string()
    .trim()
    .max(5000)
    .nullable()
    .optional(),

  phone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional(),

  publicContactEmail: z
    .email()
    .nullable()
    .optional(),

  location: z
    .string()
    .trim()
    .max(150)
    .nullable()
    .optional(),

  resumeAssetId: z
    .string()
    .cuid()
    .nullable()
    .optional(),
});

// export type UpdatePortfolioProfileDto = z.infer<
//   typeof UpdatePortfolioProfileSchema
// >;

// export interface UpdatePortfolioProfileDto {
//   displayName?: string;
//   headline?: string | null;
//   bio?: string | null;
//   phone?: string | null;
//   publicContactEmail?: string | null;
//   location?: string | null;
//   resumeAssetId?: string | null;
// }