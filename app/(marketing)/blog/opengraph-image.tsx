import { ImageResponse } from "next/og";

// Zelfde oorzaak als bij app/(marketing)/blog/[slug]/opengraph-image.tsx: blog/page.tsx zet zijn
// eigen openGraph-object (title/description, geen images), en dat vervangt bij Next's metadata-
// merge de afbeelding die het bovenliggende (marketing)-segment anders had geleverd. Zonder dit
// bestand had de bloglijst zelf, net als elk artikel, geen enkele og:image.
export const alt = "Ctrl PPC blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#121820",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              width: 64,
              height: 64,
              borderRadius: 12,
              background: "linear-gradient(135deg, #818cf8, #5457c4)",
            }}
          />
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -2 }}>
            <span style={{ color: "#f4f3ef" }}>CTRL</span>
            <span style={{ color: "#f5960b" }}>&nbsp;PPC</span>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 32, color: "#818cf8", fontWeight: 600 }}>
          Blog
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 26, color: "rgba(244,243,239,0.6)" }}>
          Technical analysis, not product news
        </div>
      </div>
    ),
    { ...size }
  );
}
