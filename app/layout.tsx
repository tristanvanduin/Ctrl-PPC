import type { Metadata } from "next";
import { Ubuntu } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { THEMA_INIT_SCRIPT } from "@/components/ui/thema-schakelaar";
import { BRAND_NAME } from "@/lib/branding/brand";
import "./globals.css";
import { CANONIEK_DOMEIN } from "@/lib/domein";

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

// Open Sans stond hier in drie gewichten, en --font-open-sans werd nergens gebruikt. Het kwam
// alleen binnen via --font-mono, waar het niet hoorde omdat het geen monospace-lettertype is
// (zie de toelichting in globals.css). Dat waren dus drie lettertypebestanden per paginabezoek
// voor een verwijzing die nergens naartoe leidde.

export const metadata: Metadata = {
  // metadataBase op het canonieke domein: zonder deze regel maakt Next relatieve URL's in
  // og:image en canonical op basis van de host waar de pagina toevallig vandaan komt. Bij twee
  // domeinen levert dat verwijzingen naar .nl op, terwijl daar alleen een doorverwijzing staat.
  metadataBase: new URL(`https://${CANONIEK_DOMEIN}`),
  alternates: { canonical: "/" },
  title: `${BRAND_NAME} — SEA Dashboard`,
  description: "Revenue & Conversie Forecasting Dashboard voor het SEA-team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${ubuntu.variable} h-full antialiased`}
    >
      <head>
        {/* Vóór React en vóór de eerste verf: anders laadt de pagina in het licht en klapt hij een
            fractie later om. Die witte flits op een donker scherm is precies het moment waarop een
            product er goedkoop uitziet. */}
        <script dangerouslySetInnerHTML={{ __html: THEMA_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex">
        <TooltipProvider>
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-screen ml-72">
            <TopBar />
            <main className="flex-1 p-6">
              {children}
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
