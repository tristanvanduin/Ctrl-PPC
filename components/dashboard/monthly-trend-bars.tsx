"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { ALLE_FORECAST_METRICS, computeForecast } from "@/lib/forecast";
import { METRIC_LABELS, formatPercent, formatterFor, isLowerBetter } from "@/lib/forecast-format";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_AXIS } from "@/lib/branding/chart-colors";
import { Tip, AsY, Raster, asSchaal, kortGetal } from "./chart-chrome";
import { PeriodPopover } from "@/components/ui/period-popover";

// Compacte staafdiagram voor de opener (17.34): de eigenaar vond de volledige PerformanceChart
// hier "veeeel te groot" -- die heeft vier metric-knoppen, een week/maand/jaar-omschakelaar, een
// vorig-jaar-toggle en een budgetadvies-banner, samen ruim 500px. Die blijft ongewijzigd staan bij
// "Jaaroverzicht 2026" voor wie de details wil; dit hier is alleen de laatste zes maanden
// conversies, geen bediening, ~140px vaste hoogte (of meegroeiend, zie `groeit`) -- past onder de
// kaart zonder de linkerkolom (pacing + donut + ranglijst) een enorm gat te laten trekken.
//
// Zelfde rekenkern als PerformanceChart (useForecast/computeForecast): geen tweede
// forecast-implementatie, alleen een kortere, kalere weergave van dezelfde maandpunten.
export function MonthlyTrendBars({ clientId, countryFilter, groeit = false }: {
  clientId: string;
  countryFilter?: string | null;
  /** 17.37: laat de kaart de resterende hoogte van zijn flex-kolom opvullen (hogere staven i.p.v.
   *  een vaste 130px) -- alleen gebruikt in de opener, waar de kaart ernaast door een langere
   *  buurkolom soms meer ruimte krijgt dan de vaste hoogte nodig heeft. */
  groeit?: boolean;
}) {
  const { theme } = useBrandTheme();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const alleConversiePunten = forecast.conversions.points;
  const points = alleConversiePunten.slice(-6);
  // Index in `points` (0..5) → index in het volle, ongesnoeide array, want de popover leest
  // dezelfde maand bij de andere drie metrics op, en die arrays lopen 1-op-1 met dit array.
  const offset = alleConversiePunten.length - points.length;

  const data = points.map((pt) => ({
    label: pt.monthLabel,
    waarde: pt.realized ?? pt.forecast ?? 0,
    prognose: pt.realized === null,
  }));

  const num = (v: number) => new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v);
  const { domain, tickCount } = asSchaal(Math.max(...data.map((d) => d.waarde), 0));

  return (
    <div className={`bg-card rounded-xl border border-border p-4 shadow-sm ${groeit ? "h-full flex flex-col" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide">
          Conversies per maand
        </h3>
        <span className="text-micro text-muted-foreground">laatste 6 maanden</span>
      </div>
      <div className={groeit ? "flex-1 min-h-[110px]" : ""}>
      <ResponsiveContainer width="100%" height={groeit ? "100%" : 130}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <Raster />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: CHART_AXIS }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <AsY formatter={kortGetal} width={36} domain={domain} tickCount={tickCount} />
          <Tip formatter={num} />
          <Bar dataKey="waarde" radius={[3, 3, 0, 0]} maxBarSize={48} onClick={(_, i) => setOpenIdx(i)} cursor="pointer">
            {data.map((d, i) => (
              <Cell key={i} fill={theme.primary} opacity={d.prognose ? 0.4 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>

      {openIdx !== null && (() => {
        const idx = offset + openIdx;
        const label = points[openIdx]?.monthLabel ?? "";
        return (
          <PeriodPopover
            title={label}
            subtitle="Alle vier de metrics voor deze maand"
            onClose={() => setOpenIdx(null)}
          >
            <div className="space-y-3">
              {ALLE_FORECAST_METRICS.map((m) => {
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
