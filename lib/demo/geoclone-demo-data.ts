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
//
// Sinds stap 0 loopt GreenTech zelf hier ook doorheen (seededDemoClientData): zijn Google kwam uit
// een JS-fixture terwijl Meta, LinkedIn, Microsoft en het Jaaroverzicht uit de database lazen, en
// de KPI-band telde die twee werelden bij elkaar op.

import type { SupabaseClient } from "@supabase/supabase-js";
import { GEOCLONE_DEMO_IDS } from "./geoclone-clients";
import { isGreentechDemo, buildGreentechClientData } from "./greentech-mock";
import { detectCountriesFromCampaigns, detectCountryFromName } from "@/lib/countries";
import type { ApiMonthlyData, ApiWeeklyData, YearDataInput } from "@/lib/api/adapter";
import type { CountryMonthlyRow } from "@/lib/use-client-data";
import { eis } from "@/lib/analysis/db-veilig";
import { maandbronDataStand, gerealiseerdTotMaand } from "@/lib/api/client-data-stand";
import { today } from "@/lib/reporting-date";

export function isGeocloneDemo(customerId: string | null | undefined): boolean {
  if (!customerId) return false;
  const id = customerId.replace(/^gads-/, "");
  return GEOCLONE_DEMO_IDS.includes(id);
}

/** Demoklanten waarvan de Google-reeks uit de geseede database komt: GreenTech en de drie clones. */
export function isSeededDemo(customerId: string | null | undefined): boolean {
  return isGreentechDemo(customerId) || isGeocloneDemo(customerId);
}

/**
 * Wat /api/google-ads/client-data voor een demoklant teruggeeft. De account-, week- en
 * campagnereeksen komen ALTIJD uit de database: dezelfde rijen waaruit Meta, LinkedIn en
 * Microsoft in de KPI-band (lib/use-channel-period-data.ts, via /api/data) en het Jaaroverzicht,
 * de pacing en de cross-channel-tabel (fact_core) lezen.
 *
 * Hiervoor kreeg GreenTech een JS-fixture (lib/demo/greentech-mock.ts): een andere fictieve
 * wereld, met andere bedragen, vier in plaats van zes campagnes, en september en oktober 2026
 * die in de database niet bestaan. De band telde die op bij de kanalen uit de database: okt25-sep26
 * 3.011 conversies, tegen 3.401 voor de kanalen opgeteld.
 *
 * Uit de fixture komt alleen nog wat de seed niet heeft en wat nooit in een accounttotaal wordt
 * opgeteld: de conversieacties (het instellingenpaneel) en de verspilde zoektermen.
 */
export async function seededDemoClientData(supabase: SupabaseClient, customerId: string) {
  const id = customerId.replace(/^gads-/, "");
  const uitDb = await buildGeocloneClientData(supabase, id);
  if (!isGreentechDemo(id)) return uitDb;
  const { conversionActions, wastefulSearchTerms } = buildGreentechClientData(id);
  return { ...uitDb, conversionActions, wastefulSearchTerms };
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
  campaign_type?: string | null;
}
interface ImpressionShareRow {
  campaign_id: string; campaign_name: string; campaign_type: string | null; month: string;
  cost: number; conversions: number;
  search_impression_share: number; search_budget_lost_is: number; search_rank_lost_is: number;
  daily_budget: number; budget_utilization: number;
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

/**
 * countryMonthlyData afgeleid uit de campagnerijen, niet verzonnen: elke campagne heeft al een
 * gedetecteerd land (campaignCountryMap, uit de campagnenaam) met aandeel 1 -- deze klanten zijn
 * single-market (GRT=NL, GRA=US, GRN=CA/NA), dus "per land" is hier vrijwel altijd "per campagne".
 * Zonder deze afleiding bleef countryMonthlyData hardcoded leeg: de landfilter-knop verscheen wel
 * (detectedCountries wordt wél gevuld), maar elke selectie gaf een lege maand terug.
 */
function deriveCountryMonthlyData(
  campaigns: CampaignMonthlyRow[],
  campaignCountryMap: Record<string, string>,
): CountryMonthlyRow[] {
  const perMaandLand = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number; campagnes: Set<string> }>();
  const spendPerMaand = new Map<string, number>();

  for (const c of campaigns) {
    const land = campaignCountryMap[c.campaign_name];
    if (!land) continue;
    const sleutel = `${land}|${c.month}`;
    const bestaand = perMaandLand.get(sleutel) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0, campagnes: new Set<string>() };
    bestaand.impressions += c.impressions;
    bestaand.clicks += c.clicks;
    bestaand.cost += c.cost;
    bestaand.conversions += c.conversions;
    bestaand.conversionsValue += c.conversions_value;
    bestaand.campagnes.add(c.campaign_id);
    perMaandLand.set(sleutel, bestaand);
    spendPerMaand.set(c.month, (spendPerMaand.get(c.month) ?? 0) + c.cost);
  }

  const rijen: CountryMonthlyRow[] = [];
  for (const [sleutel, t] of perMaandLand) {
    const [countryCode, month] = sleutel.split("|");
    const totaalSpendMaand = spendPerMaand.get(month) ?? 0;
    rijen.push({
      countryCode, month,
      impressions: t.impressions, clicks: t.clicks, cost: t.cost,
      conversions: t.conversions, conversionsValue: t.conversionsValue,
      ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
      avgCpc: t.clicks > 0 ? t.cost / t.clicks : 0,
      costPerConversion: t.conversions > 0 ? t.cost / t.conversions : 0,
      conversionRate: t.clicks > 0 ? t.conversions / t.clicks : 0,
      roas: t.cost > 0 ? t.conversionsValue / t.cost : 0,
      campaignCount: t.campagnes.size,
      spendShare: totaalSpendMaand > 0 ? t.cost / totaalSpendMaand : 0,
    });
  }
  return rijen.sort((a, b) => a.month.localeCompare(b.month) || a.countryCode.localeCompare(b.countryCode));
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

/** Het nieuwste impressieaandeel per campagne, in de vorm van de live route (getCampaignImpressionShare). */
function laatsteImpressieaandeel(rows: ImpressionShareRow[]) {
  const laatste = new Map<string, ImpressionShareRow>();
  for (const r of rows) {
    const eerder = laatste.get(r.campaign_id);
    if (!eerder || String(r.month) > String(eerder.month)) laatste.set(r.campaign_id, r);
  }
  return [...laatste.values()].map((r) => ({
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    campaignType: r.campaign_type ?? "SEARCH",
    cost: Math.round(Number(r.cost) || 0),
    conversions: Math.round(Number(r.conversions) || 0),
    searchImpressionShare: Number(r.search_impression_share) || 0,
    searchBudgetLostIS: Number(r.search_budget_lost_is) || 0,
    searchRankLostIS: Number(r.search_rank_lost_is) || 0,
    dailyBudget: Math.round(Number(r.daily_budget) || 0),
    budgetUtilization: parseFloat((Number(r.budget_utilization) || 0).toFixed(2)),
  }));
}

/**
 * Bouwt dezelfde JSON-vorm als de live /api/google-ads/client-data-route, maar uit de geseede
 * database in plaats van de Google Ads API. clientId is het pseudo-client_id ("demo-grt" etc.),
 * niet een echt Google Ads customer ID.
 *
 * Een leesfout gooit (eis) in plaats van een lege reeks op te leveren: een kapotte query mag op
 * het dashboard niet lezen als "deze klant had geen kosten".
 */
export async function buildGeocloneClientData(supabase: SupabaseClient, clientId: string) {
  const [monthlyRes, weeklyRes, campaignRes, isRes, syncRes] = await Promise.all([
    supabase.from("ads_account_monthly").select("*").eq("client_id", clientId).order("month"),
    supabase.from("ads_account_weekly").select("*").eq("client_id", clientId).order("week_start"),
    supabase.from("ads_campaign_monthly").select("*").eq("client_id", clientId).order("month"),
    supabase.from("ads_campaign_impression_share").select("*").eq("client_id", clientId).order("month"),
    supabase.from("client_sync_status").select("last_successful_sync_at").eq("client_id", clientId).limit(1),
  ]);

  const monthly = eis(monthlyRes, "ads_account_monthly (demo)") as AccountMonthlyRow[];
  const weeklyRows = eis(weeklyRes, "ads_account_weekly (demo)") as AccountWeeklyRow[];
  const campaigns = eis(campaignRes, "ads_campaign_monthly (demo)") as CampaignMonthlyRow[];
  const isRows = eis(isRes, "ads_campaign_impression_share (demo)") as ImpressionShareRow[];
  const syncRows = eis(syncRes, "client_sync_status (demo)") as { last_successful_sync_at?: unknown }[];
  const years = [...new Set(monthly.map((r) => yearNum(r.month)))].sort((a, b) => a - b);
  const currentYear = years.length > 0 ? years[years.length - 1] : Number(today().slice(0, 4));

  const historicalYears: YearDataInput[] = [];
  for (const y of years.filter((y) => y !== currentYear)) {
    const yMonthly = monthly.filter((r) => yearNum(r.month) === y).map(toApiMonthly);
    if (yMonthly.some((m) => m.conversions > 0 || m.adSpend > 0)) {
      historicalYears.push({ year: y, monthly: yMonthly, weekly: [] });
    }
  }

  const currentYearMonthly = monthly.filter((r) => yearNum(r.month) === currentYear).map(toApiMonthly);
  const currentYearWeekly = toApiWeekly(weeklyRows.filter((r) => yearNum(r.week_start) === currentYear));

  // Gerealiseerd is t/m de laatste VOLLE maand met data, niet t/m "vorige kalendermaand". Een
  // maandrij zegt niet tot welke dag hij gevuld is; het synctijdstip wel. De demo is op 26 augustus
  // geseed: augustus loopt t/m de 25e en telt dus niet als gerealiseerd, en september en oktober
  // bestaan niet. Op de kalender telde augustus als vol en liep de band door tot oktober.
  const laatsteMaand = monthly.map((r) => String(r.month ?? "").slice(0, 7)).sort().pop() ?? null;
  const laatsteSync = syncRows[0]?.last_successful_sync_at ? String(syncRows[0].last_successful_sync_at) : null;
  const dataStand = maandbronDataStand(laatsteMaand, laatsteSync);
  const realizedThroughMonth = gerealiseerdTotMaand(dataStand, currentYear, currentYearMonthly.map((m) => m.month));

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
    dataStand,
    targetCurrentYear,
    historicalYears,
    currentYearMonthly,
    currentYearWeekly,
    campaigns: campaignsCurrentYear,
    campaignsHistorical,
    // Uit de geseede tabel, zoals de live route het uit de API haalt. De clones hebben er geen rijen
    // in, en houden dus de lege lijst die ze altijd hadden.
    impressionShare: laatsteImpressieaandeel(isRows),
    conversionActions: [],
    accountStructure: {
      campaigns: [...latestByCampaign.values()].map((c) => ({
        id: c.campaign_id, name: c.campaign_name, type: c.campaign_type || "SEARCH", biddingStrategy: "MAXIMIZE_CONVERSIONS",
        purpose: "demand_capture", bucketLabel: null, adGroupCount: 1, assetGroupCount: 0, hasFeed: false,
        productGroupCount: 0, cost30d: Math.round(c.cost), conversions30d: Math.round(c.conversions), impressions30d: c.impressions,
      })),
      detectedStrategy: ["MAXIMIZE_CONVERSIONS"],
    },
    wastefulSearchTerms: [],
    campaignCountryMap,
    campaignCountryShares,
    detectedCountries,
    countryMonthlyData: deriveCountryMonthlyData(campaigns, campaignCountryMap),
    adGroupBleeders: [],
    adGroupPerformance: [],
    productBleeders: [],
    productPerformance: [],
    changeHistory: [],
  };
}
