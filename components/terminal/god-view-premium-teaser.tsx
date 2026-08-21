"use client";

import { useEffect, useState } from "react";
import { Crown, Lock, TrendingUp } from "lucide-react";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel } from "@/components/dashboard/data-table";

// Upsell-teaser voor God View Premium (masterplan 17.65, tweede helft van "allebei" — de
// rol-teaser in god-view-teaser.tsx is het eerste deel). Anders dan die rol-teaser: dit bureau
// HEEFT platformtoegang (het is al bij AgencyGodView, performance_marketeer-rol), maar mist de
// licentietier die het cross-agency God View Premium/Tactical/Pulse-product ontgrendelt
// (lib/benchmark/god-view-tier.ts). Zelfde regel als de rol-teaser: fictieve, duidelijk
// gelabelde voorbeeldcijfers, nooit een echt-maar-vervaagd getal (screenshot-scherpmaak-risico),
// en components/terminal/god-view-premium.tsx zelf blijft platformbeheerder-only -- deze teaser
// is een nieuw, apart component, geen blur overheen de echte view.
//
// Toont zichzelf niet (return null) zolang de tier-check nog laadt of het bureau al Premium
// heeft: geen "upgrade"-banner voorschotelen aan wie al betaalt.

const VOORBEELD_SEGMENTEN = [
  { segment: "E-commerce · Fashion", mediaanCpa: 38, mediaanRoas: 3.4, bureaus: 11 },
  { segment: "B2B SaaS · Scale-up", mediaanCpa: 96, mediaanRoas: 2.7, bureaus: 6 },
  { segment: "Lokale dienstverlening", mediaanCpa: 24, mediaanRoas: 4.1, bureaus: 9 },
] as const;

const TIERS = [
  { naam: "Standard", prijs: 750, tagline: "Zie de markt", uitleg: "Benchmarks per sector/segment, trendlijnen, churn-risicosignalen." },
  { naam: "Tactical", prijs: 1250, tagline: "Handel ernaar", uitleg: "Dezelfde marktsignalen, omgezet naar geprioriteerde acties per klant." },
  { naam: "Pulse", prijs: 2500, tagline: "Wees vroeg", uitleg: "Marktverschuivingen zodra ze gebeuren, niet pas bij de maandelijkse benchmark." },
] as const;

export function GodViewPremiumTeaser() {
  const [hasPremium, setHasPremium] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agency/god-view-tier")
      .then((res) => res.json())
      .then((data: { hasPremium?: boolean }) => { if (!cancelled) setHasPremium(Boolean(data.hasPremium)); })
      .catch(() => { if (!cancelled) setHasPremium(true); }); // faal veilig dicht: bij twijfel geen upsell-ruis tonen
    return () => { cancelled = true; };
  }, []);

  if (hasPremium !== false) return null;

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Crown className="w-4.5 h-4.5 text-brand-blue-ink" />
        <div className="flex-1">
          <h2 className="text-title font-semibold text-brand-gray">God View Premium</h2>
          <p className="text-micro text-muted-foreground mt-0.5">
            Anonieme marktcijfers over alle aangesloten bureaus — waar jouw klanten écht staan.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-micro font-semibold text-brand-blue-ink bg-brand-blue/10 border border-brand-blue/20 rounded-full px-2.5 py-1 shrink-0">
          <TrendingUp className="w-3 h-3" /> Niet in je huidige pakket
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="relative">
          <div aria-hidden className="blur-[3px] select-none pointer-events-none opacity-70">
            <Tabel>
              <Kop>
                <KolomKop breed>Segment</KolomKop>
                <KolomKop getal>Mediane CPA</KolomKop>
                <KolomKop getal>Mediane ROAS</KolomKop>
                <KolomKop getal>Bureaus</KolomKop>
              </Kop>
              <Body>
                {VOORBEELD_SEGMENTEN.map((r) => (
                  <Rij key={r.segment}>
                    <NaamCel>{r.segment}</NaamCel>
                    <GetalCel>{r.mediaanCpa.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</GetalCel>
                    <GetalCel>{r.mediaanRoas.toFixed(2)}x</GetalCel>
                    <GetalCel>{r.bureaus}</GetalCel>
                  </Rij>
                ))}
              </Body>
            </Tabel>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-card border border-border shadow-sm flex items-center justify-center">
              <Lock className="w-4.5 h-4.5 text-muted-foreground" />
            </div>
            <p className="text-body font-semibold text-brand-gray">Voorbeeldcijfers — geen echte data</p>
            <p className="text-meta text-muted-foreground max-w-sm">
              Zo verhoudt het segment van je klant zich tot de rest van de markt — anoniem, per
              sector en niche. Dit is precies het gesprek dat &ldquo;waarom is de CPA gestegen&rdquo;
              laat beginnen bij waar de markt écht staat, niet bij een gok.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.naam} className="rounded-lg border border-border px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body font-semibold text-brand-gray">{t.naam}</span>
                <span className="text-meta font-medium text-muted-foreground">
                  €{t.prijs.toLocaleString("nl-NL")}/mnd
                </span>
              </div>
              <p className="text-meta font-medium text-brand-blue-ink mt-0.5">{t.tagline}</p>
              <p className="text-micro text-muted-foreground mt-1">{t.uitleg}</p>
            </div>
          ))}
        </div>

        <p className="text-meta text-muted-foreground">
          Vraag je bureau-eigenaar om te upgraden, of neem contact op met Ctrl PPC.
        </p>
      </div>
    </section>
  );
}
