/**
 * Computes monthly expected values for the analysis pipeline,
 * using the same forecast engine as the dashboard frontend.
 *
 * Converts Supabase ads_account_monthly rows into ClientHistoricalData
 * and runs computeForecast() to get the expected values per month.
 *
 * ── KANAALNEUTRAAL, FASE A (12 aug 2026) ─────────────────────────────────────
 *
 * computeForecast zelf was al kanaalneutraal (geen Google-specifieke aannames in de rekenkern,
 * zie lib/forecast.ts); alleen deze functie was hardcoded op Google's ads_account_monthly/
 * ads_account_weekly. Die twee zijn sinds migratie 054 VIEWS over fact_core -- de kanaalneutrale
 * feitenlaag staat er dus al, alleen ongebruikt voor Meta/LinkedIn.
 *
 * Voor Google blijft dit pad ONGEWIJZIGD: dezelfde view, dezelfde query, nul risico. Voor Meta en
 * LinkedIn is er geen "ads_account_weekly"-achtige legacy-view (die tabel bestond nooit voor die
 * kanalen), dus daar wordt fact_core rechtstreeks bevraagd -- met grain='month' en grain='week',
 * allebei al gevuld door refresh_rollups() (migratie 037/038) uit de dagcijfers. Geen nieuwe
 * migratie nodig: dit was al gebouwd en geverifieerd, alleen nog niet gelezen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientHistoricalData, MonthlyRecord, WeeklyRecord } from "../types";
import { computeForecast, type ClientForecast } from "../forecast";
import { today } from "../reporting-date";
import { klantVanId } from "../tenancy/klanten";

// "microsoft" leest, net als meta/linkedin, uit fact_core. Zolang de bevroren fase-3-projectie
// daar geen microsoft-rijen zet, komt dit leeg terug en valt de functie netjes op null -- de
// routes laten targetText dan weg, precies zoals bij een net gekoppeld Meta-account.
export type AnalysisChannel = "google" | "meta" | "linkedin" | "microsoft";

interface AccountRow {
  month: string;         // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  cost_per_conversion: number;
  conversion_rate: number;
}

interface FactCoreRow {
  period_start: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conv_value: number;
}

/** fact_core kent geen door het platform berekende ratio's (ctr, avg_cpc, ...) -- die staan in de
 *  kanaaltabellen (google_metrics e.d.) en rowToMonthlyRecord/buildWeeks gebruiken ze toch niet.
 *  Op nul gezet, niet weggelaten: het type blijft één huis voor "een periode uit de feitenlaag",
 *  ongeacht of hij van een view of rechtstreeks van fact_core komt. */
function factCoreAlsAccountRow(r: FactCoreRow): AccountRow {
  return {
    month: r.period_start,
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost,
    conversions: r.conversions,
    conversions_value: r.conv_value,
    ctr: 0, avg_cpc: 0, cost_per_conversion: 0, conversion_rate: 0,
  };
}

function factCoreAlsWeeklyRow(r: FactCoreRow): WeeklyRow {
  return {
    week_start: r.period_start,
    cost: r.cost,
    conversions: r.conversions,
    conversions_value: r.conv_value,
  };
}

export interface WeeklyRow {
  week_start: string;
  cost: number;
  conversions: number;
  conversions_value: number;
}

function parseYear(dateStr: string): number {
  return parseInt(dateStr.split("-")[0], 10);
}

function parseMonth(dateStr: string): number {
  return parseInt(dateStr.split("-")[1], 10);
}

function rowToMonthlyRecord(row: AccountRow): MonthlyRecord {
  return {
    month: parseMonth(row.month),
    conversions: Math.round(row.conversions),
    revenue: Math.round(row.conversions_value),
    adSpend: Math.round(row.cost),
    weeks: [], // will be filled below
  };
}

/**
 * De weken van een specifieke maand in een specifiek JAAR.
 *
 * Het jaar stond hier niet in. Dat had twee gevolgen tegelijk, en allebei zijn ze stil:
 *
 *   1. De weekdata werd alleen voor het huidige jaar opgehaald, dus juni 2024 kreeg de weken
 *      van juni 2026 aangehangen. De forecast gebruikt die weken voor de verdeling binnen een
 *      maand en voor het aantal weken per maand, dus historische seizoenspatronen werden met
 *      cijfers van dit jaar gevuld.
 *   2. Maanden die dit jaar nog niet geweest zijn kregen NUL weken in alle historische jaren.
 *      Bij een analyse in juli betekent dat: augustus tot en met december leeg, elk jaar.
 */
export function buildWeeks(weeklyRows: WeeklyRow[], year: number, month: number): WeeklyRecord[] {
  const monthWeeks = weeklyRows
    .filter((w) => parseYear(w.week_start) === year && parseMonth(w.week_start) === month)
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  return monthWeeks.map((w, i) => ({
    week: i + 1,
    month,
    conversions: Math.round(w.conversions),
    revenue: Math.round(w.conversions_value),
    adSpend: Math.round(w.cost),
  }));
}

/**
 * Fetch account data from Supabase, build ClientHistoricalData,
 * run the forecast engine, and return per-month expected values.
 *
 * Returns the forecast for the last complete month's analysis period.
 */
export async function computeAnalysisTargets(
  supabase: SupabaseClient,
  clientId: string,
  channel: AnalysisChannel = "google"
): Promise<{
  forecast: ClientForecast;
  lastCompleteMonth: number;
  currentYear: number;
  monthlyExpected: { month: number; conversions: number; revenue: number; adSpend: number }[];
} | null> {
  // Amsterdamse kalenderdag, niet de UTC-datum van het serverproces: zie lib/reporting-date.ts.
  const [currentYear, currentMonth] = today().split("-").slice(0, 2).map(Number);
  const lastCompleteMonth = currentMonth - 1 || 12;
  const lastCompleteYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const startYear = currentYear - 5;
  const vanaf = `${startYear}-01-01`;
  const totEnMet = `${lastCompleteYear}-${String(lastCompleteMonth).padStart(2, "0")}-01`;

  let accountRows: AccountRow[];
  let weekly: WeeklyRow[];

  if (channel === "google") {
    // Ongewijzigd: dezelfde view als altijd (sinds migratie 054 zelf al een view over fact_core,
    // maar dat is voor deze functie een implementatiedetail).
    const { data } = await supabase
      .from("ads_account_monthly")
      .select("*")
      .eq("client_id", clientId)
      .gte("month", vanaf)
      .lte("month", totEnMet)
      .order("month");
    accountRows = (data ?? []) as AccountRow[];

    // Weekdata over hetzelfde venster als de maanddata. Stond op alleen het huidige jaar,
    // waardoor historische jaren de weken van dit jaar kregen aangehangen.
    const { data: weeklyRows } = await supabase
      .from("ads_account_weekly")
      .select("*")
      .eq("client_id", clientId)
      .gte("week_start", vanaf)
      .order("week_start");
    weekly = (weeklyRows ?? []) as WeeklyRow[];
  } else {
    // Meta/LinkedIn hebben geen "ads_account_weekly"-achtige legacy-view -- die tabel bestond
    // nooit voor die kanalen. fact_core rechtstreeks, met grain='month'/'week', al gevuld door
    // refresh_rollups() uit de dagcijfers.
    const klant = await klantVanId(supabase, clientId);
    if (!klant) return null;

    const [{ data: maandData }, { data: weekData }] = await Promise.all([
      supabase.from("fact_core").select("period_start, impressions, clicks, cost, conversions, conv_value")
        .eq("account_id", klant.id).eq("channel", channel).eq("level", "account").eq("grain", "month")
        .gte("period_start", vanaf).lte("period_start", totEnMet).order("period_start"),
      supabase.from("fact_core").select("period_start, impressions, clicks, cost, conversions, conv_value")
        .eq("account_id", klant.id).eq("channel", channel).eq("level", "account").eq("grain", "week")
        .gte("period_start", vanaf).order("period_start"),
    ]);
    accountRows = ((maandData ?? []) as FactCoreRow[]).map(factCoreAlsAccountRow);
    weekly = ((weekData ?? []) as FactCoreRow[]).map(factCoreAlsWeeklyRow);
  }

  if (accountRows.length === 0) return null;

  // Fetch KPI targets
  //
  // GEMETEN GAT (12 aug 2026, tijdens het verifieren van de kanaalneutrale lezer hierboven):
  // client_settings.kpi_targets is EEN rij per klant, niet per kanaal. Voor demo-greentech (Meta,
  // 6 echte maanden vanaf feb 2026, echte cost 2.850-4.650/mnd) kwam monthlyExpected.adSpend voor
  // elke maand op 0 uit -- niet doordat de leeslaag hierboven fout is (de ruwe fact_core-cijfers
  // kloppen, apart nagemeten), maar doordat targetCurrentYear.adSpend hieronder terugvalt op
  // Math.round(prevSpend * 1.05), en prevSpend is 0 zolang er geen vorig-jaar-rijen voor DIT
  // kanaal bestaan -- wat voor elk net gekoppeld Meta/LinkedIn-account het geval is. conversions
  // kwam wel nonzero terug, via kpi.conversionsAbsolute -- een target dat vermoedelijk voor het
  // Google-kanaal is ingevoerd en hier kritiekloos wordt hergebruikt voor Meta. Geen aanname: dit
  // is aangetoond met de ruwe fact_core-rijen ernaast. Een echt per-kanaal doel (kpi_targets met
  // een channel-kolom, client_targets heeft die al maar staat leeg, zie lib/health-score.ts:107)
  // is nodig voordat health-score/Code Rood's forecast-afwijkingssignaal voor Meta/LinkedIn
  // betrouwbaar is -- dat is fase B-werk, hier alleen vastgelegd zodat het niet stil verdwijnt.
  const { data: settings } = await supabase
    .from("client_settings")
    .select("kpi_targets")
    .eq("client_id", clientId)
    .maybeSingle();

  const kpi = (settings?.kpi_targets ?? {}) as Record<string, number>;

  // Group monthly data by year
  const byYear = new Map<number, AccountRow[]>();
  for (const row of accountRows as AccountRow[]) {
    const year = parseYear(row.month);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(row);
  }

  // Build historical years (everything before current year)
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  for (const [year, rows] of byYear) {
    if (year >= currentYear) continue;
    const records: MonthlyRecord[] = [];
    for (let m = 1; m <= 12; m++) {
      const row = rows.find((r) => parseMonth(r.month) === m);
      if (row) {
        const rec = rowToMonthlyRecord(row);
        rec.weeks = buildWeeks(weekly, year, m);
        records.push(rec);
      } else {
        records.push({ month: m, conversions: 0, revenue: 0, adSpend: 0, weeks: [] });
      }
    }
    historicalYears[year] = records;
  }

  // Build current year data
  const currentYearRows = byYear.get(currentYear) ?? [];
  const currentYearData: (MonthlyRecord | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    if (m > lastCompleteMonth && currentYear === lastCompleteYear) {
      currentYearData.push(null);
      continue;
    }
    const row = currentYearRows.find((r) => parseMonth(r.month) === m);
    if (row) {
      const rec = rowToMonthlyRecord(row);
      rec.weeks = buildWeeks(weekly, currentYear, m);
      currentYearData.push(rec);
    } else {
      currentYearData.push(null);
    }
  }

  // Compute previous year totals for default target (10% growth)
  const prevYearRows = byYear.get(currentYear - 1) ?? [];
  const prevConv = prevYearRows.reduce((s, r) => s + r.conversions, 0);
  const prevRev = prevYearRows.reduce((s, r) => s + r.conversions_value, 0);
  const prevSpend = prevYearRows.reduce((s, r) => s + r.cost, 0);

  const targetCurrentYear = {
    conversions: kpi.conversionsAbsolute || Math.round(prevConv * 1.1),
    revenue: kpi.revenueAbsolute || Math.round(prevRev * 1.1),
    adSpend: Math.round(prevSpend * 1.05),
  };

  const clientData: ClientHistoricalData = {
    clientId,
    targetCurrentYear,
    historicalYears,
    currentYearData,
    currentYear,
  };

  const forecast = computeForecast(clientData);

  // Extract monthly expected values
  const monthlyExpected = forecast.conversions.points.map((pt, i) => ({
    month: i + 1,
    conversions: Math.round(pt.expected),
    revenue: Math.round(forecast.revenue.points[i].expected),
    adSpend: Math.round(forecast.adSpend.points[i].expected),
  }));

  return { forecast, lastCompleteMonth, currentYear, monthlyExpected };
}
