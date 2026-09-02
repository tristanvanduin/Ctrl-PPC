"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Target, DollarSign, BarChart3, Wallet } from "lucide-react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import { today as vandaag } from "@/lib/reporting-date";
import { resolveChannelConversionConfig, sumSelectedConversions, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { buildChannelForecast } from "@/lib/analysis/channel-forecast-data";
import type { TargetRow } from "@/lib/analysis/o2-targets-cost";
import { actieveMetrics, type ClientForecast, type ForecastMetric } from "@/lib/forecast";
import type { ClientHistoricalData } from "@/lib/types";
import { formatCurrency, formatDeltaPercent, formatNumber, formatRoas, formatterFor, isLowerBetter, METRIC_LABELS } from "@/lib/forecast-format";
import { useBrandTheme } from "../branding/brand-theme-provider";
import { CHART_CATEGORICAL, CHART_AXIS } from "@/lib/branding/chart-colors";
import { Raster, Tip, Legenda, type LegendaItem } from "./chart-chrome";
import { Kerncijfer } from "@/components/ui/kerncijfer";
import { KlikbareKaart } from "@/components/ui/klikbare-kaart";
import { Laadvlak } from "@/components/ui/laadvlak";
import { CONFIG, type ChannelKind, type DailyRow } from "./channel-performance";

// Meta/LinkedIn-equivalent van Google's "Jaaroverzicht 2026" (23 augustus 2026). computeForecast()
// (lib/forecast.ts) is zelf al kanaalneutraal; dit bestand levert het stuk dat dat voor Google nog
// niet was: de databron (hier de eigen account-tabel van het kanaal, over de volledige historie in
// plaats van Google's /api/google-ads/client-data) en het jaardoel (hier client_targets, kanaal-
// gescoopt -- zie channel-forecast-data.ts voor de volledige toelichting).
//
// Geen eigen jaardoel-invoerscherm in deze ronde (net als Google trouwens ook geen apart scherm
// heeft voor client_targets): zonder ingesteld doel valt de forecast terug op het historisch totaal,
// exact zoals hij dat voor Google ook al doet bij een leeg kpiTargets-doel.

const TARGET_CHANNEL: Record<ChannelKind, string> = { meta: "meta_ads", linkedin: "linkedin_ads", microsoft: "microsoft_ads" };

/** null = nog aan het laden, "leeg" = geen dagcijfers gesynced, anders de opgebouwde forecast. */
export type ChannelForecastState = { data: ClientHistoricalData; forecast: ClientForecast } | null | "leeg";

function formatYAxis(metric: ForecastMetric) {
  if (metric === "revenue") return (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 0 }).format(v);
  if (metric === "roas") return (v: number) => `${v.toFixed(1)}x`;
  if (metric === "cpa") return (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  return (v: number) => new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v);
}

/** De forecast én de historische data waaruit hij is opgebouwd. Dat tweede is nodig zodra een
 *  andere weergave dan de jaargrafiek hem gebruikt: FairWeeksOverview leest `data.currentYear` om
 *  de weken tegen het jaardoel af te zetten. Geëxporteerd zodat meta-view en linkedin-view de
 *  beurs-sectie kunnen voeden zonder de fetch nog een keer te schrijven. */
export function useChannelForecast(clientId: string, channel: ChannelKind): ChannelForecastState {
  const [forecast, setForecast] = useState<ChannelForecastState>(null);
  const cfg = CONFIG[channel];

  useEffect(() => {
    let cancelled = false;
    setForecast(null);

    Promise.all([
      // Geen datumfilter: de forecast heeft de volle historie nodig om jaren te kunnen wegen
      // (lib/forecast.ts's computeMonthlyExpected) -- ChannelPerformance's 200-dagen-venster is
      // hier bewust niet hergebruikt.
      dbSelect<Record<string, unknown>>(cfg.accountTable, { select: cfg.select, clientId }),
      dbSelect<{ channel: string; metric: string; target_value: number; valid_from: string; valid_to: string | null }>(
        "client_targets", { select: "channel, metric, target_value, valid_from, valid_to", clientId },
      ),
      dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId }),
    ]).then(([accRes, targetRes, settingsRes]) => {
      if (cancelled) return;
      const dailyRows = ((accRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map);
      const convConfig: ChannelConversionConfig = resolveChannelConversionConfig(
        (settingsRes.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null,
      );
      const rows = dailyRows.map((r: DailyRow) => ({
        date: r.date, spend: r.spend, revenue: r.revenue,
        conv: sumSelectedConversions(r.convFields, cfg.channelKey, convConfig),
      }));
      const targetRows: TargetRow[] = (targetRes.data ?? []).map((r) => ({
        channel: r.channel, metric: r.metric, targetValue: Number(r.target_value ?? 0),
        validFrom: r.valid_from, validTo: r.valid_to,
      }));
      const built = buildChannelForecast(clientId, rows, targetRows, TARGET_CHANNEL[channel], vandaag());
      setForecast(built ?? "leeg");
    }, () => { if (!cancelled) setForecast("leeg"); });

    return () => { cancelled = true; };
  }, [clientId, channel, cfg]);

  return forecast;
}

function KpiTegel({ metric, forecast, geselecteerd, onKies }: {
  metric: ForecastMetric;
  forecast: ClientForecast;
  geselecteerd?: boolean;
  onKies?: (m: ForecastMetric) => void;
}) {
  const ICON: Record<ForecastMetric, ReactNode> = {
    conversions: <Target className="w-4 h-4 text-brand-blue-ink" />,
    revenue: <DollarSign className="w-4 h-4 text-brand-blue-ink" />,
    roas: <BarChart3 className="w-4 h-4 text-brand-blue-ink" />,
    cpa: <Wallet className="w-4 h-4 text-brand-blue-ink" />,
  };
  const kpi = forecast[metric].kpi;
  const format = formatterFor(metric);
  // isLowerBetter, net als elke andere metric-consument: zonder deze check kleurde een
  // sléchtere CPA (diffPct >= 0) groen — precies de "gemiste plek kleurt rood groen" waar
  // lib/forecast-format.ts voor waarschuwt (sloop-audit 1 sep 2026).
  const isPositive = isLowerBetter(metric) ? kpi.diffPct <= 0 : kpi.diffPct >= 0;
  // De voortgangsbalk "X% van het jaardoel gerealiseerd" is voor een verhoudingsmetric
  // (CPA, ROAS) betekenisloos: je realiseert geen 60% van een doel-CPA. Verberg hem daar.
  const toonVoortgang = metric === "conversions" || metric === "revenue";
  const realizedPct = kpi.annualTarget > 0 ? (kpi.ytdRealized / kpi.annualTarget) * 100 : 0;

  return (
    // Klikbaar, net als Google's jaaroverzicht-kaartjes: een klik zet de grafiek eronder op deze
    // metric. Dezelfde schil (components/ui/klikbare-kaart.tsx), zodat rol, tabvolgorde en
    // toetsbediening op beide tabbladen hetzelfde zijn.
    <KlikbareKaart waarde={metric} geselecteerd={geselecteerd} onKies={onKies}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-brand-blue/10 flex items-center justify-center">{ICON[metric]}</div>
        <h3 className="text-title font-semibold text-brand-blue-ink">{METRIC_LABELS[metric]}</h3>
      </div>
      <div className="mb-4">
        <Kerncijfer label="Gerealiseerd YTD" waarde={format(kpi.ytdRealized)} />
      </div>
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">{kpi.annualTarget > 0 ? "Jaardoel" : "Jaardoel (geen ingesteld — historisch totaal)"}</span>
          <span className="text-xs font-semibold text-brand-gray">{format(kpi.annualTarget)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Jaarprognose</span>
          <span className="text-xs font-semibold text-brand-blue-ink">{format(kpi.adjustedAnnual)}</span>
        </div>
      </div>
      {kpi.annualTarget > 0 && (
        <div>
          <div className="flex justify-between text-micro mb-1.5">
            <span className="text-muted-foreground">{toonVoortgang ? `${Math.round(realizedPct)}% gerealiseerd` : "t.o.v. doel"}</span>
            <span className={`font-bold ${isPositive ? "text-green-600" : "text-red-500"}`}>{formatDeltaPercent(kpi.diffPct)}</span>
          </div>
          {toonVoortgang && (
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${isPositive ? "bg-gradient-to-r from-green-400 to-green-500" : "bg-gradient-to-r from-red-400 to-red-500"}`}
                style={{ width: `${Math.min(realizedPct, 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </KlikbareKaart>
  );
}

function ForecastChart({ forecast, metric, onMetricChange }: { forecast: ClientForecast; metric: ForecastMetric; onMetricChange: (m: ForecastMetric) => void }) {
  const { theme } = useBrandTheme();
  const result = forecast[metric];
  const data = result.points.map((pt) => ({ label: pt.monthLabel, verwacht: pt.expected, gerealiseerd: pt.realized, prognose: pt.forecast }));
  const yFormatter = formatYAxis(metric);
  const lastRealizedIdx = data.findLastIndex((d) => d.gerealiseerd !== null);

  const legendaItems: LegendaItem[] = [
    { label: "Gerealiseerd", kleur: theme.primary },
    { label: "Prognose", kleur: theme.primary },
    { label: "Verwacht", kleur: CHART_AXIS },
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Prognose per maand</h3>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {actieveMetrics(forecast).map((m) => (
            <button
              key={m}
              onClick={() => onMetricChange(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${metric === m ? "bg-brand-blue text-white" : "text-muted-foreground hover:text-brand-blue-ink"}`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <Legenda items={legendaItems} className="mb-3" />
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <Raster />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_AXIS }} tickLine={false} axisLine={false} tickMargin={10} />
          <YAxis tickFormatter={yFormatter} tick={{ fontSize: 11, fill: CHART_AXIS }} tickLine={false} axisLine={false} tickMargin={8} width={65} />
          <Tip formatter={yFormatter} />
          {lastRealizedIdx >= 0 && lastRealizedIdx < data.length - 1 && (
            <ReferenceLine x={data[lastRealizedIdx].label} stroke="#64748b" strokeDasharray="4 4" label={{ value: "Nu", position: "top", fontSize: 10, fill: "#64748b" }} />
          )}
          <Line type="monotone" dataKey="verwacht" stroke={CHART_AXIS} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 3 }} name="Verwacht" opacity={0.7} connectNulls />
          <Line type="monotone" dataKey="gerealiseerd" stroke={theme.primary} strokeWidth={2.5} dot={{ r: 4 }} name="Gerealiseerd" connectNulls />
          <Line type="monotone" dataKey="prognose" stroke={theme.primary} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} name="Prognose" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChannelForecastOverview({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const gebouwd = useChannelForecast(clientId, channel);
  const [metric, setMetric] = useState<ForecastMetric>("conversions");

  if (gebouwd === null) return <Laadvlak vorm="grafiek" hoogte={280} titel="Jaaroverzicht" />;
  if (gebouwd === "leeg") return null; // geen dagcijfers gesynced: niets te tonen
  const forecast = gebouwd.forecast;

  const actief = actieveMetrics(forecast);
  const zichtbareMetric = actief.includes(metric) ? metric : actief[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {actief.map((m) => (
          <KpiTegel
            key={m}
            metric={m}
            forecast={forecast}
            geselecteerd={zichtbareMetric === m}
            onKies={setMetric}
          />
        ))}
      </div>
      <ForecastChart forecast={forecast} metric={zichtbareMetric} onMetricChange={setMetric} />
    </div>
  );
}
