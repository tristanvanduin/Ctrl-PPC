import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEMA_INIT_SCRIPT } from "@/components/ui/thema-schakelaar";
import { BRAND_NAME } from "@/lib/branding/brand";
import "./globals.css";
import { CANONIEK_DOMEIN } from "@/lib/domein";

// Fase 7: de root-layout is bewust minimaal. Tot deze fase rendeerde hij zelf de dashboard-
// chrome (Sidebar/TopBar), voor élke route, ook / en /login voor een anonieme bezoeker -- die
// zag dan de interne klantnavigatie en een lege "KLANTEN (0)"-lijst. De chrome staat nu in
// app/(app)/layout.tsx (ingelogd, met Sidebar/TopBar en het Ubuntu-lettertype) en
// app/(marketing)/layout.tsx (voor login, / en de marketingpagina's, met een eigen donker
// thema en eigen lettertypes). Deze laag houdt alleen over wat écht voor alle routes geldt:
// het HTML-skelet, de flits-preventie voor het thema, en de tooltip-provider.

export const metadata: Metadata = {
  // metadataBase op het canonieke domein: zonder deze regel maakt Next relatieve URL's in
  // og:image en canonical op basis van de host waar de pagina toevallig vandaan komt. Bij twee
  // domeinen levert dat verwijzingen naar .nl op, terwijl daar alleen een doorverwijzing staat.
  metadataBase: new URL(`https://${CANONIEK_DOMEIN}`),
  alternates: { canonical: "/" },
  title: `${BRAND_NAME}: SEA Dashboard`,
  description: "Revenue & Conversie Forecasting Dashboard voor het SEA-team",
};

// Stond nergens expliciet -- Next.js valt terug op zijn eigen default (width=device-width,
// initial-scale=1), wat toevallig al goed genoeg was, maar nooit een bewuste keuze. Nu wel:
// gedeeld voor alle routes, marketing en dashboard, vooruitlopend op het mobile-friendly-traject.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="h-full antialiased">
      <head>
        {/* Vóór React en vóór de eerste verf: anders laadt de pagina in het licht en klapt hij een
            fractie later om. Die witte flits op een donker scherm is precies het moment waarop een
            product er goedkoop uitziet. */}
        <script dangerouslySetInnerHTML={{ __html: THEMA_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
