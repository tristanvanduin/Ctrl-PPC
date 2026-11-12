"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { useGrafiekBeweging } from "@/lib/beweging";
import { useClientHistoricalData, useForecast } from "@/lib/client-data-provider";
import { useCountryFilteredData } from "@/lib/use-country-filtered-data";
import { computeForecast } from "@/lib/forecast";
import { usePeriod } from "@/lib/period/period-context";
import { slicePeriod } from "@/lib/period/apply-period";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_AXIS } from "@/lib/branding/chart-colors";
import { Tip, AsY, Raster, asSchaal, kortGetal, maandLabel } from "./chart-chrome";
import { MaandMetriekenPopover } from "./maand-metrieken-popover";

// Compacte staafdiagram voor de opener (17.34): de eigenaar vond de volledige PerformanceChart
// hier "veeeel te groot" -- die heeft vier metric-knoppen, een week/maand/jaar-omschakelaar, een
// vorig-jaar-toggle en een budgetadvies-banner, samen ruim 500px. Die blijft ongewijzigd staan bij
// "Jaaroverzicht 2026" voor wie de details wil; dit hier is alleen de laatste zes maanden
// conversies, geen bediening, ~140px vaste hoogte (of meegroeiend, zie `groeit`) -- past onder de
// kaart zonder de linkerkolom (pacing + donut + ranglijst) een enorm gat te laten trekken.
//
// Zelfde rekenkern als PerformanceChart (useForecast/computeForecast): geen tweede
// forecast-implementatie, alleen een kortere, kalere weergave van dezelfde maandpunten.
//
// VOLGT DE GEKOZEN PERIODE (bouwplan fase 2), om dezelfde reden als de CPA-lijn ernaast
// (monthly-trend-line.tsx): "laatste 6 maanden" stond boven de laatste zes punten van de prognose
// van het lopende jaar, met de komende maanden erbij als lichtere staven. De staven zijn nu de
// gemeten maanden van de gekozen periode, uit dezelfde maandreeks als de band: opgeteld geven ze
// het conversietotaal van de band. De prognose per maand staat in het jaaroverzicht en in het
// paneel achter een staaf.
export function MonthlyTrendBars({ clientId, countryFilter, groeit = false }: {
  clientId: string;
  countryFilter?: string | null;
  /** 17.37: laat de kaart de resterende hoogte van zijn flex-kolom opvullen (hogere staven i.p.v.
   *  een vaste 130px) -- alleen gebruikt in de opener, waar de kaart ernaast door een langere
   *  buurkolom soms meer ruimte krijgt dan de vaste hoogte nodig heeft. */
  groeit?: boolean;
}) {
  const beweging = useGrafiekBeweging();
  const { theme } = useBrandTheme();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const fullData = useClientHistoricalData(clientId);
  const clientData = useCountryFilteredData(clientId, countryFilter ?? null) ?? fullData;
  const gedeeld = useForecast();
  const forecast = gedeeld ?? computeForecast(clientData);
  const periode = usePeriod();
  const periodeStart = periode.range.start;
  const periodeEind = periode.range.end;
  // De gemeten maanden van de periode. Een maand zonder rij (vóór de start, of een gat) staat er
  // niet in en krijgt dus geen staaf: een staaf van nul zou een gemeten nul zijn.
  const maanden = useMemo(
    () => slicePeriod(clientData, { start: periodeStart, end: periodeEind }).months,
    [clientData, periodeStart, periodeEind],
  );

  const data = maanden.map((m) => ({ label: maandLabel(m.key), waarde: m.conversions }));

  const num = (v: number) => new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v);
  const { domain, tickCount } = asSchaal(Math.max(...data.map((d) => d.waarde ?? 0), 0));

  return (
    <div className={`bg-card rounded-xl border border-border p-4 shadow-sm ${groeit ? "h-full flex flex-col" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
        <h3 className="text-meta font-semibold text-brand-blue-ink uppercase tracking-wide">
          Conversies per maand
        </h3>
        <Vensterlabel soort="periode" />
      </div>
      {data.length === 0 ? (
        <p className={`flex items-center justify-center text-center text-body text-muted-foreground ${groeit ? "flex-1 min-h-[110px]" : "h-[130px]"}`}>
          Geen maand met data in deze periode.
        </p>
      ) : (
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
          <Bar {...beweging} dataKey="waarde" radius={[3, 3, 0, 0]} maxBarSize={48} onClick={(_, i) => setOpenIdx(i)} cursor="pointer">
            {data.map((_, i) => (
              <Cell key={i} fill={theme.primary} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
      )}

      {openIdx !== null && maanden[openIdx] && (
        <MaandMetriekenPopover maand={maanden[openIdx]} forecast={forecast} prognoseJaar={clientData.currentYear} onClose={() => setOpenIdx(null)} />
      )}
    </div>
  );
}
