"use client";

import { LineChart, Line, XAxis, ResponsiveContainer } from "recharts";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_AXIS } from "@/lib/branding/chart-colors";
import { Tip, AsY, Raster, asSchaalLijn, kortEuro } from "./chart-chrome";

// Compacte lijngrafiek voor de linkerkolom van de opener (17.43): "ik mis de lijn diagram nog" --
// het kleine resterende hoogteverschil met de rechterkolom (kaart+grafiek+ranglijst) vult zich nu
// met CPA per maand, in plaats van nog een keer conversies (die staan al als staven rechts,
// MonthlyTrendBars). CPA past ook inhoudelijk beter bij de linkerkolom: Account Health en Pacing
// gaan over presteren/op-schema-zijn, en efficiëntie op maandschaal is dezelfde vraag. ROAS was de
// eerste keuze, maar bleek bij demo-greentech vrijwel constant (een vlakke lijn zonder signaal) --
// CPA (adSpend/conversions) volgt dezelfde spend- en conversieschommelingen als de staven rechts
// en de "Performance 2026"-grafiek verderop, en toont dus wél een trend.
//
// Zelfde rekenkern als MonthlyTrendBars/PerformanceChart (useForecast/computeForecast): geen
// tweede forecast-implementatie, alleen een kortere, kalere weergave -- nu van forecast.cpa
// i.p.v. forecast.conversions.
export function MonthlyTrendLine({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const { theme } = useBrandTheme();
  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const points = forecast.cpa.points.slice(-6);

  const data = points.map((pt) => ({
    label: pt.monthLabel,
    waarde: pt.realized ?? pt.forecast ?? null,
  }));

  const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const waarden = data.map((d) => d.waarde).filter((w): w is number => w !== null);
  const { domain, tickCount } = asSchaalLijn(Math.max(...waarden, 0));

  return (
    <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide">
          CPA per maand
        </h3>
        <span className="text-micro text-muted-foreground">laatste 6 maanden</span>
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <Raster />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: CHART_AXIS }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <AsY formatter={kortEuro} width={44} domain={domain} tickCount={tickCount} />
          <Tip formatter={eur} />
          <Line
            type="monotone"
            dataKey="waarde"
            stroke={theme.primary}
            strokeWidth={2.5}
            dot={{ r: 3, fill: theme.primary }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
