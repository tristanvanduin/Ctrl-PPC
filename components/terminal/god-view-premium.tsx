"use client";

import { useEffect, useState } from "react";
import { Gem, ShieldAlert, ShieldQuestion, TrendingUp, AlertTriangle, Loader2 } from "lucide-react";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel } from "@/components/dashboard/data-table";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_GOD_VIEW_CELLEN, DEMO_GOD_VIEW_CHURN_CELLEN } from "@/lib/demo/god-view-demo";

// ============================================================================
// GOD VIEW PREMIUM: cross-agency benchmark + churn-concentratie
// ============================================================================
//
// Dit is het gemarkete "God View" (lib/marketing/modules.ts, tot nu toe gebouwd:false) --
// NIET te verwarren met God Mode hierboven (eigen platform, ongeanonimiseerd, alle klantnamen
// zichtbaar) of Agency God View (eigen bureau, ook ongeanonimiseerd). Dit hier is het stuk waarbij
// de identiteit van individuele bureaus/accounts NOOIT zichtbaar mag zijn -- alleen mediane
// cijfers en tellingen per segment, en alleen als het segment k-anoniem genoeg is
// (lib/benchmark/cel.ts).
//
// Met 2 echte bureaus in productie haalt geen enkele cel de echte drempel (4 bureaus) -- dat is
// geen bug, dat is precies waar de regel voor bestaat. Om dit tijdens de bouw- en stijlfase toch
// zichtbaar te maken is er GEEN fictieve bureau-data in de database gezet (dat zou de
// vertrouwensdoctrine van dit dashboard breken -- nergens gefabriceerde cijfers als echt
// presenteren). In plaats daarvan: de testdrempel die al bestond (lib/benchmark/cel.ts's
// TEST_DREMPELS, expliciet goedgekeurd door de eigenaar op 17 augustus 2026: "anonimiteit in de
// testfase boeit me niet") -- ECHTE data, verlaagde drempel, altijd zichtbaar gelabeld als
// TESTMODUS zodat niemand dit ooit voor een echte, k-anonieme uitkomst aanziet.

interface RatioCel {
  model: string | null;
  niche: string | null;
  nicheLabel: string | null;
  accounts: number;
  bureaus: number;
  metrics: { medianCpa: number | null; medianRoas: number | null; accountsMetCpa: number; accountsMetRoas: number } | null;
}

interface ChurnCel {
  model: string | null;
  niche: string | null;
  nicheLabel: string | null;
  accounts: number;
  bureaus: number;
  churn: { rood: number; amber: number; groen: number; onbekend: number } | null;
}

interface Stand {
  bureausMetKwalificerendeData: number;
  bureausNodigVoorEersteCel: number;
  accountsNodigVoorEersteCel: number;
  accountsMetAfbakening: number;
  cellenTotaal: number;
  cellenDeelbaar: number;
}

interface Antwoord<C> {
  testMode: boolean;
  testModeWaarschuwing: string | null;
  stand: Stand;
  cellen: C[];
}

function segmentTekst(model: string | null, niche: string | null, nicheLabel: string | null): string {
  const modelLabel = model === "b2b" ? "B2B" : model === "b2c" ? "B2C" : null;
  if (modelLabel && niche) return `${modelLabel} · ${nicheLabel ?? niche}`;
  if (modelLabel) return modelLabel;
  return nicheLabel ?? niche ?? "—";
}

function currency(v: number): string {
  return v.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export function GodViewPremium() {
  const [ratio, setRatio] = useState<Antwoord<RatioCel> | null | undefined>(undefined);
  const [churn, setChurn] = useState<Antwoord<ChurnCel> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemoMode()) {
      setRatio(DEMO_GOD_VIEW_CELLEN);
      setChurn(DEMO_GOD_VIEW_CHURN_CELLEN);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch("/api/platform/god-view?testdrempel=true").then((r) => r.json()),
      fetch("/api/platform/god-view-churn?testdrempel=true").then((r) => r.json()),
    ])
      .then(([r, c]) => {
        if (cancelled) return;
        if (r?.error || c?.error) { setError(r?.error ?? c?.error); return; }
        setRatio(r as Antwoord<RatioCel>);
        setChurn(c as Antwoord<ChurnCel>);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (ratio === undefined || churn === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-blue-ink" />
      </div>
    );
  }
  if (!ratio || !churn) return null;

  const deelbareRatioCellen = ratio.cellen.filter((c) => c.metrics !== null).sort((a, b) => b.accounts - a.accounts);
  const deelbareChurnCellen = churn.cellen.filter((c) => c.churn !== null && (c.churn.rood + c.churn.amber) > 0);
  const nietDeelbaar = ratio.stand.cellenTotaal === 0;

  return (
    <div className="space-y-5 rounded-2xl border-2 border-indigo-300/50 bg-card p-6 shadow-md relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500" />
      <div className="flex flex-wrap items-center gap-2">
        <Gem className="h-5 w-5 text-indigo-600" />
        <h2 className="text-title font-bold text-brand-gray">God View</h2>
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-white">Premium</span>
        <span className="ml-auto text-meta text-muted-foreground">Voor C-level &amp; sales — niet alleen marketing</span>
      </div>
      <p className="text-meta text-muted-foreground leading-relaxed">
        Hoe presteert een account t.o.v. vergelijkbare accounts bij ANDERE bureaus, en waar in het
        platform is churnrisico geconcentreerd? Altijd geaggregeerd en anoniem — nooit een
        individueel bureau of account herleidbaar, gewaarborgd door {ratio.stand.bureausNodigVoorEersteCel === 1 ? "de testdrempel hieronder" : "een harde k-anonimiteitsdrempel"}.
      </p>

      {(ratio.testMode || churn.testMode) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-meta text-amber-900">
            <p className="font-semibold">{ratio.testModeWaarschuwing ?? churn.testModeWaarschuwing}</p>
            <p className="mt-0.5 text-amber-800">
              {ratio.stand.bureausMetKwalificerendeData} bureau{ratio.stand.bureausMetKwalificerendeData === 1 ? "" : "s"} met kwalificerende data ·
              {" "}nodig voor een echte cel: {ratio.stand.bureausNodigVoorEersteCel === 1 ? "MIN_BUREAUS uit cel.ts" : `${ratio.stand.bureausNodigVoorEersteCel} bureaus`}.
              {" "}Zodra dat aantal groeit, verschijnen dezelfde cellen ook zonder testdrempel.
            </p>
          </div>
        </div>
      )}

      {nietDeelbaar ? (
        <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-body text-muted-foreground">
          Nog geen enkele cel — geen enkel account (van een opt-in-bureau) heeft zowel een
          bedrijfsmodel/niche als spend deze maand.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-300" />
              <h3 className="text-body font-semibold text-white">Hoe verhoud je je tot andere bureaus</h3>
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/40">
              <Tabel>
                <Kop>
                  <KolomKop breed>Segment</KolomKop>
                  <KolomKop getal>Accounts</KolomKop>
                  <KolomKop getal>Bureaus</KolomKop>
                  <KolomKop getal>Mediane CPA</KolomKop>
                  <KolomKop getal>Mediane ROAS</KolomKop>
                </Kop>
                <Body>
                  {deelbareRatioCellen.slice(0, 12).map((c, i) => (
                    <Rij key={i}>
                      <NaamCel>{segmentTekst(c.model, c.niche, c.nicheLabel)}</NaamCel>
                      <GetalCel>{c.accounts}</GetalCel>
                      <GetalCel>{c.bureaus}</GetalCel>
                      <GetalCel>{c.metrics?.medianCpa != null ? currency(c.metrics.medianCpa) : "—"}</GetalCel>
                      <GetalCel>{c.metrics?.medianRoas != null ? `${c.metrics.medianRoas.toFixed(2)}x` : "—"}</GetalCel>
                    </Rij>
                  ))}
                  {deelbareRatioCellen.length === 0 && (
                    <Rij><Cel>Nog geen deelbare cel — te weinig accounts/bureaus per segment, ook in testmodus.</Cel></Rij>
                  )}
                </Body>
              </Tabel>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-300" />
              <h3 className="text-body font-semibold text-white">Churn-concentratie per branche</h3>
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/40">
              <Tabel>
                <Kop>
                  <KolomKop breed>Segment</KolomKop>
                  <KolomKop getal>Accounts</KolomKop>
                  <KolomKop getal>Rood</KolomKop>
                  <KolomKop getal>Amber</KolomKop>
                  <KolomKop getal>Groen</KolomKop>
                </Kop>
                <Body>
                  {deelbareChurnCellen.slice(0, 12).map((c, i) => (
                    <Rij key={i}>
                      <NaamCel>{segmentTekst(c.model, c.niche, c.nicheLabel)}</NaamCel>
                      <GetalCel>{c.accounts}</GetalCel>
                      <GetalCel><span className={c.churn!.rood > 0 ? "font-semibold text-red-400" : ""}>{c.churn!.rood}</span></GetalCel>
                      <GetalCel><span className={c.churn!.amber > 0 ? "font-semibold text-amber-400" : ""}>{c.churn!.amber}</span></GetalCel>
                      <GetalCel>{c.churn!.groen}</GetalCel>
                    </Rij>
                  ))}
                  {deelbareChurnCellen.length === 0 && (
                    <Rij><Cel>Geen segment met rood/amber-concentratie — of nog geen deelbare cel.</Cel></Rij>
                  )}
                </Body>
              </Tabel>
            </div>
            {churn.cellen.some((c) => c.churn === null) && (
              <p className="mt-1.5 flex items-center gap-1 text-micro text-indigo-200/60">
                <ShieldQuestion className="h-3 w-3" /> Segmenten onder de drempel tonen bewust geen telling.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
