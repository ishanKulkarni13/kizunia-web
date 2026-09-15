import { isAppError } from "@/lib/errors";
import { SlugSchema } from "@/lib/validation/index";
import { unstable_cache } from "next/cache";

import { ZodError } from "zod";
import { CompetitionService } from "../backend/service";
import { CompetitionErrorCode } from "../errors/error-code";

export const getCachedPublicCompetition = (slug: string) =>
  unstable_cache(
    async () => {
      try {
        const parsedSlug = SlugSchema.parse(slug);

        return await CompetitionService.findPublicBySlug(parsedSlug);
      } catch (error) {
        if (error instanceof ZodError) {
          return null;
        }

        if (isAppError(error)) {
          if (
            error.code === CompetitionErrorCode.NOT_FOUND ||
            error.code === CompetitionErrorCode.ARCHIVED ||
            error.code === CompetitionErrorCode.DELETED
          ) {
            return null;
          }
        }

        throw new Error(
          "An unexpected error occurred while fetching the competition.",
        );
      }
    },
    ["competition", "public", slug],
    {
      revalidate: 60,
      tags: [`competition:${slug}`],
    },
  )();