"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, MapPin, Info, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { aggregateCampaignMonthlyByGeoClone, type CampaignMonthlyRow } from "@/lib/rai/geo-clone-aggregate";
import { RAI_GEO_CLONES } from "@/lib/rai/geo-clone-catalog";
import { SignalAnalysisCard } from "./signal-analysis-card";
import { MonthlyTrendChart } from "./monthly-trend-chart";
import { maandLabel } from "./chart-chrome";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { formatRoas } from "@/lib/forecast-format";
import { Kerncijfer } from "@/components/ui/kerncijfer";

// Fase 1c: account-brede kaarten kunnen niet per geo-clone gesplitst worden (de account-tabel
// draagt geen campagnenaam). Daarom her-aggregeren we de KPI's PER geo-clone uit
// ads_campaign_monthly (die wél campaign_name draagt) en tonen we dat overzicht zodra een beurs
// gekozen is. Ratio's komen uit de maandtotalen — nooit uit gemiddelde deelwaarden.

function fmt(n: number | null, opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0, ...opts }).format(n);
}
function fmtEur(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
function fmtPct(ratio: number | null): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 2 }).format(ratio);
}

function Kpi({ label, value }: { label: string; value: string }) {
  // Het omhulsel blijft lokaal (deze cijfers staan in eigen kaartjes naast elkaar), het cijfer
  // zelf komt uit de gedeelde tegel — anders staat hetzelfde soort getal hier weer een maat
  // kleiner dan in de band bovenaan de pagina.
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 h-full">
      <Kerncijfer label={label} waarde={value} formaat="compact" />
    </div>
  );
}

export function GeoCloneOverview({ clientId, geoClone }: { clientId: string; geoClone: string }) {
  const [rows, setRows] = useState<CampaignMonthlyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const variant = useMemo(() => RAI_GEO_CLONES.find((v) => v.abbreviation === geoClone) ?? null, [geoClone]);
  const label = variant ? `${variant.brand} ${variant.location}` : geoClone;

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setRows(null); setError(null);
    sb.from("ads_campaign_monthly")
      .select("campaign_name, month, impressions, clicks, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .order("month", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setRows((data ?? []) as CampaignMonthlyRow[]);
      });
    return () => { cancelled = true; };
  }, [clientId]);

  const summary = useMemo(() => (rows ? aggregateCampaignMonthlyByGeoClone(rows, geoClone) : null), [rows, geoClone]);
  // Focus op het advertentievenster: de recente maanden richting de beurs, niet de hele historie.
  const RECENT_MONTHS = 6;
  const recentMonths = useMemo(() => (summary ? summary.months.slice(-RECENT_MONTHS) : []), [summary]);
  const monthsDesc = useMemo(() => [...recentMonths].reverse(), [recentMonths]);

  return (
    <div className="space-y-6">
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <MapPin className="w-5 h-5 text-rm-blue-ink" />
        <h3 className="text-title font-semibold text-rm-gray">{label} — beursoverzicht</h3>
        <span className="text-meta text-muted-foreground">({geoClone})</span>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-meta text-blue-800 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Deze cijfers zijn <strong>her-geaggregeerd per beurs</strong> uit de campagnedata (op basis van de
            afkorting <strong>{geoClone}</strong> in de campagnenaam). Ratio&apos;s (CPA, ROAS, CTR) komen uit de
            maandtotalen, niet uit een gemiddelde van deelwaarden.
          </span>
        </div>

        {rows === null && !error && (
          <div className="flex items-center gap-2 text-body text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Laden...
          </div>
        )}
        {error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>
        )}
        {summary && summary.months.length === 0 && !error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
            Nog geen campagnedata voor <strong>{label}</strong> ({geoClone}). Zodra er campagnes met deze afkorting
            gesynct zijn, verschijnt hier het beursoverzicht.
          </div>
        )}

        {summary && summary.months.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Kpi label="Spend" value={fmtEur(summary.totals.cost)} />
              <Kpi label="Conversies" value={fmt(summary.totals.conversions, { maximumFractionDigits: 1 })} />
              <Kpi label="Conv.waarde" value={fmtEur(summary.totals.conversionsValue)} />
              <Kpi label="CPA" value={fmtEur(summary.totals.cpa)} />
              <Kpi label="ROAS" value={summary.totals.roas === null ? "—" : formatRoas(summary.totals.roas)} />
              <Kpi label="CTR" value={fmtPct(summary.totals.ctr)} />
            </div>

            <div className="text-meta text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              {summary.campaignCount} campagne{summary.campaignCount === 1 ? "" : "s"} · laatste {recentMonths.length} maand
              {recentMonths.length === 1 ? "" : "en"} getoond (van {summary.months.length}).
            </div>

            <MonthlyTrendChart
              title="Maandverloop (laatste maanden richting de beurs)"
              lineLabel="Conversies"
              data={recentMonths.map((m) => ({ maand: m.month.slice(0, 7), spend: m.cost, lijn: m.conversions }))}
            />

            {(() => {
              // Tegen de duurste maand en niet tegen de som: bij twaalf maanden is elk
              // aandeel-van-het-totaal klein en zijn alle streepjes even kort.
              const duursteMaand = Math.max(0, ...monthsDesc.map((m) => m.cost));
              // De som gaat over de zichtbare maanden en niet over `summary.totals`. Die laatste
              // telt alle 25 maanden op, en dan staat er € 190.021 onder zes regels van elk zo'n
              // € 8.000 — een totaal dat niet klopt met wat je ziet is erger dan geen totaal.
              const zichtbaar = monthsDesc.reduce(
                (t, m) => ({
                  impressions: t.impressions + m.impressions,
                  clicks: t.clicks + m.clicks,
                  cost: t.cost + m.cost,
                  conversions: t.conversions + m.conversions,
                  conversionsValue: t.conversionsValue + m.conversionsValue,
                }),
                { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 },
              );
              return (
                <Tabel>
                  <Kop>
                    <KolomKop>Maand</KolomKop>
                    <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
                    <KolomKop getal>Klikken</KolomKop>
                    <KolomKop getal>Conversies</KolomKop>
                    <KolomKop getal>Conv.waarde</KolomKop>
                    <KolomKop getal>CPA</KolomKop>
                    <KolomKop getal>ROAS</KolomKop>
                    <KolomKop getal>CTR</KolomKop>
                  </Kop>
                  <Body>
                    {monthsDesc.map((m) => (
                      <Rij key={m.month}>
                        <NaamCel>{maandLabel(m.month)}</NaamCel>
                        <AandeelCel waarde={fmtEur(m.cost)} aandeel={duursteMaand > 0 ? m.cost / duursteMaand : 0} />
                        <GetalCel>{fmt(m.clicks)}</GetalCel>
                        <GetalCel>{fmt(m.conversions, { maximumFractionDigits: 1 })}</GetalCel>
                        <GetalCel>{fmtEur(m.conversionsValue)}</GetalCel>
                        <GetalCel zacht>{fmtEur(m.cpa)}</GetalCel>
                        <GetalCel zacht>{m.roas === null ? "—" : formatRoas(m.roas)}</GetalCel>
                        <GetalCel zacht>{fmtPct(m.ctr)}</GetalCel>
                      </Rij>
                    ))}
                  </Body>
                  {/* De ratio's uit de opgetelde maanden en niet als gemiddelde van de
                      maandwaarden: een maand met tien conversies mag niet even zwaar wegen als een
                      met honderd. */}
                  <TotaalRij>
                    <TotaalCel>Getoonde maanden ({monthsDesc.length} van {summary.months.length})</TotaalCel>
                    <TotaalCel getal>{fmtEur(zichtbaar.cost)}</TotaalCel>
                    <TotaalCel getal>{fmt(zichtbaar.clicks)}</TotaalCel>
                    <TotaalCel getal>{fmt(zichtbaar.conversions, { maximumFractionDigits: 1 })}</TotaalCel>
                    <TotaalCel getal>{fmtEur(zichtbaar.conversionsValue)}</TotaalCel>
                    <TotaalCel getal>{fmtEur(zichtbaar.conversions > 0 ? zichtbaar.cost / zichtbaar.conversions : null)}</TotaalCel>
                    <TotaalCel getal>{zichtbaar.cost > 0 ? formatRoas(zichtbaar.conversionsValue / zichtbaar.cost) : "—"}</TotaalCel>
                    <TotaalCel getal>{fmtPct(zichtbaar.impressions > 0 ? zichtbaar.clicks / zichtbaar.impressions : null)}</TotaalCel>
                  </TotaalRij>
                </Tabel>
              );
            })()}
          </>
        )}
      </div>
    </div>

    {/* Fase 4: de event-relatieve beursanalyse (editie-over-editie + projectie richting beursdag). */}
    <SignalAnalysisCard
      clientId={clientId}
      endpoint="/api/analysis/geo-clone"
      extra={{ geo_clone: geoClone }}
      title={`Beursanalyse ${label}`}
      description="Event-relatief: aanloop naar deze editie vs dezelfde afstand tot de vorige editie (cadans-bewust), plus projectie richting de beursdag tegen het doel. Bijsturing landt in de goedkeuringswachtrij."
      runLabel="Draai beursanalyse"
    />
    </div>
  );
}
