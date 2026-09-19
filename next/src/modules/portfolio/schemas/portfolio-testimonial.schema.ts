import { z } from "zod";

/**
 * Portfolio Testimonials - Request schemas
 *
 * No schema carries a `portfolioId`. The portfolio is always resolved from
 * the authenticated session, so there is nothing for a client to assert.
 */

const NameSchema = z.string().trim().min(1).max(120);
const PositionSchema = z.string().trim().min(1).max(120).nullable();
const CompanySchema = z.string().trim().min(1).max(120).nullable();
const MessageSchema = z.string().trim().min(1).max(2000);
const RatingSchema = z.number().int().min(1).max(5).nullable();
const ImageAssetIdSchema = z.string().trim().min(1).nullable();

export const AddPortfolioTestimonialSchema = z.object({
  name: NameSchema,

  position: PositionSchema.optional(),

  company: CompanySchema.optional(),

  message: MessageSchema,

  rating: RatingSchema.optional(),

  imageAssetId: ImageAssetIdSchema.optional(),
});

export type AddPortfolioTestimonialInput = z.infer<
  typeof AddPortfolioTestimonialSchema
>;

export const UpdatePortfolioTestimonialSchema = z
  .object({
    name: NameSchema.optional(),

    position: PositionSchema.optional(),

    company: CompanySchema.optional(),

    message: MessageSchema.optional(),

    rating: RatingSchema.optional(),

    imageAssetId: ImageAssetIdSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdatePortfolioTestimonialInput = z.infer<
  typeof UpdatePortfolioTestimonialSchema
>;

/**
 * Full reordering by identity: position in the array becomes `displayOrder`.
 * The request must name every testimonial of the portfolio exactly once.
 */
export const ReorderPortfolioTestimonialsSchema = z.object({
  testimonialIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one testimonial id must be provided."),
});

export type ReorderPortfolioTestimonialsInput = z.infer<
  typeof ReorderPortfolioTestimonialsSchema
>;
