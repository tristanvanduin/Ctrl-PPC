import { ImageResponse } from "next/og";

// Ontbrak volledig: og:title/og:description stonden er, og:image niet -- een gedeelde link
// (Slack, LinkedIn, WhatsApp) toonde dus alleen tekst, geen kaart. Eén afbeelding op
// (marketing)-niveau, want Next.js gebruikt "m closest matching segment": zonder een eigen
// opengraph-image per pagina (buiten scope voor nu) erft elke marketingpagina deze.
//
// Geen custom lettertype geladen: dat vraagt een font-buffer erbij (fetch of fs.readFile) voor
// wat hier een systeem-sans-serif ook goed genoeg doet. Als dit ooit het merklettertype moet
// dragen, is dat de eerste plek om aan te passen.
//
// TAGLINE FIX (11 augustus 2026): stond in het Nederlands op een verder volledig Engelstalige
// site (dezelfde klasse fout als de eerdere html-lang- en blog-datumfixes), en zei "Stop met
// dashboards bouwen" -- terwijl /pricing het dashboard zelf gratis aanbiedt. Vertaald en
// verzacht naar dezelfde "erbovenop, niet in plaats van"-positionering als /vs en ComparisonBlock.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
            <span style={{ color: "#f16b37" }}>&nbsp;PPC</span>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 32, color: "#818cf8", fontWeight: 600 }}>
          Performance Intelligence Platform
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 26, color: "rgba(244,243,239,0.6)" }}>
          Beyond the dashboard. Into the decision.
        </div>
      </div>
    ),
    { ...size }
  );
}
