"use client";

import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_AXIS } from "@/lib/branding/chart-colors";
import { Tip } from "./chart-chrome";

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
  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const points = forecast.conversions.points.slice(-6);

  const data = points.map((pt) => ({
    label: pt.monthLabel,
    waarde: pt.realized ?? pt.forecast ?? 0,
    prognose: pt.realized === null,
  }));

  const num = (v: number) => new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v);

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
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: CHART_AXIS }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <Tip formatter={num} />
          <Bar dataKey="waarde" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {data.map((d, i) => (
              <Cell key={i} fill={theme.primary} opacity={d.prognose ? 0.4 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
