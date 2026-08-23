// Bouwt een ClientHistoricalData/ClientForecast voor Meta en LinkedIn uit hun eigen dag-tabellen,
// voor het Meta/LinkedIn-equivalent van Google's "Jaaroverzicht 2026" (23 augustus 2026).
//
// computeForecast() (lib/forecast.ts) is zelf al kanaalneutraal -- hij rekent op ClientHistoricalData,
// niet op iets Google-specifieks. Wat wél Google-specifiek was: de databron (/api/google-ads/
// client-data via lib/api/adapter.ts) en het jaardoel (client_settings.kpiTargets). Dit bestand is het
// Meta/LinkedIn-equivalent van dat eerste stuk, hergebruikt buildClientDataFromApi (dezelfde adapter
// die Google al gebruikt) en leest het jaardoel uit client_targets -- de kanaal-gescoopte tabel die
// hier al voor bestond (migratie 002/082, fase 2 MASTERPLAN.md) maar nog geen jaardoel-UI heeft. Geen
// ingevuld doel is geen fout: computeForecast() valt dan terug op het historisch totaal, exact zoals
// hij dat voor Google ook al doet.

import type { ClientAnnualData, ClientHistoricalData } from "@/lib/types";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "@/lib/api/adapter";
import { computeForecast, type ClientForecast } from "@/lib/forecast";
import { resolveTargets, type TargetRow } from "./o2-targets-cost";

export interface ChannelForecastRow {
  /** YYYY-MM-DD */
  date: string;
  spend: number;
  conv: number;
  revenue: number;
}

// Zelfde patroon als lib/api/adapter.ts's generateEvenWeeks: welke maanden vijf periodes van
// zeven dagen krijgen i.p.v. vier. Hier verdelen we ECHTE dagcijfers over die periodes, dus zonder
// de afronding die een gelijke verdeling nodig had.
function weeksInMonth(month: number): number {
  return [1, 3, 5, 7, 8, 10, 12].includes(month) ? 5 : 4;
}

function weekOfDay(day: number, month: number): number {
  return Math.min(Math.ceil(day / 7), weeksInMonth(month));
}

function emptyMonthly(month: number): ApiMonthlyData {
  return { month, conversions: 0, revenue: 0, adSpend: 0, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 };
}

/** Groepeert dagrijen per jaar in maand- en weektotalen, in de vorm die de gedeelde adapter verwacht. */
function aggregateByYear(rows: ChannelForecastRow[]): Map<number, { monthly: ApiMonthlyData[]; weekly: ApiWeeklyData[] }> {
  const perYear = new Map<number, { monthly: Map<number, ApiMonthlyData>; weekly: Map<string, ApiWeeklyData> }>();

  for (const r of rows) {
    const [yStr, mStr, dStr] = r.date.split("-");
    const year = Number(yStr), month = Number(mStr), day = Number(dStr);
    if (!year || !month || !day) continue;

    let bucket = perYear.get(year);
    if (!bucket) { bucket = { monthly: new Map(), weekly: new Map() }; perYear.set(year, bucket); }

    const m = bucket.monthly.get(month) ?? emptyMonthly(month);
    m.conversions += r.conv; m.revenue += r.revenue; m.adSpend += r.spend;
    bucket.monthly.set(month, m);

    const week = weekOfDay(day, month);
    const key = `${month}-${week}`;
    const w = bucket.weekly.get(key) ?? { week, month, conversions: 0, revenue: 0, adSpend: 0 };
    w.conversions += r.conv; w.revenue += r.revenue; w.adSpend += r.spend;
    bucket.weekly.set(key, w);
  }

  const out = new Map<number, { monthly: ApiMonthlyData[]; weekly: ApiWeeklyData[] }>();
  for (const [year, bucket] of perYear) {
    out.set(year, { monthly: [...bucket.monthly.values()], weekly: [...bucket.weekly.values()] });
  }
  return out;
}

/**
 * @param todayIso vandaag als YYYY-MM-DD (lib/reporting-date's today()) -- bepaalt het huidige jaar
 *   en hoeveel maanden daarvan als "gerealiseerd" tellen (de rest wordt null, voor projectie).
 */
export function buildChannelHistoricalData(
  clientId: string,
  rows: ChannelForecastRow[],
  targetCurrentYear: ClientAnnualData,
  todayIso: string,
): ClientHistoricalData | null {
  if (rows.length === 0) return null;

  const currentYear = Number(todayIso.slice(0, 4));
  const realizedThroughMonth = Number(todayIso.slice(5, 7));
  const byYear = aggregateByYear(rows);

  const historicalYearsInput: YearDataInput[] = [...byYear.entries()]
    .filter(([year]) => year < currentYear)
    .sort(([a], [b]) => a - b)
    .map(([year, { monthly, weekly }]) => ({ year, monthly, weekly }));

  const current = byYear.get(currentYear) ?? { monthly: [], weekly: [] };

  return buildClientDataFromApi(
    clientId, historicalYearsInput, current.monthly, current.weekly,
    targetCurrentYear, currentYear, realizedThroughMonth,
  );
}

/**
 * @param targetChannel client_targets' channel-waarde: "meta_ads" of "linkedin_ads".
 *
 * Jaardoel: alleen conversions/conversion_value/spend uit client_targets (de kanaal-brede
 * jaargrootheden). Een eventuele losse cpa/roas-rij (zoals meta-briefing die al leest) wordt hier
 * bewust niet gebruikt -- forecast.cpa/roas leiden hun eigen doel af uit spend/conversions-doelen,
 * consistent met hoe elke andere metric hier werkt. Er is nog geen scherm om deze doelen in te
 * vullen (net als bij Google); zonder doel valt computeForecast() terug op het historisch totaal.
 */
export function buildChannelForecast(
  clientId: string,
  rows: ChannelForecastRow[],
  targetRows: TargetRow[],
  targetChannel: string,
  todayIso: string,
): { data: ClientHistoricalData; forecast: ClientForecast } | null {
  const targets = resolveTargets(targetRows, targetChannel, todayIso);
  const targetCurrentYear: ClientAnnualData = {
    conversions: targets.conversions ?? 0,
    revenue: targets.conversion_value ?? 0,
    adSpend: targets.spend ?? 0,
  };

  const data = buildChannelHistoricalData(clientId, rows, targetCurrentYear, todayIso);
  if (!data) return null;
  return { data, forecast: computeForecast(data) };
}
