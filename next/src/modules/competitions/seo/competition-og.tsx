import { ImageResponse } from "next/og";

const size = {
  width: 1200,
  height: 630,
};

export function createCompetitionOgImage(params: {
  title: string;
  organizer: string | null;
  mode: string | null;
  location: string | null;
  logoUrl: string | null;
}) {
  const { title, organizer, mode, location, logoUrl } = params;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "64px",
          background: "#ffffff",
          color: "#111827",
          fontFamily: "Arial",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "18px",
            marginBottom: "42px",
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#111827",
              color: "#ffffff",
              fontSize: 24,
            }}
          >
            K
          </div>
          Kizunia
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "36px",
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              width="150"
              height="150"
              style={{ objectFit: "contain", borderRadius: 24 }}
            />
          ) : null}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "18px",
              maxWidth: 850,
            }}
          >
            <div
              style={{
                fontSize: title.length > 55 ? 46 : 58,
                fontWeight: 800,
                lineHeight: 1.08,
              }}
            >
              {title}
            </div>

            {organizer ? (
              <div style={{ fontSize: 28, color: "#6b7280" }}>
                {organizer}
              </div>
            ) : null}

            {mode || location ? (
              <div style={{ fontSize: 24, color: "#6b7280" }}>
                {[mode, location].filter(Boolean).join(" • ")}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 22,
            color: "#6b7280",
          }}
        >
          Discover competitions on Kizunia
        </div>
      </div>
    ),
    size,
  );
}
