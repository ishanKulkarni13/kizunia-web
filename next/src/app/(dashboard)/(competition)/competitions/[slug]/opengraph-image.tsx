import { SlugSchema } from "@/lib/validation/index";
import { CompetitionService } from "@/modules/competitions/backend/service";
import { ImageResponse } from "next/og";
import { cache } from "react";

export const alt = "Competition on Kizunia";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

const getCompetition = cache(async (slug: string) => {
  const parsedSlug = SlugSchema.parse(slug);

  return CompetitionService.findPublicBySlug(parsedSlug);
});

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const competition = await getCompetition(slug);

  if (!competition) {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          fontSize: 48,
          fontWeight: 700,
        }}
      >
        Kizunia
      </div>,
      size,
    );
  }

  const logoUrl = competition.logoAsset?.secureUrl;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: "#ffffff",
        padding: "80px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "40px",
          maxWidth: "1000px",
        }}
      >
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            width="180"
            height="180"
            style={{
              objectFit: "contain",
              borderRadius: "24px",
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          {competition.title}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: "60px",
          bottom: "40px",
          display: "flex",
          fontSize: 30,
          fontWeight: 700,
        }}
      >
        Kizunia
      </div>
    </div>,
    size,
  );
}
