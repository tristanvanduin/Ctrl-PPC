/**
 * Shopping Campaign Scorecard (masterplan sectie 5.4, Campaign Type Intelligence)
 *
 * Zelfde vorm als lib/search-scorecard.ts en lib/pmax-scorecard.ts (HealthScore, 0-20 per factor,
 * "assessed" i.p.v. een gegokte score bij te weinig data), met een EIGEN opbouw: Shopping draait
 * op producten en een feed, niet op keywords (Search) of doelgroepen (Display).
 *
 * ── DE VIJF FACTOREN ──────────────────────────────────────────────────────────
 *
 *   Conversion Efficiency   CPA-trend (cost/conversions), trendOver() -- zelfde functie en venster
 *                           als de andere scorecards, hier op campaign_type='SHOPPING'-rijen.
 *   Demand Capture          CTR-trend (clicks/impressions) -- "klikt men op de productadvertentie
 *                           als hij getoond wordt", los van de vraag of de klik converteert.
 *   Auction Pressure        avg_cpc-trend (cost/clicks). Zelfde signaal en drempel-vorm als Search'
 *                           Auction Pressure -- concurrentiedruk op de veiling, hier voor Shopping-
 *                           veilingen i.p.v. zoekwoordveilingen.
 *   Product-efficiëntie     ads_product_performance_monthly (campaign_type='SHOPPING'), via
 *                           aggregateByEntity() (lib/analysis/pmax-expert-layer.ts, een gedeelde
 *                           laag-op-entiteit-aggregator -- geen Shopping-specifieke logica, wél
 *                           al hergebruikt door de PMax-scorecard voor placements). Aandeel spend
 *                           op producten zonder conversie.
 *   Feed Health             Merchant Center-koppeling. merchant_product_snapshots bestaat maar
 *                           heeft NUL rijen voor elke klant (zelfde tabel, zelfde gat als PMax'
 *                           Feed Health-factor, geverifieerd 15 augustus voor PMax en hier opnieuw
 *                           bevestigd voor Shopping). Altijd assessed:false tot die koppeling er
 *                           is -- regel 3 van de vertrouwensdoctrine, geen gegokte score.
 */

import type { HealthScore, HealthFactor } from "./health-score";
import { samenvatFactoren } from "./health-score";
import { trendOver } from "./analysis/trend";
import { aggregateByEntity } from "./analysis/pmax-expert-layer";

export interface ShoppingCampaignMonthlyRow {
  campaign_name: string;
  month: string;
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

export interface ShoppingProductRow {
  product_title: string;
  cost: number;
  clicks: number;
  conversions: number;
  impressions: number;
}

interface MaandTotaal {
  month: string;
  cost: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

function perMaand(rows: readonly ShoppingCampaignMonthlyRow[]): MaandTotaal[] {
  const map = new Map<string, MaandTotaal>();
  for (const r of rows) {
    const bestaand = map.get(r.month) ?? { month: r.month, cost: 0, conversions: 0, clicks: 0, impressions: 0 };
    bestaand.cost += r.cost;
    bestaand.conversions += r.conversions;
    bestaand.clicks += r.clicks;
    bestaand.impressions += r.impressions;
    map.set(r.month, bestaand);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Zelfde vier-banden-vorm als search-scorecard.ts/display-scorecard.ts, onafhankelijk hier
// neergezet (zie de toelichting in display-scorecard.ts voor waarom niet gedeeld).
function trendScoreDalendIsGoed(trendPct: number): number {
  if (trendPct < -10) return 20;
  if (trendPct < 5) return 16;
  if (trendPct < 20) return 10;
  return 4;
}
function trendScoreStijgendIsGoed(trendPct: number): number {
  if (trendPct > 10) return 20;
  if (trendPct > -10) return 14;
  if (trendPct > -25) return 8;
  return 4;
}
function aandeelScoreOmgekeerd(aandeel: number): number {
  if (aandeel < 0.10) return 20;
  if (aandeel < 0.25) return 14;
  if (aandeel < 0.40) return 8;
  return 4;
}

/**
 * Bouwt de Shopping-scorecard. `campMonthlyRows` zijn ads_campaign_monthly-rijen, vooraf gefilterd
 * op campaign_type = 'SHOPPING' door de aanroeper. `productRows` zijn ads_product_performance_
 * monthly-rijen, ook al gefilterd op campaign_type = 'SHOPPING' (die tabel draagt zowel SHOPPING
 * als PERFORMANCE_MAX, zie lib/types/dimensional.ts).
 */
export function computeShoppingScorecard(
  campMonthlyRows: readonly ShoppingCampaignMonthlyRow[],
  productRows: readonly ShoppingProductRow[],
): HealthScore {
  const factors: HealthFactor[] = [];
  const maanden = perMaand(campMonthlyRows);

  // ── 1. CONVERSION EFFICIENCY (20pt) ──
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

  // ── 2. DEMAND CAPTURE (20pt) ──
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

  // ── 3. AUCTION PRESSURE (20pt) ──
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

  // ── 4. PRODUCT-EFFICIËNTIE (20pt) ──
  const producten = aggregateByEntity(productRows as unknown as Array<Record<string, unknown>>, "product_title");
  const productTotalCost = producten.reduce((s, p) => s + p.cost, 0);
  const productBeoordeeld = productTotalCost > 0;
  const wasteProducten = producten.filter((p) => p.cost > 20 && p.conversions === 0);
  const wasteCost = wasteProducten.reduce((s, p) => s + p.cost, 0);
  const wasteRatio = productBeoordeeld ? wasteCost / productTotalCost : 0;
  factors.push({
    name: "Product-efficiëntie",
    score: productBeoordeeld ? aandeelScoreOmgekeerd(wasteRatio) : 0,
    maxScore: 20,
    description: productBeoordeeld
      ? wasteProducten.length > 0
        ? `${Math.round(wasteRatio * 100)}% van de productspend (${wasteProducten.length} producten) zonder conversie`
        : "Geen producten met spend zonder conversie"
      : "Geen productdata — niet beoordeeld",
    assessed: productBeoordeeld,
  });

  // ── 5. FEED HEALTH (20pt) ── — zie de kop: altijd onbeoordeeld tot Merchant Center gesynct is.
  factors.push({
    name: "Feed Health",
    score: 0,
    maxScore: 20,
    description: "Geen Merchant Center-koppeling gesynct — niet beoordeeld",
    assessed: false,
  });

  return { factors, anomalies: [], ...samenvatFactoren(factors) };
}
