"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { actieveMetrics, computeForecast, MONTH_LABELS, type ClientForecast, type ForecastMetric, type ForecastPoint } from "@/lib/forecast";
import { METRIC_LABELS, formatDeltaPercent, formatPercent, formatterFor, geenWaardeLabel, isLowerBetter, zonderData } from "@/lib/forecast-format";
import { daysInMonthOf } from "@/lib/analysis/comparison-facts";
import { today } from "@/lib/reporting-date";
import type { ClientHistoricalData } from "@/lib/types";
import { PeriodPopover } from "@/components/ui/period-popover";
import { actieveJaardagen } from "./pacing-monitor";

const ALLE_METRICS: ForecastMetric[] = ["conversions", "revenue", "roas", "cpa"];

function MonthCard({
  pt,
  metric,
  year,
  format,
  variant,
  label,
  inverted,
  partialRealized,
  partialGeschat,
  monthProgressPct,
}: {
  pt: ForecastPoint;
  metric: ForecastMetric;
  /** Het jaar waar de data over gaat; stond hier als vaste "2026" in de opmaak. */
  year: number;
  format: (v: number) => string;
  variant: "previous" | "current" | "next";
  /** "Vorige maand", of "Laatste volle maand" als de data achterloopt op de kalender. */
  label: string;
  /** If true, lower values are better (CPA) */
  inverted?: boolean;
  /** For current month: realized value so far (partial month) */
  partialRealized?: number;
  /** De deelwaarde komt uit het tempo, niet uit gemeten weken: dan heet hij geen "Gerealiseerd". */
  partialGeschat?: boolean;
  /** For current month: % of month elapsed */
  monthProgressPct?: number;
}) {
  const geenData = zonderData(pt);
  const value = pt.realized ?? pt.forecast ?? 0;
  const diff = pt.expected > 0 ? ((value - pt.expected) / pt.expected) * 100 : 0;
  const ratio = pt.monthRatio;
  // For CPA: lower than expected = positive. Kosten zonder conversies (geenNoemer) heeft geen getal
  // maar wel een oordeel: een CPA die niet slechter kan, een ROAS die niet beter kan.
  const isPositive = pt.geenNoemer ? !inverted : inverted ? diff <= 0 : diff >= 0;
  const isRealized = pt.realized !== null;
  const isCurrent = variant === "current";

  const diffColor = isPositive ? "text-green-600" : "text-red-500";

  const borderColors = {
    previous: geenData && !pt.geenNoemer ? "border-border bg-gray-50/50" : isPositive ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50",
    current: "border-brand-blue/30 bg-brand-blue/5",
    next: "border-border bg-gray-50/50",
  };

  const statusIcons = {
    previous: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
    current: <Clock className="w-3.5 h-3.5 text-brand-blue-ink" />,
    next: <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />,
  };

  // For current month: partial realized pacing
  const hasPartial = isCurrent && partialRealized !== undefined && partialRealized > 0;
  const partialPacingPct = hasPartial && monthProgressPct && pt.expected > 0
    ? (partialRealized! / (pt.expected * (monthProgressPct / 100))) * 100
    : 0;
  const partialIsOnTrack = partialPacingPct >= 90;

  return (
    <div className={`rounded-lg border p-4 ${borderColors[variant]}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {statusIcons[variant]}
          <div>
            <span className="text-sm font-semibold text-brand-gray">{pt.monthLabel} {year}</span>
            <span className="text-micro text-muted-foreground ml-1.5">{label}</span>
          </div>
        </div>
        {!geenData && (
          <div className="flex items-center gap-1.5">
            {isPositive
              ? <TrendingUp className="w-3.5 h-3.5 text-green-600" />
              : <TrendingDown className="w-3.5 h-3.5 text-red-500" />
            }
            <span className={`text-xs font-bold ${diffColor}`}>
              {formatDeltaPercent(diff)}
            </span>
          </div>
        )}
      </div>

      {/* Values */}
      <div className="space-y-1.5">
        {/* Current month: Gerealiseerd (partial) at the top */}
        {hasPartial && (
          <div className="flex justify-between items-baseline">
            <span className="text-meta text-muted-foreground">{partialGeschat ? "Geschat tot nu" : "Gerealiseerd"}</span>
            <span className="text-base font-bold text-brand-blue-ink">
              {format(partialRealized!)}
            </span>
          </div>
        )}

        {/* Main value: Gerealiseerd (previous) or Prognose (current/next) */}
        <div className="flex justify-between items-baseline">
          <span className="text-meta text-muted-foreground">
            {geenData ? geenWaardeLabel(pt, metric) : isRealized ? "Gerealiseerd" : "Prognose"}
          </span>
          <span className={`${hasPartial ? "text-xs" : "text-base font-bold"} ${
            hasPartial ? "text-muted-foreground" : variant === "current" ? "text-brand-blue-ink" : "text-brand-gray"
          }`}>
            {geenData ? "—" : format(value)}
          </span>
        </div>

        {/* Verwacht */}
        <div className="flex justify-between items-baseline">
          <span className="text-meta text-muted-foreground">Verwacht</span>
          <span className="text-xs text-muted-foreground">{format(pt.expected)}</span>
        </div>
      </div>

      {/* Ratio bar. Niet bij een maand zonder data: de forecast geeft die de projectiefactor als
          ratio, en dat zou als een gemeten prestatie kleuren. */}
      {!geenData && <div className="mt-3">
        <div className="flex justify-between text-micro mb-1">
          <span className="text-muted-foreground">Ratio</span>
          <span className={`font-semibold ${diffColor}`}>
            {formatPercent(ratio, 1)}
          </span>
        </div>
        <div className="h-1.5 bg-white/80 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isPositive ? "bg-green-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.min(ratio * 100, 120)}%` }}
          />
        </div>
        {/* Current month: mini progress within the month */}
        {hasPartial && monthProgressPct && (
          <div className="mt-1.5">
            <div className="flex justify-between text-micro mb-0.5">
              <span className="text-muted-foreground">Maandvoortgang</span>
              <span className={`font-medium ${partialIsOnTrack ? "text-green-600" : "text-amber-500"}`}>
                {Math.round(monthProgressPct)}% van maand
              </span>
            </div>
            <div className="h-1 bg-white/80 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${partialIsOnTrack ? "bg-brand-blue" : "bg-amber-400"}`}
                style={{ width: `${Math.min(monthProgressPct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Hoe ver de maand ná de laatste gerealiseerde is, en of hij de kalendermaand is.
 *
 * WAAROM NIET DE BROWSERKLOK. De kaart "Huidige maand" is de eerste maand die de forecast nog niet
 * als gerealiseerd telt. Liep de data bij met de kalender, dan is dat de lopende maand en klopte
 * "dag X van deze maand" toevallig. Sinds de grens de datastand volgt (data t/m 25 augustus: t/m
 * juli gerealiseerd) is die kaart op 1 november augustus, en dan zei hij "Huidige maand", 3% van
 * de maand voorbij, terwijl augustus voor 25 van de 31 dagen binnen is. Nu: staat de maand in de
 * datastand als partieel, dan diens dag; is het de kalendermaand, dan vandaag (Amsterdam); anders
 * (de maand ligt verder achter of vooruit) geen voortgang.
 */
export function maandVoortgang(
  jaar: number,
  maand: number,
  dataStand: ClientHistoricalData["dataStand"],
  vandaag: string,
): { tmDag: number; dagenInMaand: number; isKalendermaand: boolean } | null {
  if (maand < 1 || maand > 12) return null;
  const sleutel = `${jaar}-${pad2(maand)}`;
  const isKalendermaand = sleutel === vandaag.slice(0, 7);
  if (dataStand?.partieel?.maand === sleutel) {
    return { tmDag: dataStand.partieel.tmDag, dagenInMaand: dataStand.partieel.dagenInMaand, isKalendermaand };
  }
  if (isKalendermaand) {
    return { tmDag: Number(vandaag.slice(8, 10)), dagenInMaand: daysInMonthOf(vandaag), isKalendermaand };
  }
  return null;
}

export function MonthlyOverview({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  // Uit de provider: eerder rekende dit component de forecast bij elke render opnieuw uit
  // (0,566 ms per keer, twaalf componenten). Nu een keer per klant.
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(data);
  return <MonthlyOverviewView data={data} forecast={forecast} vandaag={today()} />;
}

/** De weergave zonder dataprovider, zodat hij te renderen en te toetsen is. */
export function MonthlyOverviewView({ data, forecast, vandaag }: {
  data: ClientHistoricalData;
  forecast: ClientForecast;
  /** "YYYY-MM-DD" in Amsterdam (today()); los meegegeven zodat een test de dag kan kiezen. */
  vandaag: string;
}) {
  const [metric, setMetric] = useState<ForecastMetric>("conversions");
  // Feedback: "weken/maanden klikbaar bij maandprestaties" -- een klik op een maand in de strip
  // opent een layover met alle vier de metrics voor die maand, in plaats van de pagina te
  // verlaten of te verversen.
  const [openMonthIdx, setOpenMonthIdx] = useState<number | null>(null);

  const result = forecast[metric];
  const format = formatterFor(metric);

  // Previous = last realized month, Current = first forecast, Next = second forecast.
  //
  // De grens van de forecast zelf (kpi.realizedThroughMonth), niet een eigen scan en niet een
  // hardgecodeerde kalendermaand. REALIZED_THROUGH_MONT stond vast op 3 (maart); een dashboard
  // dat in augustus nog denkt dat maart de laatste gerealiseerde maand is, toont de verkeerde
  // drie maanden als "vorige/huidige/volgende" -- zie docs/MASTERPLAN.md sectie 5.3.
  //
  // Zonder gerealiseerde maand (de hele januari, bij elke live klant) is er geen vorige kaart en
  // is januari de huidige. Hier stond Math.max(0, ...): dan werd januari de "Laatste volle maand"
  // terwijl hij nog loopt, en februari "Nog niet binnen".
  const realizedThroughMonth = result.kpi.realizedThroughMonth;
  const realizedThroughIdx = realizedThroughMonth - 1;
  const prevMonth = realizedThroughIdx >= 0 ? result.points[realizedThroughIdx] : undefined;
  const currMonth = result.points[realizedThroughIdx + 1];
  const nextMonth = result.points[realizedThroughIdx + 2];

  // Hoe ver de "huidige" kaart is. Loopt de data achter op de kalender, dan is die kaart niet de
  // lopende maand, en dan noemen de labels de maanden naar de data in plaats van naar vandaag.
  const voortgang = maandVoortgang(data.currentYear, realizedThroughMonth + 1, data.dataStand, vandaag);
  const loptAchter = !(voortgang?.isKalendermaand ?? false);
  const dayOfMonth = voortgang?.tmDag ?? 0;
  const monthProgressPct = voortgang ? (voortgang.tmDag / voortgang.dagenInMaand) * 100 : undefined;
  const kaartLabels = loptAchter
    ? {
        previous: "Laatste volle maand",
        current: voortgang ? `Data t/m ${voortgang.tmDag} ${MONTH_LABELS[realizedThroughMonth].toLowerCase()}` : "Nog niet binnen",
        next: "Maand erna",
      }
    : { previous: "Vorige maand", current: "Huidige maand", next: "Volgende maand" };

  // Sum realized weeks for current month, or estimate from daily run rate
  const currentMonthWeeks = result.weeklyPoints.filter(
    (wp) => wp.month === realizedThroughMonth + 1
  );
  const weeklyRealized = currentMonthWeeks
    .filter((wp) => wp.realized !== null)
    .reduce((s, wp) => s + (wp.realized ?? 0), 0);

  // If no weekly data yet, estimate from YTD daily rate × days elapsed this month.
  //
  // Het tempo deelt door de dagen WAAROVER ytdRealized loopt (de eerste maand met een rij t/m het
  // eind van de laatste gerealiseerde maand), niet door de dag van het jaar volgens de browserklok:
  // met data t/m juli op 1 november deelde dit 212 dagen data door 305. En niet vanaf 1 januari:
  // bij een kanaal dat in maart begon gaf dat 35 waar 49 klopt (zie actieveJaardagen). De eerste
  // maand uit de forecast zelf, niet uit `data`: met een landfilter is `data` de gefilterde reeks
  // (nulrecords vanaf januari) en de forecast die van het account, en dan mengde de deler het een
  // met de teller van het ander.
  const partialGeschat = weeklyRealized <= 0;
  const daysElapsed = actieveJaardagen(data.currentYear, realizedThroughMonth, forecast.conversions.points.map((p) => p.realized));
  // Zonder één gerealiseerde dag is er geen tempo om uit te schatten (januari): dan geen
  // "Geschat tot nu", in plaats van een 0 of een deling door nul bij ROAS en CPA.
  const partialRealized = !partialGeschat
    ? weeklyRealized
    : daysElapsed <= 0
    ? undefined
    : (() => {
        const kpi = forecast[metric === "roas" || metric === "cpa" ? "conversions" : metric].kpi;
        const dailyRate = kpi.ytdRealized / daysElapsed;
        // For derived metrics (ROAS, CPA), use the underlying values
        if (metric === "roas") {
          const revDaily = forecast.revenue.kpi.ytdRealized / daysElapsed;
          const spendDaily = forecast.adSpend.kpi.ytdRealized / daysElapsed;
          return spendDaily > 0 ? (revDaily * dayOfMonth) / (spendDaily * dayOfMonth) : 0;
        }
        if (metric === "cpa") {
          const spendDaily = forecast.adSpend.kpi.ytdRealized / daysElapsed;
          const convDaily = forecast.conversions.kpi.ytdRealized / daysElapsed;
          return convDaily > 0 ? (spendDaily * dayOfMonth) / (convDaily * dayOfMonth) : 0;
        }
        return Math.round(dailyRate * dayOfMonth);
      })();

  // All 12 months for the strip — focus months are highlighted
  const focusIndices = new Set([realizedThroughIdx, realizedThroughIdx + 1, realizedThroughIdx + 2]);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header with metric tabs. flex-wrap + min-w-0: zelfde overflow-risico als
          fair-weeks-overview.tsx's kop -- op een telefoonbreed scherm duwden titel/toelichting
          plus de metric-knoppen de pagina breder i.p.v. zelf om te breken. */}
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">
            Maandprestaties
          </h3>
          <p className="text-meta text-muted-foreground mt-0.5">
            Vorige, huidige en volgende maand · ratio geeft aan of je boven of onder verwachting zit
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {/* Feedback #27: alleen de KPI's met een doel voor deze klant, niet altijd alle vier. */}
          {actieveMetrics(forecast).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === m
                  ? "bg-brand-blue text-white"
                  : "text-muted-foreground hover:text-brand-blue-ink"
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* 3 main month cards */}
      <div className="px-5 pb-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {prevMonth && <MonthCard pt={prevMonth} metric={metric} year={data.currentYear} format={format} variant="previous" label={kaartLabels.previous} inverted={isLowerBetter(metric)} />}
          {currMonth && <MonthCard pt={currMonth} metric={metric} year={data.currentYear} format={format} variant="current" label={kaartLabels.current} inverted={isLowerBetter(metric)} partialRealized={voortgang ? partialRealized : undefined} partialGeschat={partialGeschat} monthProgressPct={monthProgressPct} />}
          {nextMonth && <MonthCard pt={nextMonth} metric={metric} year={data.currentYear} format={format} variant="next" label={kaartLabels.next} inverted={isLowerBetter(metric)} />}
        </div>
      </div>

      {/* All 12 months — focus months highlighted */}
      <div className="mt-2 border-t border-border">
        <div className="px-5 py-3">
          <div className="flex gap-0.5 overflow-x-auto">
            {result.points.map((pt, i) => {
              const value = pt.realized ?? pt.forecast ?? 0;
              const geenData = zonderData(pt);
              const isRealized = pt.realized !== null;
              const isFocus = focusIndices.has(i);
              const ratio = pt.monthRatio;
              // CPA: ratio < 1 means cheaper than expected = good
              const inverted = isLowerBetter(metric);
              const isPositive = pt.geenNoemer ? !inverted : inverted ? ratio <= 1 : ratio >= 1;
              const ratioColor = isPositive ? "text-green-600" : "text-red-500";
              const barColor = isPositive ? "bg-green-400" : "bg-red-400";

              return (
                <button
                  key={pt.month}
                  type="button"
                  onClick={() => setOpenMonthIdx(i)}
                  className={`flex-1 min-w-[52px] rounded-md px-1.5 py-2 text-center transition-colors cursor-pointer hover:ring-1 hover:ring-brand-blue/30 ${
                    isFocus
                      ? "bg-brand-blue/8 ring-1 ring-brand-blue/20"
                      : isRealized
                        ? "bg-gray-50"
                        : ""
                  }`}
                >
                  <p className={`text-micro font-medium mb-1 ${
                    isFocus ? "text-brand-blue-ink font-semibold" : isRealized ? "text-brand-gray" : "text-muted-foreground"
                  }`}>
                    {pt.monthLabel}
                  </p>
                  <p className={`text-meta font-semibold ${isFocus ? "text-brand-blue-ink" : "text-brand-gray"}`}>
                    {geenData ? "—" : format(value)}
                  </p>
                  <div className="mt-1.5 mx-auto w-full max-w-[36px]">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      {!geenData && (
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${Math.min(ratio * 100, 120)}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <p className={`text-micro font-bold mt-0.5 ${geenData && !pt.geenNoemer ? "text-muted-foreground" : ratioColor}`}>
                    {geenData ? geenWaardeLabel(pt, metric).toLowerCase() : formatPercent(ratio, 0)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {openMonthIdx !== null && (() => {
        const idx = openMonthIdx;
        const label = result.points[idx]?.monthLabel ?? "";
        return (
          <PeriodPopover
            title={`${label} ${data.currentYear}`}
            subtitle="Alle vier de metrics voor deze maand"
            onClose={() => setOpenMonthIdx(null)}
          >
            <div className="space-y-3">
              {ALLE_METRICS.map((m) => {
                const p = forecast[m].points[idx];
                if (!p) return null;
                const mGeenData = zonderData(p);
                const mVal = p.realized ?? p.forecast ?? 0;
                const mFormat = formatterFor(m);
                const mInverted = isLowerBetter(m);
                const mPositive = mInverted ? p.monthRatio <= 1 : p.monthRatio >= 1;
                return (
                  <div key={m} className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="text-body font-semibold text-brand-gray">{METRIC_LABELS[m]}</p>
                      <p className="text-micro text-muted-foreground">
                        {mGeenData ? geenWaardeLabel(p, m) : p.realized !== null ? "Gerealiseerd" : "Prognose"} · verwacht {mFormat(p.expected)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lead font-bold text-brand-gray">{mGeenData ? "—" : mFormat(mVal)}</p>
                      {!mGeenData && (
                        <p className={`text-micro font-semibold ${mPositive ? "text-green-600" : "text-red-500"}`}>
                          {formatPercent(p.monthRatio, 0)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </PeriodPopover>
        );
      })()}
    </div>
  );
}
