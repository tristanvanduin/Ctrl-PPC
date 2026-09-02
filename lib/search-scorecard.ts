/**
 * Search Campaign Scorecard (masterplan sectie 5.4, Campaign Type Intelligence)
 *
 * Vijf factoren, zelfde vorm als lib/health-score.ts (0-20 per factor, "assessed" i.p.v. een
 * gegokte score bij te weinig data) maar dan uitsluitend over Search-campagnes (campaign_type =
 * 'SEARCH'), niet over het hele account. Dat onderscheid is het hele punt: een account met Search
 * + PMax gemengd kan een dalende Search-efficiency verbergen achter een verbeterende PMax.
 *
 * ── WAAROM DEZE VIJF, EN NIET DE VIJF UIT DE COPILOT-PROMPT LETTERLIJK ────────
 *
 * De prompt noemde "Demand Capture Score" en "Auction Pressure Score" zonder te specificeren
 * welke kolom daarachter zit. Nagegaan tegen ads_campaign_impression_share (heeft month, cost,
 * conversions, clicks, impressions, search_impression_share, search_budget_lost_is,
 * search_rank_lost_is -- geverifieerd 15 augustus) en ads_keyword_performance_monthly (heeft
 * quality_score per keyword):
 *
 *   Impression Share Score    search_impression_share, spend-gewogen over Search-campagnes.
 *   Search Quality Score      spendWeightedQualityScore() -- dezelfde functie als de Math Gate
 *                             (lib/analysis/metric-cross-checks.ts) al gebruikt, geen tweede keer
 *                             geschreven.
 *   Conversion Efficiency     CPA-trend (cost/conversions) over de maanden, trendOver() --
 *                             dezelfde functie als de Efficiency-factor in health-score.ts, maar
 *                             hier alleen op Search-kosten/-conversies.
 *   Auction Pressure          avg_cpc-trend (cost/clicks). Stijgende CPC bij gelijkblijvende
 *                             kwaliteit is het schoonste signaal voor toenemende concurrentiedruk
 *                             dat deze tabel draagt -- er is geen overlap_rate/top_of_page-kolom.
 *   Demand Capture            CTR-trend (clicks/impressions). Onderscheidt "worden we getoond"
 *                             (Impression Share) van "klikt men als we getoond worden" (Demand
 *                             Capture) -- twee verschillende assen, niet dezelfde vraag twee keer.
 *
 * Alle vier trend-factoren hergebruiken trendOver() uit lib/analysis/trend.ts: zelfde 3-maands
 * venster, zelfde "0 bij te weinig data"-vangnet als de rest van de codebase.
 */

import type { HealthScore, HealthFactor } from "./health-score";
import { samenvatFactoren } from "./health-score";
import { spendWeightedQualityScore, type KeywordQsRow } from "./analysis/metric-cross-checks";
import { trendOver } from "./analysis/trend";
import { trendScoreDalendIsGoed, trendScoreStijgendIsGoed } from "./util/scorecard-scores";

export interface SearchImpressionShareRow {
  campaignId: string;
  month: string; // YYYY-MM-DD, eerste van de maand
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
  searchImpressionShare: number;
  searchBudgetLostIS: number;
  searchRankLostIS: number;
}

interface MaandTotaal {
  month: string;
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
  isGewogenSom: number; // voor het spend-gewogen gemiddelde van searchImpressionShare
}

function perMaand(rows: readonly SearchImpressionShareRow[]): MaandTotaal[] {
  const map = new Map<string, MaandTotaal>();
  for (const r of rows) {
    const bestaand = map.get(r.month) ?? { month: r.month, cost: 0, conversions: 0, clicks: 0, impressions: 0, isGewogenSom: 0 };
    bestaand.cost += r.cost;
    bestaand.conversions += r.conversions;
    bestaand.clicks += r.clicks;
    bestaand.impressions += r.impressions;
    bestaand.isGewogenSom += r.searchImpressionShare * r.cost;
    map.set(r.month, bestaand);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Drempels voor de vier score-op-trend-factoren: de gedeelde banden uit lib/util/scorecard-scores.ts
// (zelfde bandbreedtes als de Efficiency-factor in health-score.ts), zodat de vier scorecards niet
// vier schaalgevoelens naast elkaar tonen. Alleen de twee niveaudrempels hieronder zijn van deze
// scorecard zelf: impression share en quality score zijn standen, geen trends.

function impressionShareScore(iS: number): number {
  if (iS >= 0.80) return 20;
  if (iS >= 0.60) return 16;
  if (iS >= 0.40) return 10;
  if (iS >= 0.20) return 4;
  return 0;
}

function qualityScoreNaarPunten(qs: number): number {
  if (qs >= 8) return 20;
  if (qs >= 6) return 16;
  if (qs >= 4) return 10;
  if (qs >= 2) return 4;
  return 0;
}

/**
 * Bouwt de Search-scorecard. `rows` zijn ads_campaign_impression_share-rijen, vooraf gefilterd
 * op campaign_type = 'SEARCH' door de aanroeper (deze functie kent geen campaign_type-veld en
 * gokt dus niets over welke rijen erbij horen). `keywords` zijn ads_keyword_performance_monthly-
 * rijen voor dezelfde Search-campagnes, uit de jongste maand die de keywordtabel zélf heeft.
 *
 * `keywordMaand` ("YYYY-MM") is die maand, en hoort in de factortekst: de keywordtabel loopt
 * live maanden achter op de impression-share-tabel, en een quality score zonder maand erbij
 * leest als "van nu" terwijl hij van maanden geleden kan zijn.
 */
export function computeSearchScorecard(
  rows: readonly SearchImpressionShareRow[],
  keywords: readonly KeywordQsRow[],
  keywordMaand?: string | null,
): HealthScore {
  const factors: HealthFactor[] = [];
  const maanden = perMaand(rows);
  const laatsteMaand = maanden[maanden.length - 1];

  // ── 1. IMPRESSION SHARE (20pt) ──
  const heeftImpressionShareData = laatsteMaand !== undefined && laatsteMaand.cost > 0;
  const gemiddeldeIS = heeftImpressionShareData ? laatsteMaand.isGewogenSom / laatsteMaand.cost : 0;
  factors.push({
    name: "Impression Share",
    score: heeftImpressionShareData ? impressionShareScore(gemiddeldeIS) : 0,
    maxScore: 20,
    description: heeftImpressionShareData
      ? `${Math.round(gemiddeldeIS * 100)}% spend-gewogen search impression share`
      : "Geen Search-campagnedata deze maand — niet beoordeeld",
    assessed: heeftImpressionShareData,
  });

  // ── 2. SEARCH QUALITY (20pt) ──
  const spendGewogenQs = spendWeightedQualityScore(keywords as KeywordQsRow[]);
  factors.push({
    name: "Search Quality",
    score: spendGewogenQs !== null ? qualityScoreNaarPunten(spendGewogenQs) : 0,
    maxScore: 20,
    description: spendGewogenQs !== null
      ? `Spend-gewogen quality score ${spendGewogenQs}/10${keywordMaand ? ` (keyworddata van ${keywordMaand})` : ""}`
      : "Geen quality-score-data voor deze keywords — niet beoordeeld",
    assessed: spendGewogenQs !== null,
  });

  // ── 3. CONVERSION EFFICIENCY (20pt) ──
  const cpaReeks = maanden.filter((m) => m.conversions > 0).map((m) => m.cost / m.conversions);
  const efficiencyBeoordeeld = cpaReeks.length >= 2;
  const cpaTrend = efficiencyBeoordeeld ? trendOver(cpaReeks) : 0;
  factors.push({
    name: "Conversion Efficiency",
    score: efficiencyBeoordeeld ? trendScoreDalendIsGoed(cpaTrend) : 0,
    maxScore: 20,
    description: efficiencyBeoordeeld
      ? `CPA-trend ${cpaTrend >= 0 ? "+" : ""}${Math.round(cpaTrend)}% over de laatste maanden`
      : "Te weinig maanden met conversies voor een CPA-trend — niet beoordeeld",
    assessed: efficiencyBeoordeeld,
  });

  // ── 4. AUCTION PRESSURE (20pt) ──
  const cpcReeks = maanden.filter((m) => m.clicks > 0).map((m) => m.cost / m.clicks);
  const auctionBeoordeeld = cpcReeks.length >= 2;
  const cpcTrend = auctionBeoordeeld ? trendOver(cpcReeks) : 0;
  factors.push({
    name: "Auction Pressure",
    score: auctionBeoordeeld ? trendScoreDalendIsGoed(cpcTrend) : 0,
    maxScore: 20,
    description: auctionBeoordeeld
      ? `Gemiddelde CPC-trend ${cpcTrend >= 0 ? "+" : ""}${Math.round(cpcTrend)}% (stijgend = meer concurrentiedruk)`
      : "Te weinig maanden met clicks voor een CPC-trend — niet beoordeeld",
    assessed: auctionBeoordeeld,
  });

  // ── 5. DEMAND CAPTURE (20pt) ──
  const ctrReeks = maanden.filter((m) => m.impressions > 0).map((m) => m.clicks / m.impressions);
  const demandBeoordeeld = ctrReeks.length >= 2;
  const ctrTrend = demandBeoordeeld ? trendOver(ctrReeks) : 0;
  factors.push({
    name: "Demand Capture",
    score: demandBeoordeeld ? trendScoreStijgendIsGoed(ctrTrend) : 0,
    maxScore: 20,
    description: demandBeoordeeld
      ? `CTR-trend ${ctrTrend >= 0 ? "+" : ""}${Math.round(ctrTrend)}% over de laatste maanden`
      : "Te weinig maanden met impressies voor een CTR-trend — niet beoordeeld",
    assessed: demandBeoordeeld,
  });

  return { factors, anomalies: [], ...samenvatFactoren(factors) };
}
