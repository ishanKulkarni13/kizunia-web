import { z } from "zod";

const NameSchema = z.string().trim().min(1).max(120);
const PositionSchema = z.string().trim().min(1).max(120).nullable();
const CompanySchema = z.string().trim().min(1).max(120).nullable();
const MessageSchema = z.string().trim().min(1).max(2000);
const RatingSchema = z.number().int().min(1).max(5).nullable();
const ImageAssetIdSchema = z.string().trim().min(1).nullable();

export const CreateProjectTestimonialSchema = z.object({
  name: NameSchema,

  position: PositionSchema.optional(),

  company: CompanySchema.optional(),

  message: MessageSchema,

  rating: RatingSchema.optional(),

  imageAssetId: ImageAssetIdSchema.optional(),
});

export type CreateProjectTestimonialInput = z.infer<
  typeof CreateProjectTestimonialSchema
>;

export const UpdateProjectTestimonialSchema = z
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

export type UpdateProjectTestimonialInput = z.infer<
  typeof UpdateProjectTestimonialSchema
>;

/**
 * Full reordering by identity: position in the array becomes `displayOrder`.
 * The request must name every testimonial of the project exactly once.
 */
export const ReorderProjectTestimonialsSchema = z.object({
  ids: z
    .array(z.string().trim().min(1))
    .min(1, "At least one testimonial id must be provided."),
});

export type ReorderProjectTestimonialsInput = z.infer<
  typeof ReorderProjectTestimonialsSchema
>;
