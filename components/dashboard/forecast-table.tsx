"use client";

import { useState, useEffect } from "react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useBlendedClientData } from "@/lib/use-blended-client-data";
import { actieveMetrics, computeForecast, MONTH_LABELS, type ForecastMetric, type ClientForecast } from "@/lib/forecast";
import { dbSelectOne } from "@/lib/data-access/client-read";
import { METRIC_LABELS, formatDeltaPercent, formatPercent, formatterFor } from "@/lib/forecast-format";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalVoet, VoetRij, TotaalCel } from "./data-table";

const METRICS: { id: ForecastMetric; label: string; format: (v: number) => string }[] =
  (["conversions", "revenue", "roas", "cpa"] as ForecastMetric[])
    .map((id) => ({ id, label: METRIC_LABELS[id], format: formatterFor(id) }));

/**
 * Kiest tussen de Google-context (altijd al gefetcht, ook op andere tabbladen) en de blended
 * hook (Google+Meta+LinkedIn uit fact_core) -- zie lib/api/blended-historical.ts voor waarom dit
 * nu ook voor "alle kanalen" mag: computeMonthlyExpected negeert toch al maanden zonder data
 * (mv > 0), dus een periode voordat Meta/LinkedIn liepen levert gewoon Google's eigen totaal op.
 * Beide hooks worden onvoorwaardelijk aangeroepen (React-regel), alleen het resultaat wisselt.
 */
function useChannelForecast(clientId: string, channel: "google" | "blended"): { forecast: ClientForecast | null; loading: boolean; error: string | null } {
  const googleData = useClientHistoricalData(clientId);
  const googleForecast = useForecast();
  const blended = useBlendedClientData(clientId);

  if (channel === "blended") {
    return {
      forecast: blended.data ? computeForecast(blended.data) : null,
      loading: blended.loading,
      error: blended.error,
    };
  }
  return { forecast: googleForecast ?? computeForecast(googleData), loading: false, error: null };
}

/**
 * De jaarprognose + bandbreedte als eigen, korte kop-sectie -- in dezelfde vorm als Meta/LinkedIn's
 * "Lopende maand"/"Volgende maand"-tegels in ChannelForecast, zodat de Prognose-tab voor elk kanaal
 * met dezelfde soort eerste sectie begint (feedback: de layout moet voor elk kanaal gelijk zijn --
 * eerst het antwoord op "waar komen we uit", dan het budgetscenario, dan pas de detailtabel).
 * Voorheen stonden deze twee getallen als voetregels ONDER de maandtabel; nu staan ze los, boven de
 * budgetslider, en toont de tabel zelf (hieronder) alleen nog de rijen zelf.
 */
export function ForecastSummaryTiles({ clientId, channel = "google" }: { clientId: string; channel?: "google" | "blended" }) {
  const { forecast, loading, error } = useChannelForecast(clientId, channel);

  const [hasEvents, setHasEvents] = useState(false);
  useEffect(() => {
    let cancelled = false;
    dbSelectOne<{ rai_events: unknown }>("client_settings", { select: "rai_events", clientId })
      .then(({ data }) => {
        if (cancelled) return;
        const evs = (data?.rai_events as { events?: unknown[] } | null)?.events;
        setHasEvents(Array.isArray(evs) && evs.length > 0);
      });
    return () => { cancelled = true; };
  }, [clientId]);

  if (!forecast) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-meta text-muted-foreground">
        {loading ? "Blended jaarprognose laadt…" : error ? `Geen blended data: ${error}` : "Nog geen data over alle kanalen samen."}
      </div>
    );
  }

  // Eén metric als kop: dezelfde "één eerlijke default" als MonthlyTrendBars/MonthlyTrendLine
  // elders in de opener -- de eerste met een ingesteld doel, dus nooit een lege selector.
  const primaryId = actieveMetrics(forecast)[0] ?? "conversions";
  const metric = METRICS.find((m) => m.id === primaryId)!;
  const result = forecast[primaryId];
  const fmt = metric.format;
  const isInverted = primaryId === "cpa";

  const totalExpected = result.points.reduce((s, p) => s + p.expected, 0);
  const isRatio = primaryId === "roas" || primaryId === "cpa";
  const kpiAdjusted = result.kpi.adjustedAnnual;
  const totalDiffPct = result.kpi.diffPct;
  const isPositive = isInverted ? totalDiffPct <= 0 : totalDiffPct >= 0;

  return (
    <div className="space-y-4">
      {hasEvents && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
          <strong>Event-gedreven account.</strong> Deze kalender-jaarprognose vergelijkt elke maand met dezelfde
          kalendermaand vorig jaar. Voor een beurs met een andere cadans (bijv. 2-jaarlijks) vertekent dat de
          maandvorm — vorig jaar was er dan geen beurs. Gebruik de <strong>beursanalyse</strong> (kies een beurs
          in het menu → Analyses) voor de event-relatieve prognose die de aanloop op gelijke afstand tot de
          beursdag vergelijkt.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide mb-2">
            Jaarprognose — {metric.label}
          </div>
          <div className="space-y-1.5 text-lead">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Gerealiseerd + prognose</span>
              {/* kpi.adjustedAnnual is voor ROAS/CPA al de juiste enkele ratio (calcKpi rekent op de
                  som van de jaartotalen, niet op een gemiddelde van maandratio's) -- geen isRatio-
                  uitzondering meer nodig, die zette hier eerder juist het DOEL neer i.p.v. het
                  gerealiseerde+voorspelde cijfer waar deze rij naar heet. */}
              <span className="font-semibold text-brand-gray">{fmt(kpiAdjusted)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">vs. doel</span>
              {/* Bij een ratio-metriek is totalExpected de som van 12 losse maandratio's -- een
                  getal zonder betekenis (tot ~12x te hoog). Wat hier hoort te staan is het doel
                  zelf, dezelfde waarde als diffPct ernaast al tegen afzet. */}
              <span className={`font-semibold ${isPositive ? "text-green-600" : "text-red-500"}`}>
                {fmt(isRatio ? result.kpi.annualTarget : totalExpected)} ({formatDeltaPercent(totalDiffPct, 0)})
              </span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide mb-2">Bandbreedte</div>
          {!isRatio && result.kpi.forecastSpreadPct > 0 ? (
            <>
              <div className="text-lead font-semibold text-brand-gray">
                {fmt(result.kpi.forecastLow)} – {fmt(result.kpi.forecastHigh)}
              </div>
              <p className="text-micro text-muted-foreground mt-2">
                O.b.v. de spreiding in gerealiseerde maanden (±{result.kpi.forecastSpreadPct}%).
              </p>
            </>
          ) : (
            <p className="text-meta text-muted-foreground">Geen bandbreedte voor een verhoudingsgetal — zie de maandtabel voor het verloop.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ForecastTable({ clientId, channel = "google" }: { clientId: string; channel?: "google" | "blended" }) {
  const [selectedMetric, setSelectedMetric] = useState<ForecastMetric>("conversions");
  // Uit de provider (Google) of de blended hook -- eerder rekende dit component de forecast bij
  // elke render opnieuw uit (0,566 ms per keer, twaalf componenten). Nu een keer per klant.
  const { forecast, loading, error } = useChannelForecast(clientId, channel);

  if (!forecast) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm p-5 text-meta text-muted-foreground">
        {loading ? "Blended maandtabel laadt…" : error ? `Geen blended data: ${error}` : "Nog geen data over alle kanalen samen."}
      </div>
    );
  }

  const metric = METRICS.find((m) => m.id === selectedMetric)!;
  const result = forecast[selectedMetric];
  const fmt = metric.format;
  // Feedback #27: alleen de KPI's met een doel voor deze klant als knop tonen, niet altijd alle
  // vier -- METRICS zelf blijft de volledige lijst (voor label/format-opzoek van de al
  // geselecteerde metric, ook als die zelf inmiddels niet meer "actief" is).
  const zichtbareMetrics = METRICS.filter((m) => actieveMetrics(forecast).includes(m.id));

  // CPA: lower is better
  const isInverted = selectedMetric === "cpa";

  // Totals
  const totalExpected = result.points.reduce((s, p) => s + p.expected, 0);
  const totalRealized = result.points.reduce((s, p) => s + (p.realized ?? 0), 0);
  const totalForecast = result.points.reduce((s, p) => s + (p.forecast ?? 0), 0);
  const totalValue = totalRealized + totalForecast;

  // For ROAS/CPA totals, use the KPI values (not sum of monthly)
  const isRatio = selectedMetric === "roas" || selectedMetric === "cpa";
  const kpiTarget = result.kpi.annualTarget;
  const kpiAdjusted = result.kpi.adjustedAnnual;
  const totalDiffPct = result.kpi.diffPct;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with metric tabs */}
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">
          Maandelijkse uitsplitsing — {metric.label}
        </h3>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 overflow-x-auto max-w-full">
          {zichtbareMetrics.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMetric(m.id)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedMetric === m.id
                  ? "bg-brand-blue text-white"
                  : "text-muted-foreground hover:text-brand-blue-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Tabel>
        <Kop>
          <KolomKop breed>Maand</KolomKop>
          <KolomKop getal>Verwacht</KolomKop>
          <KolomKop getal>Gerealiseerd</KolomKop>
          <KolomKop getal>Prognose</KolomKop>
          <KolomKop getal>Ratio</KolomKop>
        </Kop>
        <Body>
          {result.points.map((pt) => {
            const ratio = pt.monthRatio;
            const isPositive = isInverted ? ratio <= 1 : ratio >= 1;
            const isRealized = pt.realized !== null;

            return (
              // Maanden die nog moeten komen krijgen een lichter vlak: dat onderscheid tussen
              // gemeten en geprojecteerd is de belangrijkste informatie in deze tabel.
              <Rij key={pt.month} className={isRealized ? "" : "bg-gray-50/40"}>
                <NaamCel>{pt.monthLabel}</NaamCel>
                <GetalCel zacht>{fmt(pt.expected)}</GetalCel>
                <GetalCel className="font-semibold">{pt.realized !== null ? fmt(pt.realized) : "—"}</GetalCel>
                <GetalCel className="text-brand-blue-ink font-medium">{pt.forecast !== null ? fmt(pt.forecast) : "—"}</GetalCel>
                <GetalCel className={`font-bold ${isPositive ? "text-green-600" : "text-red-500"}`}>
                  {formatPercent(ratio, 0)}
                </GetalCel>
              </Rij>
            );
          })}
        </Body>
        {/* Alleen het totaal over de weergegeven maanden -- de jaarprognose en de bandbreedte
            staan sinds de layout-uniformering (feedback 22 augustus) los in ForecastSummaryTiles,
            als eigen sectie boven de budgetslider. */}
        <TotaalVoet>
          <VoetRij className="border-t-2 border-border bg-gray-50 font-semibold text-brand-gray">
            <TotaalCel>Totaal</TotaalCel>
            <TotaalCel getal className="text-muted-foreground">{isRatio ? fmt(kpiTarget) : fmt(totalExpected)}</TotaalCel>
            <TotaalCel getal>{isRatio ? "—" : fmt(totalRealized)}</TotaalCel>
            <TotaalCel getal className="text-brand-blue-ink">{isRatio ? fmt(kpiAdjusted) : fmt(totalForecast)}</TotaalCel>
            <TotaalCel getal className={(isInverted ? totalDiffPct <= 0 : totalDiffPct >= 0) ? "text-green-600" : "text-red-500"}>
              {formatDeltaPercent(totalDiffPct, 0)}
            </TotaalCel>
          </VoetRij>
        </TotaalVoet>
      </Tabel>
    </div>
  );
}
