"use client";

// Losgetrokken uit app/(marketing)/pricing/page.tsx (12 augustus 2026, mobiele audit): zes
// tier-kaarten voluit tonen maakte /pricing op mobiel een "mega lange scroll" (eigenaars woorden).
// Zelfde patroon als IntelligenceStore verderop op deze pagina: de eerste drie (Foundation, Core,
// Growth -- Growth is al de "Most agencies start here"-kaart) staan altijd open, Scale/Professional/
// Enterprise gaan achter een "Show all 6 tiers"-toggle. Niemand raakt een tier kwijt, de standaard-
// scroll op mobiel wordt ruwweg gehalveerd.

import { useState } from "react";
import { Check, ChevronDown, Clock, Gift } from "lucide-react";
import { sopDekkingVoor, type TierDefinitie, type TierFeature } from "@/lib/marketing/tiers";
import { ComingSoonBadge } from "./coming-soon-badge";

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

function TierCard({
  tier,
  uitgelicht,
  foundationOpen,
}: {
  tier: TierDefinitie;
  uitgelicht: boolean;
  /** Alleen relevant voor de Foundation-kaart (licentie "basis"); zie foundation-cap.ts. */
  foundationOpen?: boolean;
}) {
  const sopDekking = sopDekkingVoor(tier.licentie);
  const isFoundation = tier.licentie === "basis";
  return (
    <div
      className={`relative flex flex-col rounded-[6px] border p-6 ${
        uitgelicht
          ? "border-neon-indigo/50 bg-midnight-slate-raised"
          : "border-off-white/10 bg-midnight-slate-raised"
      }`}
      style={uitgelicht ? { boxShadow: "0 0 40px rgba(129, 140, 248, 0.15)" } : undefined}
    >
      {/* Absoluut gepositioneerd (12 augustus 2026, design feedback): stond eerst in de gewone
          flow (mb-3 boven de titel), waardoor alleen deze kaart extra hoogte kreeg en de rest van
          de content -- titel, prijs, features -- lager begon dan op de buurkaarten. Zwevend boven
          de kaartrand houdt elke kaart intern op dezelfde starthoogte, ongeacht welke uitgelicht is. */}
      {uitgelicht && (
        <span className="absolute -top-3 left-6 rounded-[4px] border border-neon-indigo/40 bg-midnight-slate-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-neon-indigo">
          Most agencies start here
        </span>
      )}
      {/* Losse badge (12 augustus 2026, na "waar staat dat het tijdelijk is?"): de kleine tekst
          onder de CTA-knop hieronder was blijkbaar niet opvallend genoeg om als "dit is een
          launch-only regel" te lezen. Copper i.p.v. indigo -- ander signaal dan "aanbevolen",
          zelfde token als de "No Limits"-band verderop op deze pagina. */}
      {isFoundation && foundationOpen !== false && (
        <span className="absolute -top-3 left-6 rounded-[4px] border border-copper/40 bg-midnight-slate-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-copper">
          Launch cap: 50 at a time
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

      {/* Coupon-kaartje (12 augustus 2026, derde versie): stond eerst boven de tier-grid, toen
          vastgeplakt op de bovenrand van elke kaart -- daar botste hij op Growth met "Most agencies
          start here" en gaf het bovenaan "veel drukte" (eigenaars woorden). Onderin, vlak boven de
          CTA, is er geen andere badge om mee te botsen en blijft het gestippelde/gedraaide
          coupon-gevoel overeind zonder het kaartrand-overlap-risico van de vorige versie. */}
      {!isFoundation && (
        <div className="mx-auto mt-4 flex w-fit -rotate-1 items-center gap-1.5 rounded-[4px] border border-dashed border-neon-indigo/50 bg-neon-indigo/5 px-2.5 py-1.5 text-[11px] font-semibold text-neon-indigo">
          <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden />
          +5 free Second Opinions
        </div>
      )}

      <a
        href="/demo"
        className="mt-6 block rounded-[6px] border border-neon-indigo/40 px-4 py-2.5 text-center text-sm font-semibold text-neon-indigo transition-colors hover:bg-neon-indigo/10"
      >
        {isFoundation && foundationOpen === false ? "Join the waitlist" : "Request a demo"}
      </a>
      {/* Geen live aantal ("X van de 50") -- zie foundation-cap.ts voor waarom. Alleen de twee
          statussen die geen bijwerking nodig hebben om waar te blijven. */}
      {isFoundation && (
        <p className="mt-2 text-center text-[11px] text-off-white/40">
          {foundationOpen === false
            ? "Full for now - not a one-time cutoff. A slot opens up whenever an existing Foundation account upgrades, or we raise the cap."
            : "Up to 50 Foundation accounts at a time while we scale our own API usage deliberately - not a one-time first-come-first-served batch."}
        </p>
      )}
    </div>
  );
}

const ALTIJD_ZICHTBAAR = 3;

export function TierGrid({ tiers, foundationOpen }: { tiers: readonly TierDefinitie[]; foundationOpen: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const zichtbaar = tiers.slice(0, ALTIJD_ZICHTBAAR);
  const inklapbaar = tiers.slice(ALTIJD_ZICHTBAAR);

  return (
    <>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {zichtbaar.map((tier) => (
          <TierCard
            key={tier.licentie}
            tier={tier}
            uitgelicht={tier.licentie === "growth"}
            foundationOpen={tier.licentie === "basis" ? foundationOpen : undefined}
          />
        ))}
      </div>

      {showAll && (
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {inklapbaar.map((tier) => (
            <TierCard key={tier.licentie} tier={tier} uitgelicht={false} />
          ))}
        </div>
      )}

      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mx-auto flex items-center gap-1.5 rounded-[6px] border border-off-white/15 px-4 py-2.5 text-xs font-semibold text-off-white/70 transition-colors hover:border-neon-indigo hover:text-neon-indigo"
        >
          {showAll ? "Show fewer tiers" : `Show all ${tiers.length} tiers`}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
    </>
  );
}
