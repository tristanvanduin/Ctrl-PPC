import type { Metadata } from "next";
import Link from "next/link";
import { Infinity as InfinityIcon } from "lucide-react";
import { TIERS } from "@/lib/marketing/tiers";
import { IntelligenceStore } from "@/components/marketing/intelligence-store";
import { TierGrid } from "@/components/marketing/tier-grid";
import { ComingSoonBadge } from "@/components/marketing/coming-soon-badge";
import { CANONIEK_DOMEIN } from "@/lib/domein";
import { foundationBeschikbaar } from "@/lib/marketing/foundation-cap";

// Fase 7, Task 3, herzien onder de Blueprint v2.0-brief (radical transparency): de echte 5-tier
// ladder (agencies.licentie, migratie 071) als storefront, geen "neem contact op"-gate. Prijzen en
// featurelijst komen uit lib/marketing/tiers.ts en zijn niet langer een placeholder -- zie de
// toelichting daar voor wat al vastlag, wat nieuw is aangeleverd, en welke features nog roadmap
// zijn. Niet-gebouwde features krijgen hier een "Coming soon"-label in plaats van te worden
// verzwegen of als feit gepresenteerd.
//
// FOUNDATION-CAP (12 augustus 2026): de Foundation-kaart wisselt CTA-tekst op foundationBeschikbaar()
// (lib/marketing/foundation-cap.ts) -- een echte, harde grens (bewust API-belasting beheersbaar
// houden tijdens de launch-fase), nooit een live "X van de 50"-teller. Zie dat bestand voor waarom.
//
// SCHEMA (audit, 11 augustus 2026): de homepage heeft Organization + SoftwareApplication JSON-LD,
// bewust zonder offers.price -- er lag toen nergens een bedrag vast. Dat argument geldt hier niet
// meer: deze pagina toont vijf echte prijzen. PRICING_JSON_LD voegt een Offer per geprijsde tier
// toe (Enterprise valt eruit, "Custom" heeft geen getal om te claimen), zodat de rich-snippet-kans
// die de homepage bewust liet liggen hier wel gepakt wordt.
const PRICING_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Ctrl PPC",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: TIERS.filter((t) => t.vanafPerMaand !== null).map((t) => ({
    "@type": "Offer",
    name: t.naam,
    description: t.focus,
    price: t.vanafPerMaand,
    priceCurrency: "EUR",
    url: `https://${CANONIEK_DOMEIN}/pricing`,
    availability: "https://schema.org/InStock",
  })),
};

export const metadata: Metadata = {
  title: "Pricing: Ctrl PPC",
  description: "Foundation is free forever. Five tiers of decisioning on top of it. No limit on accounts, no separate invoice per client.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing: Ctrl PPC",
    description: "Foundation is free forever. Five tiers of decisioning on top of it. No limit on accounts, no separate invoice per client.",
    type: "website",
  },
};

export default async function PricingPage() {
  const foundationOpen = await foundationBeschikbaar();
  return (
    <div className="mx-auto max-w-6xl px-6 pt-14 pb-20 sm:pt-20">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PRICING_JSON_LD) }}
      />
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Pricing</p>
        <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl md:text-5xl">
          What it costs, up front
        </h1>
        <p className="mt-4 text-off-white/60">
          Foundation is free, forever - connect every account and see what happened. Five tiers of
          decisioning sit on top of it, not five gates to a sales call: every paid tier runs the
          full hypothesis loop, the difference is scale, how many accounts, how much compute, and
          how much control over what your client sees. Features marked <ComingSoonBadge /> are on
          the roadmap, not shipped yet.
        </p>
      </div>

      <div className="mt-10 flex items-center justify-center gap-3 rounded-[6px] border border-copper/30 bg-copper/5 px-6 py-4 text-sm text-off-white/80 sm:mt-14">
        <InfinityIcon className="h-5 w-5 shrink-0 text-copper" aria-hidden />
        <span>
          <strong className="font-semibold text-copper">No Limits:</strong> every plan scales with your
          accounts, without a new invoice opening for each extra client.
        </span>
      </div>

      {/* De coupon-tag zit op de kaart zelf ("+5 free Second Opinions" in TierGrid's TierCard),
          niet meer als los blok tussen deze band en de grid -- zie de toelichting daar. Elke kaart
          toont zijn eigen 3 kernfeatures plus een "+N more"-knop (12 augustus 2026, mobiele audit
          -- zie components/marketing/tier-grid.tsx). */}
      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-off-white/40">
        Each tier includes everything from the tier before it - listed once here, not repeated on
        every card below.
      </p>
      <TierGrid tiers={TIERS} foundationOpen={foundationOpen} />

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-off-white/50">
        Curious how Foundation differs from a traditional dashboard tool?{" "}
        <Link href="/vs" className="font-semibold text-neon-indigo hover:underline">
          See the comparison
        </Link>.
      </p>

      <IntelligenceStore />
    </div>
  );
}
