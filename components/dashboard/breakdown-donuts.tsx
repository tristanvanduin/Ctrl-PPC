"use client";

import { useEffect, useMemo, useState } from "react";
import { PieChart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { DonutChart, type DonutSlice } from "./donut-chart";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { buildNetworkSplit, findImbalances, networkTotals, type NetworkRow } from "@/lib/pmax/network-split";
import { BREAKDOWN_DIMENSIES, metaWaardeLabel, type BreakdownKanaal } from "@/lib/analysis/breakdown-dimensions";
import { Legenda, type LegendaItem } from "./chart-chrome";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";

// Waar het budget van Meta en LinkedIn landt, per uitsplitsing.
//
// Google had deze weergave wel (de PMax-ringen) en de andere twee kanalen niet, terwijl de data
// er al lag: meta_breakdown_daily en linkedin_demographic_daily werden gesynct maar bereikten
// alleen de signaal-detectors op het analysetabblad. Wie op het Meta-tabblad keek zag campagnes
// en verder niets — geen antwoord op "waar zit mijn geld".
//
// Twee ringen naast elkaar, net als bij PMax: het kostenaandeel op zichzelf zegt weinig. Pas
// naast het conversie-aandeel wordt zichtbaar of een segment zijn plek verdient. De rekenkern is
// dezelfde als die van de PMax-ringen — dat is geen toeval maar dezelfde vraag over een andere
// dimensie, en dus dezelfde functie.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));

type Kanaal = BreakdownKanaal;

interface Segment { dimensie: string; waarde: string; label: string; spend: number; conversies: number; impressies: number; klikken: number }

export function BreakdownDonuts({ clientId, channel }: { clientId: string; channel: Kanaal }) {
  const [segmenten, setSegmenten] = useState<Segment[] | null>(null);
  const [dimensie, setDimensie] = useState<string | null>(null);
  const [tabelOpen, toggleTabel] = useRememberedOpen(`breakdown-tabel-${channel}`, false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setSegmenten([]); return; }
    let cancelled = false;
    setSegmenten(null); setDimensie(null);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

    async function laad() {
      const opgeteld = new Map<string, Segment>();
      const tel = (dimensie: string, waarde: string, label: string, spend: number, conversies: number, impressies: number, klikken: number) => {
        const sleutel = `${dimensie}|${waarde}`;
        const a = opgeteld.get(sleutel) ?? { dimensie, waarde, label, spend: 0, conversies: 0, impressies: 0, klikken: 0 };
        a.spend += spend; a.conversies += conversies; a.impressies += impressies; a.klikken += klikken;
        opgeteld.set(sleutel, a);
      };

      if (channel === "meta") {
        const { data } = await sb!.from("meta_breakdown_daily")
          .select("breakdown_type, breakdown_value, spend, conversions, impressions, link_clicks")
          .eq("client_id", clientId).gte("date", since);
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const waarde = String(r.breakdown_value ?? "");
          if (!waarde) continue;
          tel(String(r.breakdown_type ?? ""), waarde, metaWaardeLabel(waarde),
            Number(r.spend ?? 0), Number(r.conversions ?? 0), Number(r.impressions ?? 0), Number(r.link_clicks ?? 0));
        }
      } else {
        // De pivot-waarden zijn URN's; de leesbare naam staat in een aparte labeltabel. Zonder die
        // vertaling staat er "urn:li:function:8" in de legenda.
        const [{ data: rijen }, { data: labels }] = await Promise.all([
          sb!.from("linkedin_demographic_daily")
            .select("pivot_type, pivot_value_urn, spend, leads, impressions, clicks")
            .eq("client_id", clientId).gte("date", since),
          sb!.from("linkedin_urn_labels").select("urn, label"),
        ]);
        const naam = new Map((labels ?? []).map((l: Record<string, unknown>) => [String(l.urn), String(l.label ?? l.urn)]));
        for (const r of (rijen ?? []) as Record<string, unknown>[]) {
          const urn = String(r.pivot_value_urn ?? "");
          if (!urn) continue;
          tel(String(r.pivot_type ?? ""), urn, naam.get(urn) ?? urn,
            Number(r.spend ?? 0), Number(r.leads ?? 0), Number(r.impressions ?? 0), Number(r.clicks ?? 0));
        }
      }
      if (!cancelled) setSegmenten([...opgeteld.values()]);
    }

    laad().catch(() => { if (!cancelled) setSegmenten([]); });
    return () => { cancelled = true; };
  }, [clientId, channel]);

  // Alleen dimensies waar daadwerkelijk iets in zit. Een lege keuzeknop belooft data die er niet is.
  const beschikbaar = useMemo(() => {
    if (!segmenten) return [];
    const metData = new Set(segmenten.filter((s) => s.spend > 0 || s.impressies > 0).map((s) => s.dimensie));
    return BREAKDOWN_DIMENSIES[channel].filter((d) => metData.has(d.key));
  }, [segmenten, channel]);

  const actief = dimensie ?? beschikbaar[0]?.key ?? null;

  const { slices, totalen, scheefheid, kleur } = useMemo(() => {
    const vanDimensie = (segmenten ?? []).filter((s) => s.dimensie === actief);
    const rijen: NetworkRow[] = vanDimensie.map((s) => ({
      networkType: s.waarde, cost: s.spend, conversions: s.conversies,
      conversionsValue: 0, impressions: s.impressies, clicks: s.klikken,
    }));
    const naam = new Map(vanDimensie.map((s) => [s.waarde, s.label]));
    // De sleutel niet normaliseren: bij Meta zijn de waarden al kleingeschreven enums en bij
    // LinkedIn zijn het URN's, waar hoofdletters betekenis hebben.
    const gesplitst = buildNetworkSplit(rijen, { labelOf: (k) => naam.get(k) ?? k, normalizeKey: (k) => k });
    const volgorde = gesplitst.map((s) => s.networkType);
    const kleur = (k: string) => CHART_CATEGORICAL[Math.max(0, volgorde.indexOf(k)) % CHART_CATEGORICAL.length];
    return { slices: gesplitst, totalen: networkTotals(gesplitst), scheefheid: findImbalances(gesplitst), kleur };
  }, [segmenten, actief]);

  if (segmenten === null) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel="Waar gaat het budget heen" />;
  }
  // Geen uitsplitsingen gesynct: niets tonen in plaats van een lege ring.
  if (beschikbaar.length === 0 || slices.length === 0) return null;

  const conversieWoord = channel === "linkedin" ? "leads" : "conversies";
  const kostenSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.cost, color: kleur(s.networkType) }));
  const convSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.conversions, color: kleur(s.networkType) }));

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <PieChart className="w-4.5 h-4.5 text-rm-blue-ink" />
        <h3 className="text-sm font-semibold text-rm-gray">Waar gaat het budget heen</h3>
        <span className="text-meta text-muted-foreground">laatste 60 dagen</span>
        <div className="ml-auto flex gap-1 bg-gray-100 rounded-lg p-0.5 flex-wrap">
          {beschikbaar.map((d) => (
            <button
              key={d.key}
              onClick={() => setDimensie(d.key)}
              className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                actief === d.key ? "bg-rm-blue text-white" : "text-muted-foreground hover:text-rm-blue-ink"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* De scheefheid eerst: dat is waarom deze kaart bestaat. */}
      {scheefheid.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-amber-50/50 space-y-1">
          {scheefheid.slice(0, 2).map(({ slice, kind }) => (
            <p key={slice.networkType} className="text-body text-rm-gray">
              <strong>{slice.label}</strong>{" "}
              {kind === "duur" ? (
                <>krijgt {pct(slice.costShare)} van het budget maar levert {pct(slice.conversionShare)} van de {conversieWoord}
                  {slice.cpa != null && <> (kosten per {conversieWoord === "leads" ? "lead" : "conversie"} {eur(slice.cpa)})</>}.
                  Naar verhouding kost dit segment meer dan het oplevert.</>
              ) : (
                <>krijgt {pct(slice.costShare)} van het budget en levert {pct(slice.conversionShare)} van de {conversieWoord}
                  {slice.cpa != null && <> (kosten per {conversieWoord === "leads" ? "lead" : "conversie"} {eur(slice.cpa)})</>}.
                  Dit segment trekt het account.</>
              )}
            </p>
          ))}
        </div>
      )}

      <div className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-center gap-10">
          <figure className="flex flex-col items-center gap-2">
            <DonutChart
              slices={kostenSlices}
              centerValue={eur(totalen.cost)}
              centerLabel="totale spend"
              format={eur}
              ariaLabel={`Kostenverdeling: ${slices.map((s) => `${s.label} ${pct(s.costShare)}`).join(", ")}`}
            />
            <figcaption className="text-meta font-medium text-rm-gray">Spend</figcaption>
          </figure>

          {totalen.hasConversions && (
            <figure className="flex flex-col items-center gap-2">
              <DonutChart
                slices={convSlices}
                centerValue={num(totalen.conversions, 1)}
                centerLabel={conversieWoord}
                format={(v) => num(v, 1)}
                ariaLabel={`Verdeling van de ${conversieWoord}: ${slices.map((s) => `${s.label} ${pct(s.conversionShare)}`).join(", ")}`}
              />
              <figcaption className="text-meta font-medium text-rm-gray">{conversieWoord === "leads" ? "Leads" : "Conversies"}</figcaption>
            </figure>
          )}
        </div>

        <Legenda
          items={slices.map((s) => ({ label: s.label, kleur: kleur(s.networkType) })) as LegendaItem[]}
          className="justify-center mt-4"
        />

        {!totalen.hasConversions && (
          <p className="text-meta text-muted-foreground text-center mt-3">
            Er zijn in dit venster geen {conversieWoord} per segment geregistreerd, dus alleen de kostenverdeling is te tonen.
          </p>
        )}
      </div>

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls={`breakdown-tabel-${channel}`}
        label={`de cijfers per segment (${slices.length})`}
      />
      <div id={`breakdown-tabel-${channel}`} hidden={!tabelOpen} className="border-t border-border">
        <Tabel>
          <Kop>
            <KolomKop>Segment</KolomKop>
            <KolomKop getal>Spend</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>{conversieWoord === "leads" ? "Leads" : "Conversies"}</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>{conversieWoord === "leads" ? "CPL" : "CPA"}</KolomKop>
          </Kop>
          <Body>
            {slices.map((s) => (
              <Rij key={s.networkType}>
                <NaamCel>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: kleur(s.networkType) }} aria-hidden />
                    {s.label}
                  </span>
                </NaamCel>
                <GetalCel>{eur(s.cost)}</GetalCel>
                <GetalCel zacht>{pct(s.costShare)}</GetalCel>
                <GetalCel>{s.conversions > 0 ? num(s.conversions, 1) : "—"}</GetalCel>
                <GetalCel zacht>{pct(s.conversionShare)}</GetalCel>
                <GetalCel zacht>{s.cpa == null ? "—" : eur(s.cpa)}</GetalCel>
              </Rij>
            ))}
          </Body>
          <TotaalRij>
            <TotaalCel>Alle segmenten</TotaalCel>
            <TotaalCel getal>{eur(totalen.cost)}</TotaalCel>
            <TotaalCel getal>100%</TotaalCel>
            <TotaalCel getal>{totalen.hasConversions ? num(totalen.conversions, 1) : "—"}</TotaalCel>
            <TotaalCel getal>{totalen.hasConversions ? "100%" : "—"}</TotaalCel>
            <TotaalCel getal>{totalen.conversions > 0 ? eur(totalen.cost / totalen.conversions) : "—"}</TotaalCel>
          </TotaalRij>
        </Tabel>
      </div>
    </div>
  );
}
