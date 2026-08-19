// De 3 losse geo-clone-demo-klanten (GRT/GRA/GRN, scripts/demo/seed-geoclone-clients.ts) op de
// Overzicht-dashboardweergave: /api/google-ads/client-data belde voor deze klanten altijd de
// ECHTE Google Ads API (via credentialsUitOmgeving()), want alleen "demo-greentech" had een
// bypass (isGreentechDemo in greentech-mock.ts). Deze drie zijn wel degelijk in de database
// geseed -- ads_account_monthly/ads_account_weekly/ads_campaign_monthly (via fysiekeTabel(), zie
// het seedscript) -- maar dat zijn niet-gekoppelde accounts, dus de live aanroep faalt altijd
// ("Google Ads API not configured", of een afwijzing van Google zelf op een niet-bestaand
// customerId). Precies dezelfde data die /api/analysis/monthly voor deze klanten al leest (die
// route gaat rechtstreeks tegen dezelfde tabellen, nooit tegen de live API) wordt hier herbruikt
// voor de dashboardweergave, zodat het scherm en de SOP-analyse dezelfde cijfers laten zien.

import type { SupabaseClient } from "@supabase/supabase-js";
import { GEOCLONE_DEMO_IDS } from "./geoclone-clients";
import { detectCountriesFromCampaigns, detectCountryFromName } from "@/lib/countries";
import type { ApiMonthlyData, ApiWeeklyData, YearDataInput } from "@/lib/api/adapter";

export function isGeocloneDemo(customerId: string | null | undefined): boolean {
  if (!customerId) return false;
  const id = customerId.replace(/^gads-/, "");
  return GEOCLONE_DEMO_IDS.includes(id);
}

interface AccountMonthlyRow {
  month: string; impressions: number; clicks: number; cost: number;
  conversions: number; conversions_value: number; ctr: number; avg_cpc: number; conversion_rate: number;
}
interface AccountWeeklyRow {
  week_start: string; impressions: number; clicks: number; cost: number;
  conversions: number; conversions_value: number;
}
interface CampaignMonthlyRow {
  campaign_id: string; campaign_name: string; campaign_status: string; month: string;
  impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number;
  ctr: number; avg_cpc: number; conversion_rate: number;
}

function monthNum(month: string): number {
  return Number(month.slice(5, 7));
}
function yearNum(month: string): number {
  return Number(month.slice(0, 4));
}

function toApiMonthly(r: AccountMonthlyRow): ApiMonthlyData {
  return {
    month: monthNum(r.month),
    conversions: Math.round(r.conversions),
    revenue: Math.round(r.conversions_value),
    adSpend: Math.round(r.cost),
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr,
    avgCpc: r.avg_cpc,
    conversionRate: r.conversion_rate,
  };
}

/** Weekrijen groeperen per maand en er een volgnummer-binnen-de-maand aan geven -- zelfde regel
 * als googleAdsWeeklyToApiData in lib/api/adapter.ts, hier op de al-geseede kolomnamen. */
function toApiWeekly(rows: AccountWeeklyRow[]): ApiWeeklyData[] {
  const byMonth = new Map<number, AccountWeeklyRow[]>();
  for (const r of rows) {
    const m = monthNum(r.week_start);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const out: ApiWeeklyData[] = [];
  for (const [month, weekRows] of byMonth) {
    weekRows.forEach((wr, i) => {
      out.push({
        week: i + 1, month,
        conversions: Math.round(wr.conversions),
        revenue: Math.round(wr.conversions_value),
        adSpend: Math.round(wr.cost),
      });
    });
  }
  return out;
}

function mapCampaign(c: CampaignMonthlyRow) {
  return {
    campaignId: c.campaign_id,
    campaignName: c.campaign_name,
    campaignStatus: c.campaign_status,
    month: c.month,
    conversions: Math.round(c.conversions),
    revenue: Math.round(c.conversions_value),
    adSpend: Math.round(c.cost),
    impressions: c.impressions,
    clicks: c.clicks,
    ctr: c.ctr,
    avgCpc: c.avg_cpc,
    conversionRate: c.conversion_rate,
  };
}

/**
 * Bouwt dezelfde JSON-vorm als de live /api/google-ads/client-data-route, maar uit de geseede
 * database in plaats van de Google Ads API. clientId is het pseudo-client_id ("demo-grt" etc.),
 * niet een echt Google Ads customer ID.
 */
export async function buildGeocloneClientData(supabase: SupabaseClient, clientId: string) {
  const [{ data: monthlyRows }, { data: weeklyRows }, { data: campaignRows }] = await Promise.all([
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).order("month") as unknown as Promise<{ data: AccountMonthlyRow[] | null }>,
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).order("week_start") as unknown as Promise<{ data: AccountWeeklyRow[] | null }>,
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).order("month") as unknown as Promise<{ data: CampaignMonthlyRow[] | null }>,
  ]);

  const monthly = monthlyRows ?? [];
  const campaigns = campaignRows ?? [];
  const years = [...new Set(monthly.map((r) => yearNum(r.month)))].sort((a, b) => a - b);
  const currentYear = years.length > 0 ? years[years.length - 1] : Number(new Date().getFullYear());

  const historicalYears: YearDataInput[] = [];
  for (const y of years.filter((y) => y !== currentYear)) {
    const yMonthly = monthly.filter((r) => yearNum(r.month) === y).map(toApiMonthly);
    if (yMonthly.some((m) => m.conversions > 0 || m.adSpend > 0)) {
      historicalYears.push({ year: y, monthly: yMonthly, weekly: [] });
    }
  }

  const currentYearMonthly = monthly.filter((r) => yearNum(r.month) === currentYear).map(toApiMonthly);
  const currentYearWeekly = toApiWeekly((weeklyRows ?? []).filter((r) => yearNum(r.week_start) === currentYear));

  // Alleen afgesloten maanden tellen als "gerealiseerd" -- zelfde regel als de live route.
  const now = new Date();
  const currentMonthNum = now.getFullYear() === currentYear ? now.getMonth() + 1 : 13;
  const monthsWithData = currentYearMonthly.map((m) => m.month).filter((m) => m < currentMonthNum);
  const realizedThroughMonth = monthsWithData.length > 0 ? Math.max(...monthsWithData) : 0;

  const lastFullYear = historicalYears[historicalYears.length - 1] ?? null;
  const prevConv = lastFullYear?.monthly.reduce((s, m) => s + m.conversions, 0) ?? 0;
  const prevRev = lastFullYear?.monthly.reduce((s, m) => s + m.revenue, 0) ?? 0;
  const prevSpend = lastFullYear?.monthly.reduce((s, m) => s + m.adSpend, 0) ?? 0;
  const targetCurrentYear = {
    conversions: Math.round(prevConv * 1.10),
    revenue: Math.round(prevRev * 1.10),
    adSpend: Math.round(prevSpend * 1.05),
  };

  const campaignsCurrentYear = campaigns.filter((c) => yearNum(c.month) === currentYear).map(mapCampaign);
  const campaignsHistorical = campaigns.filter((c) => yearNum(c.month) === currentYear - 1).map(mapCampaign);

  const campaignNames = [...new Set(campaigns.map((c) => c.campaign_name))];
  const campaignCountryMap: Record<string, string> = {};
  const campaignCountryShares: Record<string, Record<string, number>> = {};
  for (const name of campaignNames) {
    const cc = detectCountryFromName(name);
    if (cc) {
      campaignCountryMap[name] = cc;
      campaignCountryShares[name] = { [cc]: 1 };
    }
  }
  const detectedCountries = detectCountriesFromCampaigns(campaignNames);

  const latestByCampaign = new Map<string, CampaignMonthlyRow>();
  for (const c of campaigns) {
    if (!latestByCampaign.has(c.campaign_id) || c.month > latestByCampaign.get(c.campaign_id)!.month) {
      latestByCampaign.set(c.campaign_id, c);
    }
  }

  return {
    customerId: clientId,
    currentYear,
    realizedThroughMonth,
    targetCurrentYear,
    historicalYears,
    currentYearMonthly,
    currentYearWeekly,
    campaigns: campaignsCurrentYear,
    campaignsHistorical,
    impressionShare: [],
    conversionActions: [],
    accountStructure: {
      campaigns: [...latestByCampaign.values()].map((c) => ({
        id: c.campaign_id, name: c.campaign_name, type: "SEARCH", biddingStrategy: "MAXIMIZE_CONVERSIONS",
        purpose: "demand_capture", bucketLabel: null, adGroupCount: 1, assetGroupCount: 0, hasFeed: false,
        productGroupCount: 0, cost30d: Math.round(c.cost), conversions30d: Math.round(c.conversions), impressions30d: c.impressions,
      })),
      detectedStrategy: ["MAXIMIZE_CONVERSIONS"],
    },
    wastefulSearchTerms: [],
    campaignCountryMap,
    campaignCountryShares,
    detectedCountries,
    countryMonthlyData: [],
    adGroupBleeders: [],
    adGroupPerformance: [],
    productBleeders: [],
    productPerformance: [],
    changeHistory: [],
  };
}
