"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/data-access/client-read";
import { CHART_CATEGORICAL } from "@/lib/branding/chart-colors";
import { DonutChart, type DonutSlice } from "./donut-chart";
import { useRememberedOpen, RegioToggle } from "@/components/ui/disclosure";
import { Legenda, type LegendaItem } from "./chart-chrome";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalRij, TotaalCel } from "./data-table";
import {
  buildAudienceSplit, findAudienceImbalances, audienceTotals, audienceTypeLabel,
  type AudienceRow, type AudienceSlice,
} from "@/lib/audience/audience-split";
import { Laadvlak } from "@/components/ui/laadvlak";

// Wie de campagnes bereiken, uitgesplitst naar het type doelgroepsignaal (affiniteit, in-market,
// remarketing, custom, vergelijkbaar). Zelfde behandeling als PmaxNetworkSplit: twee ringen naast
// elkaar (kosten versus conversies), want het kostenaandeel op zichzelf zegt weinig -- pas naast
// het conversie-aandeel wordt zichtbaar welk doelgroeptype zijn plek verdient.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const num = (v: number, d = 0) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: d }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));

/** Kleur volgt het doelgroeptype, niet zijn positie: filteren of herordenen mag niets omverkleuren. */
function colorFor(audienceType: string, order: string[]): string {
  const i = order.indexOf(audienceType);
  return CHART_CATEGORICAL[(i < 0 ? 0 : i) % CHART_CATEGORICAL.length];
}

export function AudienceSplit({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<AudienceRow[] | null>(null);
  const [tabelOpen, toggleTabel] = useRememberedOpen("audience-tabel", false);

  useEffect(() => {
    let cancelled = false;
    const sb = supabase;
    if (!sb) { setRows([]); return; }
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    dbSelect<Record<string, unknown>>("ads_audience_performance_monthly", {
      select: "audience_type, cost, conversions, conversions_value, impressions, clicks",
      clientId, filters: [{ op: "gte", column: "month", value: since }],
    }).then(({ data }) => {
      if (cancelled) return;
      setRows(data.map((r) => ({
        networkType: String(r.audience_type ?? "UNKNOWN"),
        cost: Number(r.cost ?? 0),
        conversions: Number(r.conversions ?? 0),
        conversionsValue: Number(r.conversions_value ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
      })));
    }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId]);

  const slices = useMemo(() => (rows ? buildAudienceSplit(rows, { labelOf: audienceTypeLabel }) : []), [rows]);
  const totals = useMemo(() => audienceTotals(slices), [slices]);
  const imbalances = useMemo(() => findAudienceImbalances(slices), [slices]);
  const order = useMemo(() => slices.map((s) => s.networkType), [slices]);

  const costSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.cost, color: colorFor(s.networkType, order) }));
  const convSlices: DonutSlice[] = slices.map((s) => ({ key: s.networkType, label: s.label, value: s.conversions, color: colorFor(s.networkType, order) }));

  if (rows === null) {
    return <Laadvlak vorm="grafiek" hoogte={200} titel="Doelgroepen — wie we bereiken" />;
  }
  if (slices.length === 0 || totals.cost <= 0) return null; // geen doelgroepdata: niets te tonen

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Users className="w-4.5 h-4.5 text-brand-blue-ink" />
        <h3 className="text-title font-semibold text-brand-gray">Doelgroepen — wie we bereiken</h3>
        <span className="text-meta text-muted-foreground">Kosten en conversies per type doelgroepsignaal</span>
      </div>

      {/* De scheefheid eerst: dat is waarom deze kaart bestaat. */}
      {imbalances.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-amber-50/50 space-y-1">
          {imbalances.slice(0, 2).map(({ slice, kind }) => (
            <p key={slice.networkType} className="text-body text-brand-gray">
              <strong>{slice.label}</strong>{" "}
              {kind === "duur" ? (
                <>krijgt {pct(slice.costShare)} van het budget maar levert {pct(slice.conversionShare)} van de conversies
                  {slice.cpa != null && <> (CPA {eur(slice.cpa)})</>}. Naar verhouding kost dit doelgroeptype meer dan het oplevert.</>
              ) : (
                <>krijgt {pct(slice.costShare)} van het budget en levert {pct(slice.conversionShare)} van de conversies
                  {slice.cpa != null && <> (CPA {eur(slice.cpa)})</>}. Dit doelgroeptype trekt de campagne.</>
              )}
            </p>
          ))}
        </div>
      )}

      <div className="px-3 py-5 @2xl:px-5">
        <div className="flex flex-wrap items-start justify-center gap-4 @2xl:gap-10">
          <figure className="flex flex-col items-center gap-2">
            <DonutChart
              slices={costSlices}
              centerValue={eur(totals.cost)}
              centerLabel="totale kosten"
              format={eur}
              ariaLabel={`Kostenverdeling over de doelgroeptypen: ${slices.map((s) => `${s.label} ${pct(s.costShare)}`).join(", ")}`}
            />
            <figcaption className="text-meta font-medium text-brand-gray">Kosten</figcaption>
          </figure>

          {totals.hasConversions && (
            <figure className="flex flex-col items-center gap-2">
              <DonutChart
                slices={convSlices}
                centerValue={num(totals.conversions, 1)}
                centerLabel="conversies"
                format={(v) => num(v, 1)}
                ariaLabel={`Conversieverdeling over de doelgroeptypen: ${slices.map((s) => `${s.label} ${pct(s.conversionShare)}`).join(", ")}`}
              />
              <figcaption className="text-meta font-medium text-brand-gray">Conversies</figcaption>
            </figure>
          )}
        </div>

        <Legenda
          items={slices.map((s) => ({ label: s.label, kleur: colorFor(s.networkType, order) })) as LegendaItem[]}
          className="justify-center mt-4"
        />

        {!totals.hasConversions && (
          <p className="text-meta text-muted-foreground text-center mt-3">
            Er zijn in dit venster geen conversies per doelgroeptype geregistreerd, dus alleen de kostenverdeling is te tonen.
          </p>
        )}
      </div>

      <RegioToggle
        open={tabelOpen}
        onToggle={toggleTabel}
        controls="audience-tabel"
        label={`de cijfers per doelgroeptype (${slices.length})`}
      />
      <div id="audience-tabel" hidden={!tabelOpen} className="border-t border-border">
        <Tabel>
          <Kop>
            <KolomKop>Doelgroeptype</KolomKop>
            <KolomKop getal>Kosten</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>Conversies</KolomKop>
            <KolomKop getal>Aandeel</KolomKop>
            <KolomKop getal>CPA</KolomKop>
          </Kop>
          <Body>
            {slices.map((s: AudienceSlice) => (
              <Rij key={s.networkType}>
                <NaamCel>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorFor(s.networkType, order) }} aria-hidden />
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
            <TotaalCel>Alle doelgroeptypen</TotaalCel>
            <TotaalCel getal>{eur(totals.cost)}</TotaalCel>
            <TotaalCel getal>100%</TotaalCel>
            <TotaalCel getal>{totals.hasConversions ? num(totals.conversions, 1) : "—"}</TotaalCel>
            <TotaalCel getal>{totals.hasConversions ? "100%" : "—"}</TotaalCel>
            <TotaalCel getal>{totals.conversions > 0 ? eur(totals.cost / totals.conversions) : "—"}</TotaalCel>
          </TotaalRij>
        </Tabel>
      </div>
    </div>
  );
}
