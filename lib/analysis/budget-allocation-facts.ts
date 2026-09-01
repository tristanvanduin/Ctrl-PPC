// Hefboom 2: de pure voorcompute voor marginale budgetallocatie. Bepaalt waar de volgende
// euro heen moet en waar hij vandaan komt, op drie deterministische assen: efficientie
// tegen de target (CPA of ROAS), groeiruimte (budget-lost impression share en
// budgetbenutting) en verzadiging (rank-lost impression share). Bouwt voort op de IS-data
// van G1. IO-vrij en los getest; de endpoint merget ads_campaign_impression_share (verlies,
// benutting) met ads_campaign_monthly (conversiewaarde) op één peilmaand en roept dit aan.
//
// De marginale gedachte: de volgende euro gaat naar een campagne die efficient EN
// budget-beperkt is (bewezen vraag die hij niet volledig bedient), en komt van een campagne
// die de target mist. Een rang-beperkte campagne krijgt geen budget, want daar is het bod of
// de kwaliteit de rem, niet het budget (dat is de G1-actie).
//
// Herbouwd 1 september 2026 na de sloop-audit, drie reparaties in het oordeel zelf:
// 1. Volumedrempel: één maand met 2 conversies is ruis, geen bewijs. Onder
//    MIN_CONVERSIES_OORDEEL wordt de efficientie "unknown" (hold), tenzij de campagne
//    veel uitgeeft zonder te converteren — dat is juist het hardste "missing"-signaal
//    en dat miste de oude versie volledig (conversions 0 gaf "unknown").
// 2. De ROAS-tak eist nu échte conversiewaarde (> 0). Eerst won hij zodra de kolom
//    bestond, ook bij 0 — waardoor een leadgen-account met per ongeluk beide targets
//    over de hele linie "missing" kreeg.
// 3. marginalScore kreeg een vloer voor kandidaten waarvan de groeiruimte uit de
//    budgetbenutting komt (budget-lost 0): die belandden altijd onderaan de ranking.

export type BudgetAction = "scale_up" | "scale_down" | "hold";
export type EfficiencyStatus = "beating" | "on_target" | "missing" | "unknown";

export const EFFICIENCY_MARGIN = 0.10; // binnen 10 procent van de target is op target
export const HEADROOM_LOST_IS = 0.10; // budget-lost IS vanaf 10 procent is echte groeiruimte
export const HIGH_UTILIZATION = 0.9; // budgetbenutting vanaf 90 procent tikt tegen het plafond
export const RANK_SATURATED = 0.2; // rank-lost IS vanaf 20 procent is rang-beperkt
// Onder dit aantal conversies in de peilmaand is een CPA/ROAS-oordeel ruis, geen meting.
export const MIN_CONVERSIES_OORDEEL = 5;
// Nul (of bijna nul) conversies is WEL een oordeel zodra de spend een veelvoud van de
// doel-CPA is: dan koopt de campagne aantoonbaar niets voor het geld.
export const ZERO_CONV_KOSTEN_FACTOR = 3; // maal de doel-CPA
// Zonder doel-CPA (alleen een ROAS-doel) geldt een absolute ondergrens voor datzelfde
// nul-oordeel, zodat een campagne van een paar tientjes niet als bleeder wordt aangemerkt.
export const ZERO_CONV_KOSTEN_MINIMUM = 100; // euro in de peilmaand

export interface CampaignBudgetInput {
  campaignId: string;
  campaignName: string;
  cost?: number | null;
  conversions?: number | null;
  conversionsValue?: number | null;
  budgetLostIs?: number | null;
  rankLostIs?: number | null;
  budgetUtilization?: number | null;
}

export interface BudgetTarget {
  targetCpa?: number | null;
  targetRoas?: number | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Efficientie tegen de target. ROAS krijgt voorrang als er een ROAS-target en échte
// conversiewaarde is (hoger is beter); anders CPA (lager is beter). Onder de volumedrempel
// is er geen oordeel — behalve voor de grootspender zonder conversies, die "missing" is.
export function efficiencyStatus(campaign: CampaignBudgetInput, target: BudgetTarget): EfficiencyStatus {
  const cost = num(campaign.cost);
  const conversions = num(campaign.conversions);
  const value = num(campaign.conversionsValue);
  const heeftRoasDoel = target.targetRoas != null && target.targetRoas > 0;
  const heeftCpaDoel = target.targetCpa != null && target.targetCpa > 0;

  // De volumepoort. Is het conversieaantal bekend, dan telt dat; is het niet meegegeven
  // (een pure waarde-aanroep), dan geldt de waarde als bewijs. Zonder volume is er geen
  // oordeel — behalve het nul-oordeel: veel uitgeven zonder conversies én zonder waarde is
  // de hardste vorm van "missing", met of zonder waarde-tracking.
  const conversiesBekend = typeof campaign.conversions === "number" && Number.isFinite(campaign.conversions);
  const teWeinigVolume = conversiesBekend ? conversions < MIN_CONVERSIES_OORDEEL : value <= 0;
  if ((heeftCpaDoel || heeftRoasDoel) && teWeinigVolume) {
    const drempel = heeftCpaDoel
      ? (target.targetCpa as number) * ZERO_CONV_KOSTEN_FACTOR
      : ZERO_CONV_KOSTEN_MINIMUM;
    // Alleen bij letterlijk nul conversies: 2 conversies op €90 is ruis en blijft
    // "unknown", 0 conversies op een veelvoud van de doel-CPA is een meting.
    if (cost >= drempel && value === 0 && conversions === 0) return "missing";
    return "unknown";
  }

  if (heeftRoasDoel && value > 0 && cost > 0) {
    const roas = value / cost;
    if (roas >= (target.targetRoas as number) * (1 + EFFICIENCY_MARGIN)) return "beating";
    if (roas >= (target.targetRoas as number) * (1 - EFFICIENCY_MARGIN)) return "on_target";
    return "missing";
  }
  if (heeftCpaDoel && conversions > 0) {
    const cpa = cost / conversions;
    if (cpa <= (target.targetCpa as number) * (1 - EFFICIENCY_MARGIN)) return "beating";
    if (cpa <= (target.targetCpa as number) * (1 + EFFICIENCY_MARGIN)) return "on_target";
    return "missing";
  }
  return "unknown";
}

export interface BudgetFact {
  campaignId: string;
  campaignName: string;
  efficiency: EfficiencyStatus;
  hasHeadroom: boolean;
  rankLimited: boolean;
  action: BudgetAction;
  cpa: number | null;
  roas: number | null;
  cost: number;
  conversions: number;
  budgetLostIs: number;
  rankLostIs: number;
  marginalScore: number; // hoger betekent een betere plek voor de volgende euro
  reason: string;
}

// De budgetbeslissing per campagne. scale_up alleen bij efficient plus groeiruimte plus
// niet rang-beperkt; scale_down bij het missen van de target; anders hold.
export function budgetActionFor(campaign: CampaignBudgetInput, target: BudgetTarget): BudgetFact {
  const cost = num(campaign.cost);
  const conversions = num(campaign.conversions);
  const budgetLostIs = num(campaign.budgetLostIs);
  const rankLostIs = num(campaign.rankLostIs);
  const efficiency = efficiencyStatus(campaign, target);
  const hasHeadroom = budgetLostIs >= HEADROOM_LOST_IS || num(campaign.budgetUtilization) >= HIGH_UTILIZATION;
  const rankLimited = rankLostIs >= RANK_SATURATED;

  let action: BudgetAction;
  let reason: string;
  if ((efficiency === "beating" || efficiency === "on_target") && hasHeadroom && !rankLimited) {
    action = "scale_up";
    reason = "efficient en budget-beperkt met groeiruimte";
  } else if (efficiency === "missing") {
    action = "scale_down";
    reason = conversions < MIN_CONVERSIES_OORDEEL
      ? "geeft een veelvoud van de doel-CPA uit zonder conversies"
      : "haalt de target niet, budget beter elders benut";
  } else if (rankLimited && (efficiency === "beating" || efficiency === "on_target")) {
    action = "hold";
    reason = "efficient maar rang-beperkt: eerst bod of kwaliteit, geen extra budget";
  } else {
    action = "hold";
    reason = efficiency === "unknown"
      ? (conversions < MIN_CONVERSIES_OORDEEL && (target.targetCpa || target.targetRoas)
          ? "te weinig conversies in de peilmaand voor een oordeel"
          : "geen target of basis om efficientie te beoordelen")
      : "geen duidelijk budgetsignaal";
  }

  const cpa = conversions > 0 ? Math.round((cost / conversions) * 100) / 100 : null;
  const roas = campaign.conversionsValue != null && cost > 0 ? Math.round((num(campaign.conversionsValue) / cost) * 100) / 100 : null;

  // Marginale score voor de rangschikking van scale_up: hoe ver boven target maal de
  // groeiruimte. Komt de ruimte uit de budgetbenutting (budget-lost 0), dan geldt de
  // headroom-drempel als vloer — anders belandt die kandidaat altijd onderaan.
  let marginalScore = 0;
  if (action === "scale_up") {
    let overTarget = 0;
    if (target.targetRoas != null && roas != null && target.targetRoas > 0) overTarget = (roas - target.targetRoas) / target.targetRoas;
    else if (target.targetCpa != null && cpa != null && target.targetCpa > 0) overTarget = (target.targetCpa - cpa) / target.targetCpa;
    const groeiruimte = Math.max(budgetLostIs, num(campaign.budgetUtilization) >= HIGH_UTILIZATION ? HEADROOM_LOST_IS : 0);
    marginalScore = Math.round(Math.max(0, overTarget) * groeiruimte * 10000) / 10000;
  }

  return { campaignId: campaign.campaignId, campaignName: campaign.campaignName, efficiency, hasHeadroom, rankLimited, action, cpa, roas, cost, conversions, budgetLostIs, rankLostIs, marginalScore, reason };
}

export interface BudgetAllocationSummary {
  campaignsAnalysed: number;
  scaleUp: number;
  scaleDown: number;
  hold: number;
  hasTarget: boolean;
}

// De volledige analyse: per campagne de beslissing, plus het herallocatie-voorstel met de
// scale_up-kandidaten (gerangschikt op marginale score, beste plek voor de volgende euro)
// en de scale_down-kandidaten (gerangschikt op grootste inefficientie, eerste bron).
export function analyzeBudgetAllocation(campaigns: CampaignBudgetInput[], target: BudgetTarget): {
  campaigns: BudgetFact[];
  scaleUp: BudgetFact[];
  scaleDown: BudgetFact[];
  summary: BudgetAllocationSummary;
} {
  const facts = campaigns
    .filter((c) => c.campaignId)
    .map((c) => budgetActionFor(c, target));

  const scaleUp = facts.filter((f) => f.action === "scale_up").sort((a, b) => b.marginalScore - a.marginalScore);
  const scaleDown = facts
    .filter((f) => f.action === "scale_down")
    .sort((a, b) => b.cost - a.cost); // grootste verspilling eerst, gemeten aan spend op de misser

  const summary: BudgetAllocationSummary = {
    campaignsAnalysed: facts.length,
    scaleUp: scaleUp.length,
    scaleDown: scaleDown.length,
    hold: facts.filter((f) => f.action === "hold").length,
    hasTarget: target.targetCpa != null || target.targetRoas != null,
  };

  return { campaigns: facts, scaleUp, scaleDown, summary };
}
