"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { actieveMetrics, computeForecast, ForecastMetric, ForecastPoint } from "@/lib/forecast";
import { METRIC_LABELS, formatDeltaPercent, formatPercent, formatterFor, isLowerBetter } from "@/lib/forecast-format";
import { PeriodPopover } from "@/components/ui/period-popover";

const ALLE_METRICS: ForecastMetric[] = ["conversions", "revenue", "roas", "cpa"];

function MonthCard({
  pt,
  year,
  format,
  variant,
  inverted,
  partialRealized,
  monthProgressPct,
}: {
  pt: ForecastPoint;
  /** Het jaar waar de data over gaat; stond hier als vaste "2026" in de opmaak. */
  year: number;
  format: (v: number) => string;
  variant: "previous" | "current" | "next";
  /** If true, lower values are better (CPA) */
  inverted?: boolean;
  /** For current month: realized value so far (partial month) */
  partialRealized?: number;
  /** For current month: % of month elapsed */
  monthProgressPct?: number;
}) {
  const value = pt.realized ?? pt.forecast ?? 0;
  const diff = pt.expected > 0 ? ((value - pt.expected) / pt.expected) * 100 : 0;
  const ratio = pt.monthRatio;
  // For CPA: lower than expected = positive
  const isPositive = inverted ? diff <= 0 : diff >= 0;
  const isRealized = pt.realized !== null;
  const isCurrent = variant === "current";

  const diffColor = isPositive ? "text-green-600" : "text-red-500";

  const borderColors = {
    previous: isPositive ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50",
    current: "border-brand-blue/30 bg-brand-blue/5",
    next: "border-border bg-gray-50/50",
  };

  const labels = {
    previous: "Vorige maand",
    current: "Huidige maand",
    next: "Volgende maand",
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
            <span className="text-micro text-muted-foreground ml-1.5">{labels[variant]}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isPositive
            ? <TrendingUp className="w-3.5 h-3.5 text-green-600" />
            : <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          }
          <span className={`text-xs font-bold ${diffColor}`}>
            {formatDeltaPercent(diff)}
          </span>
        </div>
      </div>

      {/* Values */}
      <div className="space-y-1.5">
        {/* Current month: Gerealiseerd (partial) at the top */}
        {hasPartial && (
          <div className="flex justify-between items-baseline">
            <span className="text-meta text-muted-foreground">Gerealiseerd</span>
            <span className="text-base font-bold text-brand-blue-ink">
              {format(partialRealized!)}
            </span>
          </div>
        )}

        {/* Main value: Gerealiseerd (previous) or Prognose (current/next) */}
        <div className="flex justify-between items-baseline">
          <span className="text-meta text-muted-foreground">
            {isRealized ? "Gerealiseerd" : "Prognose"}
          </span>
          <span className={`${hasPartial ? "text-xs" : "text-base font-bold"} ${
            hasPartial ? "text-muted-foreground" : variant === "current" ? "text-brand-blue-ink" : "text-brand-gray"
          }`}>
            {format(value)}
          </span>
        </div>

        {/* Verwacht */}
        <div className="flex justify-between items-baseline">
          <span className="text-meta text-muted-foreground">Verwacht</span>
          <span className="text-xs text-muted-foreground">{format(pt.expected)}</span>
        </div>
      </div>

      {/* Ratio bar */}
      <div className="mt-3">
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
      </div>
    </div>
  );
}

export function MonthlyOverview({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const [metric, setMetric] = useState<ForecastMetric>("conversions");
  // Feedback: "weken/maanden klikbaar bij maandprestaties" -- een klik op een maand in de strip
  // opent een layover met alle vier de metrics voor die maand, in plaats van de pagina te
  // verlaten of te verversen.
  const [openMonthIdx, setOpenMonthIdx] = useState<number | null>(null);

  const fullData = useClientHistoricalData(clientId);
  const data = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  // Uit de provider: eerder rekende dit component de forecast bij elke render opnieuw uit
  // (0,566 ms per keer, twaalf componenten). Nu een keer per klant.
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(data);
  const result = forecast[metric];
  const format = formatterFor(metric);

  // Previous = last realized month, Current = first forecast, Next = second forecast.
  //
  // Afgeleid uit result.points zelf (het laatste punt met realized !== null), niet uit een
  // hardgecodeerde kalendermaand. REALIZED_THROUGH_MONT stond vast op 3 (maart); een dashboard
  // dat in augustus nog denkt dat maart de laatste gerealiseerde maand is, toont de verkeerde
  // drie maanden als "vorige/huidige/volgende" -- zie docs/MASTERPLAN.md sectie 5.3.
  const realizedThroughIdx = Math.max(
    0,
    result.points.reduce((last, p, i) => (p.realized !== null ? i : last), 0)
  );
  const realizedThroughMonth = realizedThroughIdx + 1;
  const prevMonth = result.points[realizedThroughIdx];
  const currMonth = result.points[realizedThroughIdx + 1];
  const nextMonth = result.points[realizedThroughIdx + 2];

  // Current month partial realization from weekly data
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgressPct = (dayOfMonth / daysInMonth) * 100;

  // Sum realized weeks for current month, or estimate from daily run rate
  const currentMonthWeeks = result.weeklyPoints.filter(
    (wp) => wp.month === realizedThroughMonth + 1
  );
  const weeklyRealized = currentMonthWeeks
    .filter((wp) => wp.realized !== null)
    .reduce((s, wp) => s + (wp.realized ?? 0), 0);

  // If no weekly data yet, estimate from YTD daily rate × days elapsed this month
  const partialRealized = weeklyRealized > 0
    ? weeklyRealized
    : (() => {
        const kpi = forecast[metric === "roas" || metric === "cpa" ? "conversions" : metric].kpi;
        const daysElapsed = Math.floor(
          (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
        );
        const dailyRate = daysElapsed > 0 ? kpi.ytdRealized / daysElapsed : 0;
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
      {/* Header with metric tabs */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div>
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
          {prevMonth && <MonthCard pt={prevMonth} year={data.currentYear} format={format} variant="previous" inverted={isLowerBetter(metric)} />}
          {currMonth && <MonthCard pt={currMonth} year={data.currentYear} format={format} variant="current" inverted={isLowerBetter(metric)} partialRealized={partialRealized} monthProgressPct={monthProgressPct} />}
          {nextMonth && <MonthCard pt={nextMonth} year={data.currentYear} format={format} variant="next" inverted={isLowerBetter(metric)} />}
        </div>
      </div>

      {/* All 12 months — focus months highlighted */}
      <div className="mt-2 border-t border-border">
        <div className="px-5 py-3">
          <div className="flex gap-0.5 overflow-x-auto">
            {result.points.map((pt, i) => {
              const value = pt.realized ?? pt.forecast ?? 0;
              const isRealized = pt.realized !== null;
              const isFocus = focusIndices.has(i);
              const ratio = pt.monthRatio;
              // CPA: ratio < 1 means cheaper than expected = good
              const inverted = isLowerBetter(metric);
              const isPositive = inverted ? ratio <= 1 : ratio >= 1;
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
                    {format(value)}
                  </p>
                  <div className="mt-1.5 mx-auto w-full max-w-[36px]">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${Math.min(ratio * 100, 120)}%` }}
                      />
                    </div>
                  </div>
                  <p className={`text-micro font-bold mt-0.5 ${ratioColor}`}>
                    {formatPercent(ratio, 0)}
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
                const mVal = p.realized ?? p.forecast ?? 0;
                const mFormat = formatterFor(m);
                const mInverted = isLowerBetter(m);
                const mPositive = mInverted ? p.monthRatio <= 1 : p.monthRatio >= 1;
                return (
                  <div key={m} className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="text-body font-semibold text-brand-gray">{METRIC_LABELS[m]}</p>
                      <p className="text-micro text-muted-foreground">
                        {p.realized !== null ? "Gerealiseerd" : "Prognose"} · verwacht {mFormat(p.expected)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lead font-bold text-brand-gray">{mFormat(mVal)}</p>
                      <p className={`text-micro font-semibold ${mPositive ? "text-green-600" : "text-red-500"}`}>
                        {formatPercent(p.monthRatio, 0)}
                      </p>
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
