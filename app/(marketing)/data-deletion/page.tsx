import type { Metadata } from "next";
import { JuridischDocumentWeergave } from "@/components/marketing/juridisch-document";
import { DATA_DELETION } from "@/lib/legal/documenten";
import { isDefinitief } from "@/lib/legal/bedrijfsgegevens";

/**
 * /data-deletion. Zie app/(marketing)/privacy/page.tsx voor de opzet; hier dezelfde koppeling
 * tussen ingevulde bedrijfsgegevens en indexeerbaarheid.
 *
 * WAAROM DEZE PAGINA EEN EIGEN ROUTE HEEFT en geen kopje in het Privacy Statement is: Meta vraagt
 * bij App Review om een aparte "Data Deletion Instructions URL", en die moet zonder account te
 * lezen zijn. Een anker in een langer document telt daar niet als zodanig. Google vraagt hem niet,
 * maar leest hem wel mee bij de OAuth-verificatie van de GA4- en Search Console-scopes.
 */
export const metadata: Metadata = {
  title: "Data deletion: Ctrl PPC",
  description:
    "How to disconnect an ad or analytics account from Ctrl PPC and have the data we hold erased, " +
    "what is removed, and what we are legally required to keep.",
  alternates: { canonical: "/data-deletion" },
  robots: isDefinitief() ? undefined : { index: false, follow: true },
  openGraph: {
    title: "Data deletion: Ctrl PPC",
    description: "How to have the data Ctrl PPC holds about you or your accounts erased.",
    type: "website",
  },
};

export default function DataDeletionPage() {
  return <JuridischDocumentWeergave doc={DATA_DELETION} />;
}
