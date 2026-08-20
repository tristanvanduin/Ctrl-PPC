"use client";

import { Building2, Lock, Sparkles } from "lucide-react";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel } from "@/components/dashboard/data-table";

// Feedback: "tease god mode" -- voor bureaus zonder platformtoegang (dus precies de gebruikers
// die deze pagina, TodayFeed, te zien krijgen: app/(app)/vandaag/page.tsx routeert alleen hierheen
// als de scope niet ALL_CLIENTS is en de rol niet performance_marketeer). Doel is laten zien wát
// er ontgrendelt bij platformtoegang, niet een echt-maar-vervaagd getal tonen -- dat is met een
// screenshot-scherpmaak-truc te reconstrueren. Daarom: fictieve, duidelijk als voorbeeld gelabelde
// cijfers, in exact dezelfde tabelvorm als AgencyGodView's "Portfolio per segment"
// (components/terminal/agency-god-view.tsx) zodat het geen nieuw ontwerp is maar een voorproefje
// van een bestaand scherm.

const VOORBEELD_RIJEN = [
  { segment: "E-commerce · Fashion", kanaal: "Google Ads", accounts: 12, spend: 184000, conversions: 3120 },
  { segment: "B2B SaaS · Scale-up", kanaal: "LinkedIn", accounts: 7, spend: 96500, conversions: 410 },
  { segment: "Lokale dienstverlening", kanaal: "Meta", accounts: 9, spend: 52300, conversions: 1875 },
] as const;

export function GodViewTeaser() {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Building2 className="w-4.5 h-4.5 text-brand-blue-ink" />
        <div className="flex-1">
          <h2 className="text-title font-semibold text-brand-gray">Portfolio per segment</h2>
          <p className="text-micro text-muted-foreground mt-0.5">
            Zo ziet Agency God View eruit — je eigen klanten gebundeld per bedrijfsmodel en niche.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-micro font-semibold text-brand-blue-ink bg-brand-blue/10 border border-brand-blue/20 rounded-full px-2.5 py-1 shrink-0">
          <Sparkles className="w-3 h-3" /> Niet actief voor jouw account
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="relative">
          <div aria-hidden className="blur-[3px] select-none pointer-events-none opacity-70">
            <Tabel>
              <Kop>
                <KolomKop breed>Segment</KolomKop>
                <KolomKop>Kanaal</KolomKop>
                <KolomKop getal>Accounts</KolomKop>
                <KolomKop getal>Spend</KolomKop>
                <KolomKop getal>Conversies</KolomKop>
              </Kop>
              <Body>
                {VOORBEELD_RIJEN.map((r) => (
                  <Rij key={r.segment}>
                    <NaamCel>{r.segment}</NaamCel>
                    <Cel nowrap zacht>{r.kanaal}</Cel>
                    <GetalCel>{r.accounts}</GetalCel>
                    <GetalCel>{r.spend.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</GetalCel>
                    <GetalCel>{r.conversions.toLocaleString("nl-NL")}</GetalCel>
                  </Rij>
                ))}
              </Body>
            </Tabel>
          </div>

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-card border border-border shadow-sm flex items-center justify-center">
              <Lock className="w-4.5 h-4.5 text-muted-foreground" />
            </div>
            <p className="text-body font-semibold text-brand-gray">
              Voorbeeldcijfers — geen echte data
            </p>
            <p className="text-meta text-muted-foreground max-w-sm">
              Agency God View bundelt je hele portfolio per segment en signaleert wanneer een heel
              segment beweegt, niet alleen één account. Vraag je bureau-eigenaar om platformtoegang.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
