import type { Metadata } from "next";
import { JuridischDocumentWeergave } from "@/components/marketing/juridisch-document";
import { ALGEMENE_VOORWAARDEN } from "@/lib/legal/documenten";
import { isDefinitief } from "@/lib/legal/bedrijfsgegevens";

/**
 * /terms. Zie de toelichting bij app/(marketing)/privacy/page.tsx: dezelfde opzet, dezelfde
 * koppeling tussen "zijn de bedrijfsgegevens ingevuld" en indexeerbaarheid.
 *
 * Het pad is /terms en niet /algemene-voorwaarden: de rest van de site is Engelstalig, en dit is
 * het pad waar een bezoeker en een crawler naar zoeken. Het document zelf blijft Nederlands, want
 * dat is de tekst die geldt.
 */
export const metadata: Metadata = {
  title: "Terms of Service: Ctrl PPC",
  description:
    "The terms under which Ctrl PPC is delivered: scope of the service, no guarantee on ROI, " +
    "dependency on ad platforms and AI providers, liability, and Dutch law. Published in Dutch.",
  alternates: { canonical: "/terms" },
  robots: isDefinitief() ? undefined : { index: false, follow: true },
  openGraph: {
    title: "Terms of Service: Ctrl PPC",
    description:
      "Scope of the service, no guarantee on ROI, dependency on third parties, liability, and " +
      "applicable law.",
    type: "website",
  },
};

export default function TermsPage() {
  return <JuridischDocumentWeergave doc={ALGEMENE_VOORWAARDEN} />;
}
