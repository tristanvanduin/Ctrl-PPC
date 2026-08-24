import type { Metadata } from "next";
import { JuridischDocumentWeergave } from "@/components/marketing/juridisch-document";
import { PRIVACY_STATEMENT } from "@/lib/legal/documenten";
import { isDefinitief } from "@/lib/legal/bedrijfsgegevens";

/**
 * /privacy. De inhoud komt uit lib/legal/documenten.ts; hier staat alleen de metadata.
 *
 * ROBOTS HANGT AAN isDefinitief(), NIET AAN EEN VASTE WAARDE. Zolang er nog bedrijfsgegevens
 * ontbreken is dit document een concept, en een concept-privacyverklaring hoort niet in de index:
 * hij wordt dan als "de" verklaring geciteerd terwijl er nog beslissingen open staan. Zodra
 * lib/legal/bedrijfsgegevens.ts gevuld is, gaat de pagina vanzelf op indexeerbaar en verschijnt
 * hij in de sitemap (app/sitemap.ts leest dezelfde functie) -- geen tweede plek om te onthouden.
 */
export const metadata: Metadata = {
  title: "Privacy Statement: Ctrl PPC",
  description:
    "How Ctrl PPC handles personal data: our role as processor and as controller, sub-processors, " +
    "retention periods, and security measures. Published in Dutch.",
  alternates: { canonical: "/privacy" },
  robots: isDefinitief() ? undefined : { index: false, follow: true },
  openGraph: {
    title: "Privacy Statement: Ctrl PPC",
    description:
      "How Ctrl PPC handles personal data: processor versus controller, sub-processors, retention, " +
      "and security.",
    type: "website",
  },
};

export default function PrivacyPage() {
  return <JuridischDocumentWeergave doc={PRIVACY_STATEMENT} />;
}
