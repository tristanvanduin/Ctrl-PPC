"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, ResponsiveContainer, type DotItemDotProps } from "recharts";
import { useGrafiekBeweging } from "@/lib/beweging";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { usePeriod } from "@/lib/period/period-context";
import { slicePeriod } from "@/lib/period/apply-period";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_AXIS } from "@/lib/branding/chart-colors";
import { Tip, AsY, Raster, asSchaalVenster, kortEuro, maandLabel } from "./chart-chrome";
import { MaandMetriekenPopover } from "./maand-metrieken-popover";

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
//
// VOLGT DE GEKOZEN PERIODE (bouwplan fase 2). Er stond "laatste 6 maanden" boven de laatste zes
// punten van de PROGNOSE van het lopende jaar: juli t/m december, met de maanden die nog moeten
// komen erbij. Dat was niet wat het label zei, en het bewoog niet als je de periode verzette. De
// lijn loopt nu over de gemeten maanden van de gekozen periode, uit dezelfde maandreeks als de
// band (slicePeriod): geen verzoek, en dezelfde CPA als de band over dezelfde maanden. De
// prognose per maand staat in het jaaroverzicht en in het paneel achter een punt.
export function MonthlyTrendLine({ clientId, countryFilter }: { clientId: string; countryFilter?: string | null }) {
  const { theme } = useBrandTheme();
  const beweging = useGrafiekBeweging();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const periode = usePeriod();
  const periodeStart = periode.range.start;
  const periodeEind = periode.range.end;
  // De gemeten maanden van de periode; een maand zonder rij staat er niet in (geen punt, geen nul).
  const maanden = useMemo(
    () => slicePeriod(clientData, { start: periodeStart, end: periodeEind }).months,
    [clientData, periodeStart, periodeEind],
  );

  // Zonder conversies bestaat er geen CPA: een gat in de lijn, geen nul.
  const data = maanden.map((m) => ({
    label: maandLabel(m.key),
    waarde: m.conversions > 0 ? m.adSpend / m.conversions : null,
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
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
        <h3 className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide">
          CPA per maand
        </h3>
        <Vensterlabel soort="periode" />
      </div>
      {waarden.length === 0 ? (
        // De periode heeft geen maand met conversies (of geen maand met data): dat zeggen, in
        // plaats van een leeg assenkruis dat leest als "de CPA was nul".
        <p className="flex min-h-[130px] flex-1 items-center justify-center text-center text-body text-muted-foreground">
          Geen maand met conversies in deze periode, dus geen CPA om te tonen.
        </p>
      ) : (
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
            {...beweging}
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
      )}

      {openIdx !== null && maanden[openIdx] && (
        <MaandMetriekenPopover maand={maanden[openIdx]} forecast={forecast} prognoseJaar={clientData.currentYear} onClose={() => setOpenIdx(null)} />
      )}
    </div>
  );
}
