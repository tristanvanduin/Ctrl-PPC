// G1: de pure voorcompute voor de impression-share- en zichtbaarheidsanalyse. Dit is het
// deterministische hart dat de prompt voedt: het rekent uit waar het account zichtbaarheid
// verliest en of dat budget- of rang-gedreven is, in plaats van het model dat te laten
// gissen. IO-vrij en los getest; de losse-analyse-endpoint en de prompt zijn de dunne laag.
//
// IS-waarden worden overgenomen zoals de sync ze opslaat (fracties uit de Google Ads API).
// De classificatie vergelijkt budget-lost tegen rank-lost en is daarmee schaal-onafhankelijk.
//
// Herbouwd 1 september 2026: alle campagnes worden nu in DEZELFDE peilmaand beoordeeld —
// de jongste maand in de aangeleverde rijen. De oude versie nam per campagne "de laatste
// maand", waardoor een gepauzeerde campagne stilzwijgend op een maanden-oude rij werd
// beoordeeld naast een actuele, zonder dat het model dat kon zien. Campagnes zonder rij in
// de peilmaand tellen apart (buitenPeilmaand) en de MoM vergelijkt uitsluitend tegen de
// échte vorige kalendermaand, nooit over een gat heen.

import { monthIndex, monthFromIndex } from "@/lib/period/period-range";

export type LossDriver = "budget" | "rank" | "mixed" | "none";
export type ActionCandidate = "raise_budget" | "improve_bid_or_quality" | "both" | "none";

// Onder dit totale verlies is de zichtbaarheid gezond en is er geen actie nodig.
export const NEGLIGIBLE_LOST_IS = 0.05;
// Een oorzaak is primair als hij dit deel groter is dan de andere; anders is het gemengd.
export const DRIVER_MARGIN = 0.25;

export interface CampaignImpressionShareRow {
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string | null;
  month: string;
  conversions?: number | null;
  cost?: number | null;
  search_impression_share?: number | null;
  search_budget_lost_is?: number | null;
  search_rank_lost_is?: number | null;
  daily_budget?: number | null;
  budget_utilization?: number | null;
}

// Bepaalt de primaire oorzaak van het zichtbaarheidsverlies. Budget-gedreven betekent dat je
// budget mist; rang-gedreven betekent dat je bod of kwaliteit tekortschiet.
export function classifyLossDriver(budgetLost: number, rankLost: number): LossDriver {
  const totalLost = budgetLost + rankLost;
  if (totalLost < NEGLIGIBLE_LOST_IS) return "none";
  if (budgetLost > rankLost * (1 + DRIVER_MARGIN)) return "budget";
  if (rankLost > budgetLost * (1 + DRIVER_MARGIN)) return "rank";
  return "mixed";
}

// Onder dit aantal conversies in de peilmaand is een CPA te dun om er budget op te verhogen.
export const MIN_CONVERSIES_BUDGETVERHOGING = 10;

// De actie-kandidaat. No-go uit de spec: geen budgetverhoging voorstellen zonder
// conversiebewijs, dus een budget-gedreven campagne zonder conversies levert geen
// budget-actie op (de interpretatie kan hem wel benoemen).
//
// `efficientGenoeg` (standaard: gelijk aan hasConversions, voor bestaande aanroepers): mag er
// geld bij? Een conversie was genoeg: een campagne met 1 conversie op € 5.000 en 40% budgetverlies
// werd "kandidaat voor budgetverhoging". Is de CPA te hoog of het volume te dun, dan is de actie
// eerst efficiëntie (bod of kwaliteit), niet meer budget.
export function actionForDriver(driver: LossDriver, hasConversions: boolean, efficientGenoeg = hasConversions): ActionCandidate {
  if (driver === "none") return "none";
  if (driver === "budget") return !hasConversions ? "none" : efficientGenoeg ? "raise_budget" : "improve_bid_or_quality";
  if (driver === "rank") return "improve_bid_or_quality";
  return hasConversions && efficientGenoeg ? "both" : "improve_bid_or_quality";
}

export interface CampaignISFact {
  campaignId: string;
  campaignName: string;
  campaignType: string | null;
  impressionShare: number;
  budgetLostIs: number;
  rankLostIs: number;
  totalLostIs: number;
  driver: LossDriver;
  action: ActionCandidate;
  conversions: number;
  cost: number;
  cpa: number | null;
  /** Tegen de échte vorige kalendermaand; null als die maand er niet is. */
  impressionShareMoM: number | null;
  /**
   * Waarom een budget-gedreven campagne GEEN budgetkandidaat is, of null. Voor de lezer: de
   * campagne verliest wel zichtbaarheid door budget, maar meer geld zou duur ingekocht worden.
   */
  budgetTegengehouden: string | null;
}

export interface ImpressionShareSummary {
  /** De maand waarin ALLE onderstaande campagnes zijn beoordeeld ("YYYY-MM"). */
  peilmaand: string;
  campaignsAnalysed: number;
  /** Campagnes met alleen oudere rijen dan de peilmaand (gepauzeerd of gestopt). */
  buitenPeilmaand: number;
  budgetDriven: number;
  rankDriven: number;
  mixed: number;
  healthy: number;
  raiseBudgetCandidates: number;
  bidOrQualityCandidates: number;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function maandKey(month: string): string {
  return String(month).slice(0, 7);
}

// Analyseert de campagne-IS-rijen: iedereen in dezelfde peilmaand (de jongste maand in de
// data), classificeert de oorzaak, bepaalt de actie, rekent de MoM tegen de vorige
// kalendermaand, en rangschikt op het grootste zichtbaarheidsverlies.
export function analyzeCampaignImpressionShare(rows: CampaignImpressionShareRow[], opts: { cpaTarget?: number | null } = {}): {
  campaigns: CampaignISFact[];
  summary: ImpressionShareSummary;
} {
  const geldig = rows.filter((r) => r.campaign_id && r.month);
  if (geldig.length === 0) {
    return {
      campaigns: [],
      summary: {
        peilmaand: "", campaignsAnalysed: 0, buitenPeilmaand: 0,
        budgetDriven: 0, rankDriven: 0, mixed: 0, healthy: 0,
        raiseBudgetCandidates: 0, bidOrQualityCandidates: 0,
      },
    };
  }

  const peilmaand = geldig.map((r) => maandKey(r.month)).sort().at(-1) as string;
  const vorigeMaand = monthFromIndex(monthIndex(peilmaand) - 1);

  const inPeilmaand = new Map<string, CampaignImpressionShareRow>();
  const inVorige = new Map<string, CampaignImpressionShareRow>();
  const alleCampagnes = new Set<string>();
  for (const row of geldig) {
    alleCampagnes.add(row.campaign_id);
    const key = maandKey(row.month);
    if (key === peilmaand) inPeilmaand.set(row.campaign_id, row);
    if (key === vorigeMaand) inVorige.set(row.campaign_id, row);
  }

  // De maatstaf voor "mag er geld bij": het CPA-doel als dat er is, anders de account-CPA in de
  // peilmaand (som gedeeld door som over de campagnes).
  const totKosten = [...inPeilmaand.values()].reduce((s, r) => s + num(r.cost), 0);
  const totConv = [...inPeilmaand.values()].reduce((s, r) => s + num(r.conversions), 0);
  const doelCpa = opts.cpaTarget != null && opts.cpaTarget > 0 ? opts.cpaTarget : null;
  const maatstaf = doelCpa ?? (totConv > 0 ? totKosten / totConv : null);
  const maatstafNaam = doelCpa != null ? "het CPA-doel" : "de account-CPA";
  const eur = (v: number) => `€ ${Math.round(v)}`;

  const campaigns: CampaignISFact[] = [];
  for (const [campaignId, latest] of inPeilmaand) {
    const prior = inVorige.get(campaignId) ?? null;
    const budgetLostIs = num(latest.search_budget_lost_is);
    const rankLostIs = num(latest.search_rank_lost_is);
    const conversions = num(latest.conversions);
    const cost = num(latest.cost);
    const driver = classifyLossDriver(budgetLostIs, rankLostIs);
    const cpa = conversions > 0 ? cost / conversions : null;
    const teDun = conversions > 0 && conversions < MIN_CONVERSIES_BUDGETVERHOGING;
    const teDuur = cpa != null && maatstaf != null && cpa > maatstaf;
    const efficientGenoeg = conversions > 0 && !teDun && !teDuur;
    const action = actionForDriver(driver, conversions > 0, efficientGenoeg);
    const budgetTegengehouden = (driver === "budget" || driver === "mixed") && conversions > 0 && !efficientGenoeg
      ? teDun
        ? `${conversions} conversies is te weinig om op te verhogen (minimum ${MIN_CONVERSIES_BUDGETVERHOGING})`
        : `CPA ${eur(cpa!)} ligt boven ${maatstafNaam} (${eur(maatstaf!)}): eerst efficiëntie, dan budget`
      : null;

    campaigns.push({
      campaignId,
      campaignName: latest.campaign_name,
      campaignType: latest.campaign_type ?? null,
      impressionShare: num(latest.search_impression_share),
      budgetLostIs,
      rankLostIs,
      totalLostIs: Math.round((budgetLostIs + rankLostIs) * 10000) / 10000,
      driver,
      action,
      conversions,
      cost,
      cpa: conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : null,
      impressionShareMoM: prior
        ? Math.round((num(latest.search_impression_share) - num(prior.search_impression_share)) * 10000) / 10000
        : null,
      budgetTegengehouden,
    });
  }

  campaigns.sort((a, b) => b.totalLostIs - a.totalLostIs);

  const summary: ImpressionShareSummary = {
    peilmaand,
    campaignsAnalysed: campaigns.length,
    buitenPeilmaand: alleCampagnes.size - campaigns.length,
    budgetDriven: campaigns.filter((c) => c.driver === "budget").length,
    rankDriven: campaigns.filter((c) => c.driver === "rank").length,
    mixed: campaigns.filter((c) => c.driver === "mixed").length,
    healthy: campaigns.filter((c) => c.driver === "none").length,
    raiseBudgetCandidates: campaigns.filter((c) => c.action === "raise_budget" || c.action === "both").length,
    bidOrQualityCandidates: campaigns.filter((c) => c.action === "improve_bid_or_quality" || c.action === "both").length,
  };

  return { campaigns, summary };
}

export interface CountryImpressionShareRow {
  country_code: string;
  month: string;
  search_impression_share?: number | null;
  search_budget_lost_is?: number | null;
  search_rank_lost_is?: number | null;
  total_cost?: number | null;
}

export interface CountryISFact {
  countryCode: string;
  impressionShare: number;
  totalLostIs: number;
  driver: LossDriver;
  cost: number;
}

// Vat de geo-laag samen: alle landen in dezelfde peilmaand (de jongste maand in de
// geo-rijen), geclassificeerd en gerangschikt op het grootste verlies.
export function analyzeGeoImpressionShare(
  rows: CountryImpressionShareRow[],
  topN = 10
): { countries: CountryISFact[]; peilmaand: string } {
  const geldig = rows.filter((r) => r.country_code && r.month);
  if (geldig.length === 0) return { countries: [], peilmaand: "" };

  const peilmaand = geldig.map((r) => maandKey(r.month)).sort().at(-1) as string;
  const countries: CountryISFact[] = [];
  for (const row of geldig) {
    if (maandKey(row.month) !== peilmaand) continue;
    const budgetLostIs = num(row.search_budget_lost_is);
    const rankLostIs = num(row.search_rank_lost_is);
    countries.push({
      countryCode: row.country_code,
      impressionShare: num(row.search_impression_share),
      totalLostIs: Math.round((budgetLostIs + rankLostIs) * 10000) / 10000,
      driver: classifyLossDriver(budgetLostIs, rankLostIs),
      cost: num(row.total_cost),
    });
  }

  countries.sort((a, b) => b.totalLostIs - a.totalLostIs);
  return { countries: countries.slice(0, topN), peilmaand };
}
