import { z } from "zod";

export const TitleSchema = z
  .string()
  .trim()
  .min(3, "Title must be at least 3 characters.")
  .max(150, "Title cannot exceed 150 characters.");

export const SlugSchema = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters.")
  .max(150, "Slug cannot exceed 150 characters.")
  .regex(
    /^[a-z0-9-]+$/,
    "Slug may only contain lowercase letters, numbers, and hyphens.",
  );

export const ShortDescriptionSchema = z
  .string()
  .trim()
  .min(3, "Short description must be at least 3 characters.")
  .max(500, "Short description cannot exceed 500 characters.");

  export const ContentSchema = z
  .string()

export const OrganizerSchema = z
  .string()
  .trim()
  .max(150, "Organizer cannot exceed 150 characters.");

// export const DocumentationSchema = z.string().trim();
