import { revalidateTag } from "next/cache";

const competitionCacheTag = (slug: string) => `competition:${slug}`;

export function invalidateCompetitionCache(
  slug: string,
  previousSlug?: string,
) {
  revalidateTag(competitionCacheTag(slug), "max");

  if (previousSlug && previousSlug !== slug) {
    revalidateTag(competitionCacheTag(previousSlug), "max");
  }
}