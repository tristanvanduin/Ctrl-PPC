import type { SupabaseClient } from "@supabase/supabase-js";
import { klantVanId } from "../tenancy/klanten";
import { today } from "../reporting-date";
import type { ApiMonthlyData, YearDataInput } from "./adapter";
import type { ClientAnnualData } from "../types";

/**
 * Blended (Google + Meta + LinkedIn) equivalent van app/api/google-ads/client-data/route.ts's
 * jaren-historie -- voor de Prognose-tabel op "Alle kanalen" (feedback 22 augustus: "ik wil
 * daadwerkelijk alle kanalen ook die tabel krijgt met gecombineerde data"). Eerder bewust
 * weggelaten (channel-forecast-sections.tsx) omdat Meta/LinkedIn geen meerjarige historie hebben
 * om een seizoenscorrectie op te baseren -- maar dat blokkeert alleen de INTERPRETATIE van vroege
 * maanden, niet de DATA: computeMonthlyExpected in lib/forecast.ts negeert een jaar/maand toch al
 * zodra de waarde 0 is (mv > 0), dus een periode voordat Meta/LinkedIn liepen levert gewoon
 * Google's eigen totaal op, geen vertekend nulpunt.
 *
 * Bron: fact_core, level='account', grain='month' -- voor Google al gevuld via
 * ads_account_monthly_legacy, voor Meta/LinkedIn via refresh_rollups() uit de dagcijfers
 * (zelfde rij-vorm als compute-targets.ts's kanaalneutrale lezer hierboven gebruikt).
 */

interface FactCoreMaandRij {
  period_start: string;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  conversions: number | null;
  conv_value: number | null;
}

interface MaandTotaal {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  convValue: number;
}

export interface BlendedHistoricalData {
  currentYear: number;
  realizedThroughMonth: number;
  targetCurrentYear: ClientAnnualData;
  historicalYears: YearDataInput[];
  currentYearMonthly: ApiMonthlyData[];
}

function naarApiMonthlyData(maand: number, t: MaandTotaal): ApiMonthlyData {
  return {
    month: maand,
    conversions: Math.round(t.conversions),
    revenue: Math.round(t.convValue),
    adSpend: Math.round(t.cost),
    impressions: t.impressions,
    clicks: t.clicks,
    ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
    avgCpc: t.clicks > 0 ? t.cost / t.clicks : 0,
    conversionRate: t.clicks > 0 ? t.conversions / t.clicks : 0,
  };
}

/** Haalt de blended jaren-/maandhistorie op voor de "Alle kanalen"-prognosetabel. Null als de
 * klant geen account heeft of geen enkele fact_core-rij draagt. */
export async function fetchBlendedHistoricalData(
  supabase: SupabaseClient,
  clientId: string
): Promise<BlendedHistoricalData | null> {
  const klant = await klantVanId(supabase, clientId);
  if (!klant) return null;

  const { data: rijen } = await supabase
    .from("fact_core")
    .select("period_start, impressions, clicks, cost, conversions, conv_value")
    .eq("account_id", klant.id)
    .in("channel", ["google", "meta", "linkedin"])
    .eq("level", "account")
    .eq("grain", "month")
    .order("period_start");

  const rows = (rijen ?? []) as FactCoreMaandRij[];
  if (rows.length === 0) return null;

  // Optellen per (jaar, maand) -- meerdere kanalen kunnen dezelfde period_start dragen.
  const perJaarMaand = new Map<number, Map<number, MaandTotaal>>();
  for (const r of rows) {
    const jaar = parseInt(r.period_start.slice(0, 4), 10);
    const maand = parseInt(r.period_start.slice(5, 7), 10);
    if (!perJaarMaand.has(jaar)) perJaarMaand.set(jaar, new Map());
    const maanden = perJaarMaand.get(jaar)!;
    const bestaand = maanden.get(maand) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 };
    maanden.set(maand, {
      impressions: bestaand.impressions + (r.impressions ?? 0),
      clicks: bestaand.clicks + (r.clicks ?? 0),
      cost: bestaand.cost + (r.cost ?? 0),
      conversions: bestaand.conversions + (r.conversions ?? 0),
      convValue: bestaand.convValue + (r.conv_value ?? 0),
    });
  }

  // Amsterdams jaar (zelfde reden als in de Google-route: new Date().getFullYear() draait in
  // UTC op de server, en zou op oudejaarsavond na 23:00 lokale tijd een jaar mis grijpen).
  const currentYear = Number(today().slice(0, 4));

  const historicalYears: YearDataInput[] = [];
  for (const [jaar, maanden] of perJaarMaand) {
    if (jaar >= currentYear) continue;
    const monthly = Array.from(maanden.entries())
      .map(([m, t]) => naarApiMonthlyData(m, t))
      .filter((m) => m.conversions > 0 || m.adSpend > 0);
    if (monthly.length > 0) historicalYears.push({ year: jaar, monthly, weekly: [] });
  }
  historicalYears.sort((a, b) => a.year - b.year);

  const huidigeMaanden = perJaarMaand.get(currentYear) ?? new Map<number, MaandTotaal>();
  const currentYearMonthly = Array.from(huidigeMaanden.entries()).map(([m, t]) => naarApiMonthlyData(m, t));

  const now = new Date();
  const currentMonthNum = now.getFullYear() === currentYear ? now.getMonth() + 1 : 13;
  const monthsWithData = currentYearMonthly.map((m) => m.month).filter((m) => m < currentMonthNum);
  const realizedThroughMonth = monthsWithData.length > 0 ? Math.max(...monthsWithData) : 0;

  // Zelfde default als de Google-route: 10% groei op het laatst volledige jaar. De echte
  // klant-KPI-doelen (Instellingen) overschrijven dit toch via lib/kpi-target-merge.ts.
  const laatsteJaar = historicalYears.length > 0 ? historicalYears[historicalYears.length - 1] : null;
  const prevConv = laatsteJaar?.monthly.reduce((s, m) => s + m.conversions, 0) ?? 0;
  const prevRev = laatsteJaar?.monthly.reduce((s, m) => s + m.revenue, 0) ?? 0;
  const prevSpend = laatsteJaar?.monthly.reduce((s, m) => s + m.adSpend, 0) ?? 0;

  return {
    currentYear,
    realizedThroughMonth,
    targetCurrentYear: {
      conversions: Math.round(prevConv * 1.10),
      revenue: Math.round(prevRev * 1.10),
      adSpend: Math.round(prevSpend * 1.05),
    },
    historicalYears,
    currentYearMonthly,
  };
}
