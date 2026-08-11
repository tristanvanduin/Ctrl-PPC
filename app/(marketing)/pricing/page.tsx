import type { Metadata } from "next";
import Link from "next/link";
import { Check, Clock, Infinity as InfinityIcon } from "lucide-react";
import { TIERS, sopDekkingVoor, type TierFeature } from "@/lib/marketing/tiers";
import { IntelligenceStore } from "@/components/marketing/intelligence-store";
import { ComingSoonBadge } from "@/components/marketing/coming-soon-badge";
import { CANONIEK_DOMEIN } from "@/lib/domein";

// Fase 7, Task 3, herzien onder de Blueprint v2.0-brief (radical transparency): de echte 5-tier
// ladder (agencies.licentie, migratie 071) als storefront, geen "neem contact op"-gate. Prijzen en
// featurelijst komen uit lib/marketing/tiers.ts en zijn niet langer een placeholder -- zie de
// toelichting daar voor wat al vastlag, wat nieuw is aangeleverd, en welke features nog roadmap
// zijn. Niet-gebouwde features krijgen hier een "Coming soon"-label in plaats van te worden
// verzwegen of als feit gepresenteerd.
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
  description: "Five tiers, one decision engine. No limit on accounts, no separate invoice per client.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing: Ctrl PPC",
    description: "Five tiers, one decision engine. No limit on accounts, no separate invoice per client.",
    type: "website",
  },
};

function FeatureRow({ feature }: { feature: TierFeature }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed text-off-white/70">
      {feature.gebouwd ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon-indigo" aria-hidden />
      ) : (
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-off-white/30" aria-hidden />
      )}
      <span className={feature.gebouwd ? undefined : "text-off-white/50"}>
        {feature.tekst}
        {!feature.gebouwd && <ComingSoonBadge className="ml-1.5" />}
      </span>
    </li>
  );
}

function TierCard({ tier, uitgelicht }: { tier: (typeof TIERS)[number]; uitgelicht: boolean }) {
  const sopDekking = sopDekkingVoor(tier.licentie);
  return (
    <div
      className={`flex flex-col rounded-[6px] border p-6 ${
        uitgelicht
          ? "border-neon-indigo/50 bg-midnight-slate-raised"
          : "border-off-white/10 bg-midnight-slate-raised"
      }`}
      style={uitgelicht ? { boxShadow: "0 0 40px rgba(129, 140, 248, 0.15)" } : undefined}
    >
      {uitgelicht && (
        <span className="mb-3 w-fit rounded-[4px] bg-neon-indigo/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-neon-indigo">
          Most agencies start here
        </span>
      )}
      <h3 className="font-marketing-heading text-lg font-bold text-off-white">{tier.naam}</h3>
      <p className="mt-1 text-xs text-off-white/50">{tier.focus}</p>

      <div className="mt-4 flex items-baseline gap-1">
        {tier.vanafPerMaand === null ? (
          <span className="font-marketing-heading text-2xl font-extrabold text-off-white">Custom</span>
        ) : (
          <>
            <span className="font-marketing-heading text-2xl font-extrabold text-off-white">
              {"€"}{tier.vanafPerMaand.toLocaleString("en-US")}
            </span>
            <span className="text-xs text-off-white/50">/mo</span>
          </>
        )}
      </div>

      <div className="mt-4 space-y-1.5 border-y border-off-white/10 py-4 text-xs text-off-white/60">
        <div className="flex justify-between gap-2">
          <span>Compute credits/mo</span>
          <span className="shrink-0 text-off-white">{tier.creditsPerMaand.toLocaleString("en-US")}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Accounts on auto-SOPs</span>
          <span className="shrink-0 text-off-white">{Number.isFinite(sopDekking) ? sopDekking : "Unlimited"}</span>
        </div>
      </div>

      <ul className="mt-4 flex-1 space-y-2.5">
        {tier.features.map((f) => (
          <FeatureRow key={f.tekst} feature={f} />
        ))}
        {/* Was one <li> wrapping a <p> and a <FeatureRow> that renders its own <li> -- an <li>
            nested inside an <li>, invalid HTML the browser silently reparents, which produced a
            DOM shape different from what React rendered and threw a hydration error on every load
            (found via audit verification, 11 August 2026). Two siblings instead: the label keeps
            the border-t/pt-2.5 that visually separated this row, the feature row is its own <li>
            same as every other row above it. */}
        <li className="border-t border-off-white/10 pt-2.5 list-none">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-off-white/40">Reporting</p>
        </li>
        <FeatureRow feature={tier.rapportage} />
      </ul>

      <a
        href="/demo"
        className="mt-6 block rounded-[6px] border border-neon-indigo/40 px-4 py-2.5 text-center text-sm font-semibold text-neon-indigo transition-colors hover:bg-neon-indigo/10"
      >
        Request a demo
      </a>
    </div>
  );
}

export default function PricingPage() {
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
          Five tiers of decisioning, not five gates to a sales call. Every tier runs the full
          hypothesis loop, the difference is scale: how many accounts, how much compute, and how
          much control over what your client sees. Features marked <ComingSoonBadge /> are on the
          roadmap, not shipped yet.
        </p>
      </div>

      <div className="mt-10 flex items-center justify-center gap-3 rounded-[6px] border border-copper/30 bg-copper/5 px-6 py-4 text-sm text-off-white/80 sm:mt-14">
        <InfinityIcon className="h-5 w-5 shrink-0 text-copper" aria-hidden />
        <span>
          <strong className="font-semibold text-copper">No Limits:</strong> every plan scales with your
          accounts, without a new invoice opening for each extra client.
        </span>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {TIERS.map((tier) => (
          <TierCard key={tier.licentie} tier={tier} uitgelicht={tier.licentie === "growth"} />
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-off-white/50">
        Just want the dashboard and the forecast? Basis is free, unlimited accounts, no automatic
        SOP runs. Upgrade whenever you want the engine to start forming hypotheses on its own.
        Curious how this differs from a traditional dashboard tool?{" "}
        <Link href="/vs" className="font-semibold text-neon-indigo hover:underline">
          See the comparison
        </Link>.
      </p>

      <IntelligenceStore />
    </div>
  );
}
