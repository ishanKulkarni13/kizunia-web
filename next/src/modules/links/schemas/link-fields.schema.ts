import { z } from "zod";

import { LinkType } from "@/generated/prisma";
import { UrlSchema } from "@/lib/validation/index";

export const LinkTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(150, "Title cannot exceed 150 characters.");

export const LinkUrlSchema = UrlSchema;

export const LinkTypeSchema = z.nativeEnum(LinkType);
