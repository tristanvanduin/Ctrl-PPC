/**
 * Unified data adapter
 *
 * Maps Google Ads and Meta Ads API responses into the dashboard's
 * ClientHistoricalData format so the forecast engine, charts, and
 * insights work unchanged regardless of data source.
 */

import type { MonthlyRecord, WeeklyRecord, ClientHistoricalData, ClientAnnualData } from "../types";
import type { GoogleAdsMetrics } from "./google-ads";
import type { MetaParsedMetrics } from "./meta-ads";

// ── Types ────────────────────────────────────────────────────────────────────

export type DataSource = "google-ads" | "meta-ads" | "combined";

export interface ApiMonthlyData {
  month: number; // 1-12
  conversions: number;
  revenue: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  conversionRate: number;
}

export interface ApiWeeklyData {
  week: number; // 1-5 within month
  month: number;
  conversions: number;
  revenue: number;
  adSpend: number;
}

// ── Google Ads → Dashboard Format ────────────────────────────────────────────

function parseMonth(dateStr: string): number {
  // Google Ads returns YYYY-MM-DD (first of month) or YYYY-MM
  const parts = dateStr.split("-");
  return parseInt(parts[1], 10);
}

/**
 * Het Google Ads-klantnummer bij een klant-id: het id zonder "gads-". De browser vraagt
 * /api/google-ads/client-data op met dit nummer (lib/use-client-data.ts), en de server leest
 * hetzelfde antwoord voor het zaad (lib/overzicht/zaad-server.ts). Eén plek, zodat de twee
 * nooit een ander account lezen.
 */
export function googleKlantnummer(clientId: string): string {
  return clientId.replace("gads-", "");
}

export function googleAdsMonthlyToApiData(
  metrics: GoogleAdsMetrics[]
): ApiMonthlyData[] {
  return metrics.map((m) => ({
    month: parseMonth(m.date),
    conversions: Math.round(m.conversions),
    revenue: Math.round(m.conversionsValue),
    adSpend: Math.round(m.cost),
    impressions: m.impressions,
    clicks: m.clicks,
    ctr: m.ctr,
    avgCpc: m.avgCpc,
    conversionRate: m.conversionRate,
  }));
}

/**
 * Weekrijen (segments.week: de maandag van de week) naar ApiWeeklyData: per kalendermaand een
 * volgnummer 1..5, in datumvolgorde.
 *
 * Het volgnummer IS de positie in de rij, dus de volgorde van de invoer bepaalt welke week welk
 * nummer krijgt. De query had geen ORDER BY, en de rijen werden genummerd zoals ze binnenkwamen:
 * week 3 kon dan de laatste maandag van de maand zijn. Daarom eerst sorteren (op een kopie; de
 * aanroeper houdt zijn array).
 *
 * Genummerd wordt per JAAR en maand, niet per maandnummer alleen. Kreeg deze functie vijf jaar
 * weekrijen in één keer, dan werden alle maarten samen één maart met tweeëntwintig "weken", en
 * dat rooster liep door tot in de beursweekstrook. De uitvoer heeft geen jaarveld, dus wie meer
 * dan één jaar heeft, splitst eerst: googleAdsWeeklyByYear.
 */
export function googleAdsWeeklyToApiData(
  metrics: GoogleAdsMetrics[]
): ApiWeeklyData[] {
  const opDatum = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const volgnummer = new Map<string, number>();
  return opDatum.map((wm) => {
    const jaarMaand = wm.date.slice(0, 7);
    const week = (volgnummer.get(jaarMaand) ?? 0) + 1;
    volgnummer.set(jaarMaand, week);
    return {
      week,
      month: parseMonth(wm.date),
      conversions: Math.round(wm.conversions),
      revenue: Math.round(wm.conversionsValue),
      adSpend: Math.round(wm.cost),
    };
  });
}

/**
 * Weekrijen over meerdere jaren, per jaar omgezet: jaar -> ApiWeeklyData[] (oplopend op jaar).
 *
 * Splitsen gebeurt op de RUWE rij, vóór de omzetting. De route zette eerst alles om en zocht
 * daarna het jaar erbij via de index (raw[i] bij mapped[i]), maar de omzetting groepeerde per
 * maand en gooide de volgorde om: mapped[i] was dan een andere week dan raw[i]. Met vijf jaar
 * historie kwamen er zo 22 weekrecords in één oktober terecht, en de strook rond de beurs liet
 * septembercijfers zien in een novemberweek.
 *
 * Een week hoort bij het jaar van zijn maandag, net zoals hij bij de maand van zijn maandag hoort:
 * de week van maandag 30 december 2024 is december 2024, ook al lopen er januaridagen in mee.
 * Rijen zonder leesbaar jaar vallen weg; ze hebben geen plek in een jaarrooster.
 */
export function googleAdsWeeklyByYear(
  metrics: GoogleAdsMetrics[]
): Map<number, ApiWeeklyData[]> {
  const perJaar = new Map<number, GoogleAdsMetrics[]>();
  for (const r of metrics) {
    const jaar = parseInt(r.date.slice(0, 4), 10);
    if (!Number.isInteger(jaar)) continue;
    const rijen = perJaar.get(jaar);
    if (rijen) rijen.push(r);
    else perJaar.set(jaar, [r]);
  }
  return new Map(
    [...perJaar.entries()]
      .sort(([a], [b]) => a - b)
      .map(([jaar, rijen]) => [jaar, googleAdsWeeklyToApiData(rijen)] as const),
  );
}

// ── Meta Ads → Dashboard Format ──────────────────────────────────────────────

function metaParseMonth(dateStr: string): number {
  const parts = dateStr.split("-");
  return parseInt(parts[1], 10);
}

export function metaAdsMonthlyToApiData(
  metrics: MetaParsedMetrics[]
): ApiMonthlyData[] {
  return metrics.map((m) => ({
    month: metaParseMonth(m.dateStart),
    conversions: Math.round(m.conversions),
    revenue: Math.round(m.conversionsValue),
    adSpend: Math.round(m.spend),
    impressions: m.impressions,
    clicks: m.clicks,
    ctr: m.ctr,
    avgCpc: m.cpc,
    conversionRate: m.conversions > 0 && m.clicks > 0 ? m.conversions / m.clicks : 0,
  }));
}

export function metaAdsWeeklyToApiData(
  metrics: MetaParsedMetrics[]
): ApiWeeklyData[] {
  const byMonth = new Map<number, MetaParsedMetrics[]>();
  for (const m of metrics) {
    const month = metaParseMonth(m.dateStart);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(m);
  }

  const result: ApiWeeklyData[] = [];
  for (const [month, weekMetrics] of byMonth) {
    weekMetrics.forEach((wm, i) => {
      result.push({
        week: i + 1,
        month,
        conversions: Math.round(wm.conversions),
        revenue: Math.round(wm.conversionsValue),
        adSpend: Math.round(wm.spend),
      });
    });
  }
  return result;
}

// ── Combine Google Ads + Meta Ads ────────────────────────────────────────────

export function combineApiData(
  googleMonthly: ApiMonthlyData[],
  metaMonthly: ApiMonthlyData[]
): ApiMonthlyData[] {
  const combined = new Map<number, ApiMonthlyData>();

  // Start with Google Ads data
  for (const gm of googleMonthly) {
    combined.set(gm.month, { ...gm });
  }

  // Add Meta data on top
  for (const mm of metaMonthly) {
    const existing = combined.get(mm.month);
    if (existing) {
      existing.conversions += mm.conversions;
      existing.revenue += mm.revenue;
      existing.adSpend += mm.adSpend;
      existing.impressions += mm.impressions;
      existing.clicks += mm.clicks;
      // Recalculate rates
      existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
      existing.avgCpc = existing.clicks > 0 ? existing.adSpend / existing.clicks : 0;
      existing.conversionRate = existing.clicks > 0 ? existing.conversions / existing.clicks : 0;
    } else {
      combined.set(mm.month, { ...mm });
    }
  }

  return Array.from(combined.values()).sort((a, b) => a.month - b.month);
}

export function combineWeeklyData(
  googleWeekly: ApiWeeklyData[],
  metaWeekly: ApiWeeklyData[]
): ApiWeeklyData[] {
  const combined = new Map<string, ApiWeeklyData>();

  for (const gw of googleWeekly) {
    const key = `${gw.month}-${gw.week}`;
    combined.set(key, { ...gw });
  }

  for (const mw of metaWeekly) {
    const key = `${mw.month}-${mw.week}`;
    const existing = combined.get(key);
    if (existing) {
      existing.conversions += mw.conversions;
      existing.revenue += mw.revenue;
      existing.adSpend += mw.adSpend;
    } else {
      combined.set(key, { ...mw });
    }
  }

  return Array.from(combined.values()).sort((a, b) =>
    a.month !== b.month ? a.month - b.month : a.week - b.week
  );
}

// ── Convert to Dashboard's ClientHistoricalData format ───────────────────────

function apiDataToMonthlyRecords(
  monthlyData: ApiMonthlyData[],
  weeklyData: ApiWeeklyData[],
  realizedThroughMonth?: number
): (MonthlyRecord | null)[] {
  const records: (MonthlyRecord | null)[] = [];
  // De eerste maand van het lopende jaar met een rij: daarvóór liep het account (of kanaal) nog
  // niet, daarna is een maand zonder rij binnen de gerealiseerde grens een gemeten nul.
  const eersteMaand = monthlyData.reduce((min, d) => (d.month >= 1 && d.month < min ? d.month : min), 13);

  for (let m = 1; m <= 12; m++) {
    if (realizedThroughMonth !== undefined && m > realizedThroughMonth) {
      records.push(null);
      continue;
    }

    const monthData = monthlyData.find((d) => d.month === m);
    // Op weeknummer gesorteerd: de forecast leest de weken op POSITIE (weeks[w], de weekverdeling).
    // De kanaaltabs lezen hun dagrijen nieuwste eerst, en dan kwamen de weken hier binnen als W5, W4
    // .. W1: de gerealiseerde weken van juli stonden omgekeerd, en de beursstrip zette de korte week
    // van elke prognosemaand in de verkeerde week.
    const monthWeeks = weeklyData
      .filter((w) => w.month === m)
      .map((w): WeeklyRecord => ({
        week: w.week,
        month: m,
        conversions: w.conversions,
        revenue: w.revenue,
        adSpend: w.adSpend,
      }))
      .sort((a, b) => a.week - b.week);

    if (monthData) {
      // If we have no weekly data, generate even splits
      const weeks = monthWeeks.length > 0
        ? monthWeeks
        : generateEvenWeeks(m, monthData.conversions, monthData.revenue, monthData.adSpend);

      records.push({
        month: m,
        conversions: monthData.conversions,
        revenue: monthData.revenue,
        adSpend: monthData.adSpend,
        weeks,
      });
    } else if (realizedThroughMonth === undefined || m > eersteMaand) {
      // Historical year with no data for this month — fill with zeros.
      //
      // In het lopende jaar ook, voor een maand ná de eerste rij en t/m de grens (die grens is
      // hierboven al afgevangen). De API vult niet aan: een gepauzeerde maand, of de maanden nadat
      // een beursklant stilviel, hebben geen rij. Als null kregen ze een prognose voor een maand
      // die al voorbij was, of telden ze als "geen data" waar de pacing ze als nul rekent. Een
      // nulmaand is gemeten (gepauzeerd = echt nul), net als in de vergelijking van de KPI-band.
      records.push({
        month: m,
        conversions: 0,
        revenue: 0,
        adSpend: 0,
        weeks: generateEvenWeeks(m, 0, 0, 0),
      });
    } else {
      // Lopend jaar, vóór de eerste rij: het account liep nog niet. Null, zodat de forecast er
      // geen prognose en geen gemeten nul van maakt. (Toekomstige maanden zijn hierboven al null.)
      records.push(null);
    }
  }

  return records;
}

function generateEvenWeeks(
  month: number,
  conversions: number,
  revenue: number,
  adSpend: number
): WeeklyRecord[] {
  const nWeeks = [1, 3, 5, 7, 8, 10, 12].includes(month) ? 5 : 4;
  const weeks: WeeklyRecord[] = [];

  for (let w = 1; w <= nWeeks; w++) {
    weeks.push({
      week: w,
      month,
      conversions: Math.round(conversions / nWeeks),
      revenue: Math.round(revenue / nWeeks),
      adSpend: Math.round(adSpend / nWeeks),
    });
  }

  // Fix rounding on last week
  const last = weeks[nWeeks - 1];
  last.conversions += conversions - weeks.reduce((s, w) => s + w.conversions, 0);
  last.revenue += revenue - weeks.reduce((s, w) => s + w.revenue, 0);
  last.adSpend += adSpend - weeks.reduce((s, w) => s + w.adSpend, 0);

  return weeks;
}

/** Input for a single historical year */
export interface YearDataInput {
  year: number;
  monthly: ApiMonthlyData[];
  weekly: ApiWeeklyData[];
}

/**
 * Build ClientHistoricalData from API data.
 * Supports N historical years — more data = better forecasts.
 */
export function buildClientDataFromApi(
  clientId: string,
  historicalYearsInput: YearDataInput[],
  currentYearMonthly: ApiMonthlyData[],
  currentYearWeekly: ApiWeeklyData[],
  targetCurrentYear: ClientAnnualData,
  currentYear: number,
  realizedThroughMonth: number
): ClientHistoricalData {
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  for (const { year, monthly, weekly } of historicalYearsInput) {
    historicalYears[year] = apiDataToMonthlyRecords(monthly, weekly) as MonthlyRecord[];
  }

  return {
    clientId,
    targetCurrentYear,
    historicalYears,
    currentYearData: apiDataToMonthlyRecords(currentYearMonthly, currentYearWeekly, realizedThroughMonth),
    currentYear,
  };
}

/**
 * @deprecated Use buildClientDataFromApi with YearDataInput[] instead.
 * Kept for backwards compatibility during migration.
 */
export function buildClientDataFromApiLegacy(
  clientId: string,
  data2024Monthly: ApiMonthlyData[],
  data2024Weekly: ApiWeeklyData[],
  data2025Monthly: ApiMonthlyData[],
  data2025Weekly: ApiWeeklyData[],
  data2026Monthly: ApiMonthlyData[],
  data2026Weekly: ApiWeeklyData[],
  target2026: ClientAnnualData,
  realizedThroughMonth: number
): ClientHistoricalData {
  return buildClientDataFromApi(
    clientId,
    [
      { year: 2024, monthly: data2024Monthly, weekly: data2024Weekly },
      { year: 2025, monthly: data2025Monthly, weekly: data2025Weekly },
    ],
    data2026Monthly,
    data2026Weekly,
    target2026,
    2026,
    realizedThroughMonth,
  );
}
