"use client";

import { useState, useEffect } from "react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { computeForecast, MONTH_LABELS, type ForecastMetric } from "@/lib/forecast";
import { dbSelectOne } from "@/lib/data-access/client-read";
import { METRIC_LABELS, formatDeltaPercent, formatPercent, formatterFor } from "@/lib/forecast-format";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, TotaalVoet, VoetRij, TotaalCel } from "./data-table";

const METRICS: { id: ForecastMetric; label: string; format: (v: number) => string }[] =
  (["conversions", "revenue", "roas", "cpa"] as ForecastMetric[])
    .map((id) => ({ id, label: METRIC_LABELS[id], format: formatterFor(id) }));

export function ForecastTable({ clientId }: { clientId: string }) {
  const [selectedMetric, setSelectedMetric] = useState<ForecastMetric>("conversions");
  const data = useClientHistoricalData(clientId);
  // Uit de provider: eerder rekende dit component de forecast bij elke render opnieuw uit
  // (0,566 ms per keer, twaalf componenten). Nu een keer per klant.
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(data);

  // Event-besef: heeft deze klant beurzen geconfigureerd, dan is de kalender-YoY-prognose
  // hieronder misleidend voor de maandvorm (een 2-jaarlijkse beurs vergelijkt met een
  // beursloos jaar). We waarschuwen eerlijk en verwijzen naar de event-relatieve beursanalyse.
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

  const metric = METRICS.find((m) => m.id === selectedMetric)!;
  const result = forecast[selectedMetric];
  const fmt = metric.format;

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
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with metric tabs */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">
          Maandelijkse uitsplitsing — {metric.label}
        </h3>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {METRICS.map((m) => (
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
        {/* Drie voetregels in plaats van één: het totaal, de jaarprognose en de bandbreedte
            eronder. Daarom TotaalVoet met eigen rijen — een vaste totaalrij past hier niet. */}
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

          {!isRatio && (
            <VoetRij className="bg-brand-blue/5">
              <TotaalCel colSpan={2} className="text-xs font-semibold text-brand-blue-ink">
                Jaarprognose (gerealiseerd + prognose)
              </TotaalCel>
              <TotaalCel getal colSpan={2} className="text-xs font-bold text-brand-blue-ink">{fmt(kpiAdjusted)}</TotaalCel>
              <TotaalCel getal className={`text-xs font-bold ${(isInverted ? totalDiffPct <= 0 : totalDiffPct >= 0) ? "text-green-600" : "text-red-500"}`}>
                vs doel {fmt(totalExpected)}
              </TotaalCel>
            </VoetRij>
          )}

          {!isRatio && result.kpi.forecastSpreadPct > 0 && (
            <VoetRij className="bg-brand-blue/5">
              <TotaalCel colSpan={2} className="text-meta text-muted-foreground">
                Bandbreedte (o.b.v. de spreiding in gerealiseerde maanden)
              </TotaalCel>
              <TotaalCel getal colSpan={3} className="text-meta text-muted-foreground">
                {fmt(result.kpi.forecastLow)} – {fmt(result.kpi.forecastHigh)}
                <span className="ml-1 opacity-70">(±{result.kpi.forecastSpreadPct}%)</span>
              </TotaalCel>
            </VoetRij>
          )}
        </TotaalVoet>
      </Tabel>
    </div>
    </div>
  );
}
