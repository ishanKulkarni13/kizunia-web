import type { Metadata } from "next";

import type { CompetitionVisibility } from "@/generated/prisma";

const getDescription = (title: string, shortDescription: string | null) =>
  shortDescription?.trim() ||
  `Discover ${title} on Kizunia, including eligibility, dates, location, and registration details.`;

export function createCompetitionMetadata(params: {
  slug: string;
  title: string;
  shortDescription: string | null;
  visibility: CompetitionVisibility;
  logoUrl: string | null;
}): Metadata {
  const { slug, title, shortDescription, visibility, logoUrl } = params;
  const description = getDescription(title, shortDescription);
  const isPublic = visibility === "PUBLIC";
  const imageUrl = `/competitions/${slug}/opengraph-image`;

  return {
    title,
    description,
    alternates: {
      canonical: `/competitions/${slug}`,
    },
    robots: {
      index: isPublic,
      follow: isPublic,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `/competitions/${slug}`,
      siteName: "Kizunia",
      images: isPublic
        ? [
            {
              url: imageUrl,
              width: 1200,
              height: 630,
              alt: `${title} | Kizunia`,
            },
          ]
        : undefined,
    },
    twitter: {
      card: isPublic ? "summary_large_image" : "summary",
      title,
      description,
      images: isPublic ? [imageUrl] : undefined,
    },
  };
}
