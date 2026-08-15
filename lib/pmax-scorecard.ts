/**
 * PMax Campaign Scorecard (masterplan sectie 5.4, Campaign Type Intelligence)
 *
 * Zelfde vorm als lib/search-scorecard.ts (HealthScore, 0-20 per factor, "assessed" i.p.v. een
 * gegokte score bij te weinig data), maar met een EIGEN opbouw — de validatie waarschuwt er
 * expliciet voor om Search-logica "omdat de code er staat" op PMax te plakken. PMax en Search
 * hebben andere succesfactoren: PMax draait op assets en netwerkverdeling, niet op keywords en
 * impression share.
 *
 * ── DE VIJF FACTOREN, EN WAAROM ZE GEEN NIEUWE REKENSOM ZIJN ──────────────────
 *
 *   Asset Health          analyseerAssetdekking() (lib/pmax/assetdekking.ts) — al gebouwd voor de
 *                          assetdekkingskaart. Aandeel assetgroepen zonder tekort/zwak/video.
 *   Feed Health            Merchant Center-koppeling. merchant_product_snapshots bestaat (scripts/
 *                          merchant-product-snapshots.sql) maar heeft vandaag NUL rijen voor elke
 *                          klant (geverifieerd 15 augustus) — geen sync heeft ooit geschreven.
 *                          Altijd assessed:false tot die koppeling er is. Regel 3 van de vertrouwens-
 *                          doctrine: dit is het eerlijke antwoord, geen ontbrekende bouw.
 *   Netwerkmix-efficiëntie buildNetworkSplit()/findImbalances() (lib/pmax/network-split.ts) — al
 *                          gebouwd voor de netwerkkaart. Aandeel budget in netwerken die naar
 *                          verhouding meer kosten dan opleveren.
 *   Placement-efficiëntie  aggregateByEntity() (lib/analysis/pmax-expert-layer.ts) — al gebruikt
 *                          voor het placement-waste-signaal. Aandeel spend op plaatsingen zonder
 *                          conversie.
 *   Cannibalisatie         detecteerCannibalisatie() (lib/analysis/pmax-expert-layer.ts) — losge-
 *                          trokken uit signaal 7 zodat dezelfde maand-op-maand-vergelijking hier
 *                          en in de SOP-signalen identiek blijft.
 *
 * Vier van de vijf factoren zijn dus geen nieuwe berekening maar een herschaling van een bestaande
 * naar 0-20 punten. Dat is met opzet: twee versies van "hoeveel budget zit in een dure asset-
 * groep" die uiteen kunnen lopen is precies het soort bug dat de mediaan/safeDiv-hygiënecontrole
 * al een keer boven water haalde voor andere functies.
 */

import type { HealthScore, HealthFactor } from "./health-score";
import { samenvatFactoren } from "./health-score";
import { analyseerAssetdekking, type AssetRegel } from "./pmax/assetdekking";
import { buildNetworkSplit, findImbalances, type NetworkRow } from "./pmax/network-split";
import { aggregateByEntity, detecteerCannibalisatie } from "./analysis/pmax-expert-layer";

export interface PmaxPlacementRow {
  placement: string;
  cost: number;
  conversions: number;
  impressions: number;
}

export interface PmaxCampaignMonthlyRow {
  campaign_name: string;
  month: string;
  cost: number;
  conversions: number;
}

export interface PmaxScorecardInput {
  /** ads_pmax_asset_performance-rijen, laatste ~12 maanden. */
  assetRows: readonly AssetRegel[];
  /** ads_pmax_network_breakdown-rijen, laatste ~12 maanden. */
  networkRows: readonly NetworkRow[];
  /** ads_pmax_placements-rijen, laatste ~12 maanden. */
  placementRows: readonly PmaxPlacementRow[];
  /** ads_campaign_monthly-rijen over alle campagnetypes, laatste ~90 dagen. */
  campMonthlyRows: readonly PmaxCampaignMonthlyRow[];
  /** Campagnenamen van de PMax-campagnes in dit account, voor de cannibalisatie-vergelijking. */
  pmaxCampaignNames: readonly string[];
}

// Zelfde vier-banden-vorm als search-scorecard.ts en health-score.ts, voor een gelijk
// schaalgevoel tussen de scorecards. Hier op een AANDEEL (0-1) in plaats van een trendpercentage.
function aandeelScoreOmgekeerd(aandeel: number): number {
  // Voor een "slecht aandeel" (verspilling, dure netwerken): laag is goed.
  if (aandeel < 0.10) return 20;
  if (aandeel < 0.25) return 14;
  if (aandeel < 0.40) return 8;
  return 4;
}

export function computePmaxScorecard(input: PmaxScorecardInput): HealthScore {
  const factors: HealthFactor[] = [];

  // ── 1. ASSET HEALTH (20pt) ──
  const assetdekking = analyseerAssetdekking(input.assetRows);
  const totaalGroepen = assetdekking.groepen.length;
  const assetHealthBeoordeeld = totaalGroepen > 0;
  const compleetRatio = assetHealthBeoordeeld ? assetdekking.compleet / totaalGroepen : 0;
  const assetHealthScore = compleetRatio >= 0.90 ? 20 : compleetRatio >= 0.70 ? 16 : compleetRatio >= 0.40 ? 10 : compleetRatio >= 0.15 ? 4 : 0;
  factors.push({
    name: "Asset Health",
    score: assetHealthBeoordeeld ? assetHealthScore : 0,
    maxScore: 20,
    description: assetHealthBeoordeeld
      ? `${assetdekking.compleet}/${totaalGroepen} assetgroepen zonder tekort, zwakke asset of ontbrekende video`
      : "Geen PMax-assetgroepen gevonden — niet beoordeeld",
    assessed: assetHealthBeoordeeld,
  });

  // ── 2. FEED HEALTH (20pt) ── — zie de kop: altijd onbeoordeeld tot Merchant Center gesynct is.
  factors.push({
    name: "Feed Health",
    score: 0,
    maxScore: 20,
    description: "Geen Merchant Center-koppeling gesynct — niet beoordeeld",
    assessed: false,
  });

  // ── 3. NETWERKMIX-EFFICIËNTIE (20pt) ──
  const slices = buildNetworkSplit(input.networkRows as NetworkRow[]);
  const totalCost = slices.reduce((s, n) => s + n.cost, 0);
  const networkBeoordeeld = slices.length > 0 && totalCost > 0;
  const dureImbalances = networkBeoordeeld ? findImbalances(slices).filter((i) => i.kind === "duur") : [];
  const dureAandeel = networkBeoordeeld ? dureImbalances.reduce((s, i) => s + i.slice.costShare, 0) : 0;
  factors.push({
    name: "Netwerkmix",
    score: networkBeoordeeld ? aandeelScoreOmgekeerd(dureAandeel) : 0,
    maxScore: 20,
    description: networkBeoordeeld
      ? dureImbalances.length > 0
        ? `${Math.round(dureAandeel * 100)}% van de spend zit in netwerken die naar verhouding meer kosten dan opleveren (${dureImbalances.map((i) => i.slice.label).join(", ")})`
        : "Geen netwerk kost naar verhouding meer dan het oplevert"
      : "Geen netwerkverdeling bekend — niet beoordeeld",
    assessed: networkBeoordeeld,
  });

  // ── 4. PLACEMENT-EFFICIËNTIE (20pt) ──
  const placements = aggregateByEntity(input.placementRows as unknown as Array<Record<string, unknown>>, "placement");
  const placementTotalCost = placements.reduce((s, p) => s + p.cost, 0);
  const placementBeoordeeld = placementTotalCost > 0;
  const wastePlacements = placements.filter((p) => p.cost > 20 && p.conversions === 0);
  const wasteCost = wastePlacements.reduce((s, p) => s + p.cost, 0);
  const wasteRatio = placementBeoordeeld ? wasteCost / placementTotalCost : 0;
  factors.push({
    name: "Placement-efficiëntie",
    score: placementBeoordeeld ? aandeelScoreOmgekeerd(wasteRatio) : 0,
    maxScore: 20,
    description: placementBeoordeeld
      ? wastePlacements.length > 0
        ? `${Math.round(wasteRatio * 100)}% van de placementspend (${wastePlacements.length} plaatsingen) zonder conversie`
        : "Geen plaatsingen met spend zonder conversie"
      : "Geen placementdata — niet beoordeeld",
    assessed: placementBeoordeeld,
  });

  // ── 5. CANNIBALISATIE MET SEARCH/SHOPPING (20pt) ──
  const cannibalisatie = input.campMonthlyRows.length > 0
    ? detecteerCannibalisatie(input.campMonthlyRows as unknown as Array<Record<string, unknown>>, input.pmaxCampaignNames)
    : null;
  const cannibalisatieBeoordeeld = cannibalisatie !== null;
  const cannibalisatieScore = !cannibalisatie ? 0 : cannibalisatie.severity === "hoog" ? 2 : cannibalisatie.severity === "mogelijk" ? 10 : 20;
  factors.push({
    name: "Cannibalisatie met Search/Shopping",
    score: cannibalisatieBeoordeeld ? cannibalisatieScore : 0,
    maxScore: 20,
    description: !cannibalisatie
      ? "Te weinig maanden campagnedata voor een vergelijking — niet beoordeeld"
      : cannibalisatie.severity
        ? `PMax-conversies ${cannibalisatie.pmaxConvGrowth >= 0 ? "+" : ""}${Math.round(cannibalisatie.pmaxConvGrowth * 100)}% terwijl Search/Shopping ${Math.round(cannibalisatie.otherConvGrowth * 100)}% daalt (${cannibalisatie.severity} risico op verschuiving i.p.v. groei)`
        : "Geen aanwijzing dat PMax bestaande Search/Shopping-conversies overneemt",
    assessed: cannibalisatieBeoordeeld,
  });

  return { factors, anomalies: [], ...samenvatFactoren(factors) };
}
