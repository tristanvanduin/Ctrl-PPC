"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, ResponsiveContainer, type DotItemDotProps } from "recharts";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { ALLE_FORECAST_METRICS, computeForecast } from "@/lib/forecast";
import { METRIC_LABELS, formatPercent, formatterFor, isLowerBetter } from "@/lib/forecast-format";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_AXIS } from "@/lib/branding/chart-colors";
import { Tip, AsY, Raster, asSchaalVenster, kortEuro } from "./chart-chrome";
import { PeriodPopover } from "@/components/ui/period-popover";

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
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const alleCpaPunten = forecast.cpa.points;
  const points = alleCpaPunten.slice(-6);
  // Zie monthly-trend-bars.tsx voor dezelfde redenering: de popover leest de andere metrics op
  // via het volle, ongesnoeide array, dus moet de lokale 0..5-index eerst terug omgerekend.
  const offset = alleCpaPunten.length - points.length;

  const data = points.map((pt) => ({
    label: pt.monthLabel,
    waarde: pt.realized ?? pt.forecast ?? null,
  }));

  const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const waarden = data.map((d) => d.waarde).filter((w): w is number => w !== null);
  // Een venster om de data en niet vanaf nul: CPA is een verhouding, en op een as van 0 tot 75
  // lag deze lijn zes maanden kaarsrecht terwijl hij tussen 68 en 72 euro bewoog. Zie
  // asSchaalVenster voor waarom dat bij een balk juist NIET mag.
  const { domain, tickCount, ticks } = asSchaalVenster(Math.min(...waarden), Math.max(...waarden, 0));

  return (
    // De grafiek pakt de resthoogte (`flex-1` + ResponsiveContainer op 100%) in plaats van vast
    // op 130px te blijven: een lijngrafiek wordt beter leesbaar van meer hoogte, dus dat is inhoud
    // en geen opvulling. Geen `h-full` op de kaart zelf: als rastercel rekt hij al vanzelf, en in
    // een flex-kolom zou hij dan de opvanger van die kolom leegroven (zie google-view.tsx).
    <div className="bg-card flex flex-col rounded-xl border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide">
          CPA per maand
        </h3>
        <span className="text-micro text-muted-foreground">laatste 6 maanden</span>
      </div>
      <div className="min-h-[130px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <Raster />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: CHART_AXIS }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <AsY formatter={kortEuro} width={44} domain={domain} tickCount={tickCount} ticks={ticks} />
          <Tip formatter={eur} />
          <Line
            type="monotone"
            dataKey="waarde"
            stroke={theme.primary}
            strokeWidth={2.5}
            dot={(props: DotItemDotProps) => {
              const { cx, cy, index, key } = props;
              if (cx == null || cy == null) return <g key={key} />;
              return (
                <circle
                  key={key}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={theme.primary}
                  style={{ cursor: "pointer" }}
                  onClick={() => setOpenIdx(index)}
                />
              );
            }}
            connectNulls
          />
        </LineChart>
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
