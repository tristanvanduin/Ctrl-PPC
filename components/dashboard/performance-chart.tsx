"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useState } from "react";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast, ForecastMetric, MONTH_LABELS } from "@/lib/forecast";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_CATEGORICAL, CHART_AXIS } from "@/lib/branding/chart-colors";
import { Raster, Tip, Legenda, type LegendaItem } from "./chart-chrome";
import { METRIC_LABELS } from "@/lib/forecast-format";

function formatYAxis(metric: ForecastMetric) {
  if (metric === "revenue") {
    return (v: number) =>
      new Intl.NumberFormat("nl-NL", {
        style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0,
      }).format(v);
  }
  if (metric === "roas" ) return (v: number) => `${v.toFixed(1)}x`;
  if (metric === "cpa") {
    return (v: number) =>
      new Intl.NumberFormat("nl-NL", {
        style: "currency", currency: "EUR", maximumFractionDigits: 0,
      }).format(v);
  }
  return (v: number) => new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v);
}


type ViewMode = "weekly" | "monthly";
type CoreMetric = "conversions" | "revenue" | "adSpend";

export function PerformanceChart({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const [metric, setMetric] = useState<ForecastMetric>("conversions");
  const [viewMode, setViewMode] = useState<ViewMode>("weekly");
  const [showYoY, setShowYoY] = useState(false);
  const { theme } = useBrandTheme();

  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  // Uit de provider: eerder rekende dit component de forecast bij elke render opnieuw uit
  // (0,566 ms per keer, twaalf componenten). Nu een keer per klant.
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const result = forecast[metric];

  // Previous year data for YoY overlay
  const prevYearKey = clientData.currentYear - 1;
  const prevYearMonthly = clientData.historicalYears[prevYearKey] ?? [];

  function getPrevYearValue(monthIdx: number): number | null {
    const record = prevYearMonthly[monthIdx];
    if (!record || !record) return null;

    if (metric === "conversions") return record.conversions;
    if (metric === "revenue") return record.revenue;
    if (metric === "cpa") return record.conversions > 0 ? record.adSpend / record.conversions : null;
    if (metric === "roas") return record.adSpend > 0 ? record.revenue / record.adSpend : null;
    return null;
  }

  // Weekly data
  const weeklyData = result.weeklyPoints.map((wp, i) => {
    const monthIdx = wp.month - 1;
    // Distribute prev year monthly value across weeks
    const prevMonthVal = showYoY ? getPrevYearValue(monthIdx) : null;
    const weeksInMonth = result.weeklyPoints.filter((w) => w.month === wp.month).length;
    const prevWeekVal = prevMonthVal !== null ? prevMonthVal / weeksInMonth : null;

    return {
      label: wp.label,
      verwacht: wp.expected,
      gerealiseerd: wp.realized,
      prognose: wp.forecast,
      vorigJaar: prevWeekVal,
    };
  });

  // Monthly data
  const monthlyData = result.points.map((pt, i) => ({
    label: pt.monthLabel,
    verwacht: pt.expected,
    gerealiseerd: pt.realized,
    prognose: pt.forecast,
    vorigJaar: showYoY ? getPrevYearValue(i) : null,
  }));

  const data = viewMode === "weekly" ? weeklyData : monthlyData;
  const yFormatter = formatYAxis(metric);
  const lastRealizedIdx = data.findLastIndex((d) => d.gerealiseerd !== null);

  const legendaItems: LegendaItem[] = [
    { label: "Gerealiseerd", kleur: theme.primary },
    { label: "Prognose", kleur: theme.primary },
    { label: "Verwacht", kleur: CHART_AXIS },
    ...(showYoY ? [{ label: "Vorig jaar", kleur: CHART_CATEGORICAL[6] }] : []),
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-rm-blue-ink uppercase tracking-wide">
            Performance {new Date().getFullYear()}
          </h3>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("weekly")}
              className={`px-2.5 py-1 text-meta font-medium rounded-md transition-colors ${
                viewMode === "weekly" ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground"
              }`}
            >
              Per week
            </button>
            <button
              onClick={() => setViewMode("monthly")}
              className={`px-2.5 py-1 text-meta font-medium rounded-md transition-colors ${
                viewMode === "monthly" ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground"
              }`}
            >
              Per maand
            </button>
          </div>
          <button
            onClick={() => setShowYoY(!showYoY)}
            className={`px-2.5 py-1 text-meta font-medium rounded-md border transition-colors ${
              showYoY
                ? "bg-purple-50 border-purple-200 text-purple-700"
                : "bg-gray-50 border-border text-muted-foreground hover:text-rm-gray"
            }`}
          >
            {showYoY ? "✓ " : ""}Vorig jaar
          </button>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(["conversions", "revenue", "roas", "cpa"] as ForecastMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === m
                  ? "bg-rm-blue text-white"
                  : "text-muted-foreground hover:text-rm-blue-ink"
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Budget recommendation banner */}
      {forecast.budgetRecommendation.behindTarget && metric === "conversions" && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 font-medium">
            Budget aanbeveling: {forecast.budgetRecommendation.spendIncreasePct > 0
              ? `Verhoog maandelijks budget met ${Math.round(forecast.budgetRecommendation.spendIncreasePct)}% `
              : ""}
            naar {new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(forecast.budgetRecommendation.requiredMonthlySpend)}/maand
            om het jaardoel te halen.
          </p>
        </div>
      )}

      {/* De legenda boven de plot; recharts zette hem onderaan als rij blokjes. Hier is hij ook
          verplicht: het palet haalt de kleurenblind-checks maar niet overal 3:1 tegen wit, en dan
          mag kleur niet de enige drager van identiteit zijn. */}
      <Legenda items={legendaItems} className="mb-3" />

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data}>
          <Raster />
          <XAxis
            dataKey="label"
            tick={{ fontSize: viewMode === "weekly" ? 9 : 11, fill: CHART_AXIS }}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            interval={viewMode === "weekly" ? 3 : 0}
          />
          <YAxis
            tickFormatter={yFormatter}
            tick={{ fontSize: 11, fill: CHART_AXIS }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={65}
          />
          <Tip formatter={yFormatter} />

          {lastRealizedIdx >= 0 && lastRealizedIdx < data.length - 1 && (
            <ReferenceLine
              x={data[lastRealizedIdx].label}
              stroke="#64748b"
              strokeDasharray="4 4"
              label={{ value: "Nu", position: "top", fontSize: 10, fill: "#64748b" }}
            />
          )}

          {/* Vorig jaar — een aparte categorische tint (violet), op de achtergrond. */}
          {showYoY && (
            <Line
              type="monotone"
              dataKey="vorigJaar"
              stroke={CHART_CATEGORICAL[6]}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={viewMode === "monthly" ? { r: 2, fill: CHART_CATEGORICAL[6] } : false}
              name="Vorig jaar"
              opacity={0.6}
              connectNulls
            />
          )}

          {/* Verwacht = de doel-/referentielijn: neutraal, niet met het merk concurreren. */}
          <Line
            type="monotone"
            dataKey="verwacht"
            stroke={CHART_AXIS}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={viewMode === "monthly" ? { r: 3 } : false}
            name="Verwacht"
            opacity={0.7}
            connectNulls
          />
          {/* Gerealiseerd + prognose = dezelfde reeks (echt → geprojecteerd): de merkkleur, solide vs streep. */}
          <Line
            type="monotone"
            dataKey="gerealiseerd"
            stroke={theme.primary}
            strokeWidth={2.5}
            dot={viewMode === "monthly" ? { r: 4 } : { r: 2 }}
            name="Gerealiseerd"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="prognose"
            stroke={theme.primary}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={viewMode === "monthly" ? { r: 3 } : false}
            name="Prognose"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
