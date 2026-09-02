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
 *                          verhouding meer kosten dan opleveren. Zonder één conversie in het
 *                          venster is er niets om tegen af te wegen: dan onbeoordeeld, geen
 *                          gratis 20 punten (sloop-audit 1 september: 0 conversies gaf "geen
 *                          netwerk kost meer dan het oplevert" — groen zonder bewijs).
 *   Placement-efficiëntie  Google publiceert per PMax-placement UITSLUITEND vertoningen — geen
 *                          kosten, geen conversies (zie pmaxPlacementRows in lib/demo/
 *                          pmax-video-demo.ts) — en ads_pmax_placements is in de echte database
 *                          leeg. De oude euro-drempel kon dus nooit iets vinden en las als
 *                          "geen verspilling". Altijd assessed:false, met in de tekst wat er wél
 *                          zichtbaar is (vertoningen). Zelfde vertrouwensregel als Feed Health.
 *   Cannibalisatie         detecteerCannibalisatie() (lib/analysis/pmax-expert-layer.ts) — losge-
 *                          trokken uit signaal 7 zodat dezelfde maand-op-maand-vergelijking hier
 *                          en in de SOP-signalen identiek blijft.
 *
 * Asset Health, Netwerkmix en Cannibalisatie zijn dus geen nieuwe berekening maar een herschaling
 * van een bestaande naar 0-20 punten. Dat is met opzet: twee versies van "hoeveel budget zit in
 * een dure assetgroep" die uiteen kunnen lopen is precies het soort bug dat de mediaan/safeDiv-
 * hygiënecontrole al een keer boven water haalde voor andere functies. Feed Health en Placement-
 * efficiëntie rekenen helemaal niet: daar ontbreekt de data, en dat zeggen ze.
 */

import type { HealthScore, HealthFactor } from "./health-score";
import { samenvatFactoren } from "./health-score";
import { analyseerAssetdekking, type AssetRegel } from "./pmax/assetdekking";
import { buildNetworkSplit, findImbalances, type NetworkRow } from "./pmax/network-split";
import { detecteerCannibalisatie } from "./analysis/pmax-expert-layer";
import { aandeelScoreOmgekeerd } from "./util/scorecard-scores";

export interface PmaxPlacementRow {
  placement: string;
  /**
   * Het enige dat Google per PMax-placement publiceert. Kosten, klikken en conversies bestaan
   * hier niet (zie de kop van pmaxPlacementRows in lib/demo/pmax-video-demo.ts) — wie ze hier
   * toevoegt, bouwt een oordeel op een kolom die altijd leeg is.
   */
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
  const totalNetworkConversies = slices.reduce((s, n) => s + n.conversions, 0);
  const heeftNetwerkData = slices.length > 0 && totalCost > 0;
  // Zonder één conversie in het venster kan geen netwerk ooit "duur" zijn (findImbalances laat
  // shareGap dan null): dat gaf 20/20 met de tekst "geen netwerk kost meer dan het oplevert",
  // terwijl er niets afgewogen ís. Onbekend is geen goede score.
  const networkBeoordeeld = heeftNetwerkData && totalNetworkConversies > 0;
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
      : heeftNetwerkData
        ? "Geen conversies om netwerken tegen af te wegen — niet beoordeeld"
        : "Geen netwerkverdeling bekend — niet beoordeeld",
    assessed: networkBeoordeeld,
  });

  // ── 4. PLACEMENT-EFFICIËNTIE (20pt) ── — zie de kop: Google levert per PMax-placement alleen
  // vertoningen, dus "aandeel spend/vertoningen op plaatsingen zonder conversie" is niet meetbaar.
  // De factor zegt wat er wél zichtbaar is (vertoningen) en blijft eerlijk onbeoordeeld.
  const uniekePlacements = new Set(input.placementRows.map((p) => p.placement).filter((p) => p.trim() !== ""));
  const placementImpressies = input.placementRows.reduce((s, p) => s + p.impressions, 0);
  factors.push({
    name: "Placement-efficiëntie",
    score: 0,
    maxScore: 20,
    description: input.placementRows.length === 0
      ? "Google publiceert geen kosten of conversies per PMax-placement, en er zijn geen placementrijen gesynct — niet beoordeeld"
      : `${uniekePlacements.size} plaatsingen met samen ${placementImpressies.toLocaleString("nl-NL")} vertoningen, maar Google publiceert geen kosten of conversies per PMax-placement — efficiëntie niet te beoordelen`,
    assessed: false,
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
