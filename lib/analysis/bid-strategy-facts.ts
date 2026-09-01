// Hefboom 3: de pure voorcompute voor de fit van de biedstrategie. Bepaalt per campagne of
// de huidige strategie past bij het conversievolume, de waarde-tracking en het doel. IO-vrij
// en los getest; de endpoint leest de strategie uit ads_campaign_metadata (waar hij echt
// staat, mét bidding_strategy_target en serving_status) en de prestaties uit
// ads_campaign_monthly over de laatste AFGESLOTEN maanden, en roept dit aan.
//
// Herbouwd 1 september 2026 na de sloop-audit. De oude versie las de strategie uit een
// tabel waar die kolom nooit heeft bestaan (elke run eindigde in een 404), telde de
// conversies van één mogelijk halve maand tegen een per-maand-vuistregel, en stelde de
// kernvraag niet die de metadata wél kan beantwoorden: staat het doel (tCPA/tROAS) op een
// haalbare hoogte?
//
// Smart bidding heeft data nodig om te leren; waarde-bieden heeft conversiewaarde nodig;
// een doelwaarde die mijlenver van de realiteit staat stuurt het leren de verkeerde kant
// op. De classificatie flagt precies die mismatches, in plaats van een generieke checklist.

export type BidStrategyKind = "manual" | "smart_conversion" | "smart_value" | "non_conversion" | "unknown";
export type BidStrategyFit =
  | "fit"
  | "upgrade_to_smart"
  | "switch_to_value"
  | "insufficient_volume"
  | "value_missing"
  | "review_target"
  | "review_non_conversion"
  | "unknown";

export const SMART_BIDDING_MIN_CONV = 15; // per afgesloten maand, vuistregel voor smart bidding om te leren
export const VALUE_BIDDING_MIN_CONV = 30; // per afgesloten maand; waarde-bieden loont pas met genoeg conversies
// Boven deze relatieve afwijking tussen gerealiseerd en ingesteld doel is het doel zelf het
// gesprek waard: 40% is ruim genoeg om maandruis en seizoen niet als "doel fout" te lezen.
export const TARGET_AFWIJKING_REVIEW = 0.4;

// Mapt de echte Google-biedstrategie-strings naar een soort. Case-ongevoelig.
export function normalizeBidStrategy(strategy: string | null | undefined): BidStrategyKind {
  if (!strategy) return "unknown";
  const s = strategy.trim().toUpperCase();
  if (s === "MANUAL_CPC" || s === "ENHANCED_CPC") return "manual";
  if (s === "MAXIMIZE_CONVERSIONS" || s === "TARGET_CPA") return "smart_conversion";
  if (s === "MAXIMIZE_CONVERSION_VALUE" || s === "TARGET_ROAS") return "smart_value";
  if (s === "TARGET_SPEND" || s === "TARGET_IMPRESSION_SHARE") return "non_conversion";
  return "unknown";
}

export interface CampaignBidInput {
  campaignId: string;
  campaignName: string;
  biddingStrategy?: string | null;
  /**
   * De ingestelde doelwaarde uit ads_campaign_metadata: tCPA in euro's of tROAS als
   * verhouding (3.5 = 350%). 0 of null betekent: geen expliciet doel ingesteld.
   */
  biddingStrategyTarget?: number | null;
  /** Totalen over het venster van afgesloten maanden. */
  conversions?: number | null;
  cost?: number | null;
  conversionsValue?: number | null;
}

export interface BidGoal {
  hasCpaTarget: boolean;
  hasRoasTarget: boolean;
  /** De accountdoelen zelf, voor in de prompt; null als niet ingesteld. */
  cpaTarget?: number | null;
  roasTarget?: number | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

interface Afgeleid {
  kind: BidStrategyKind;
  convPerMaand: number;
  hasValue: boolean;
  /** Gerealiseerde CPA over het venster, of null zonder conversies. */
  cpa: number | null;
  /** Gerealiseerde ROAS over het venster, of null zonder kosten. */
  roas: number | null;
  /** gerealiseerd ÷ ingesteld doel, of null als een van beide ontbreekt. */
  targetRatio: number | null;
}

function leidAf(campaign: CampaignBidInput, maandenInVenster: number): Afgeleid {
  const kind = normalizeBidStrategy(campaign.biddingStrategy);
  const maanden = Math.max(1, maandenInVenster);
  const conversions = num(campaign.conversions);
  const cost = num(campaign.cost);
  const value = num(campaign.conversionsValue);
  const cpa = conversions > 0 ? cost / conversions : null;
  const roas = cost > 0 ? value / cost : null;
  const target = num(campaign.biddingStrategyTarget);
  const strategie = (campaign.biddingStrategy ?? "").trim().toUpperCase();
  let targetRatio: number | null = null;
  if (target > 0) {
    if (strategie === "TARGET_CPA" && cpa !== null) targetRatio = cpa / target;
    if (strategie === "TARGET_ROAS" && roas !== null) targetRatio = roas / target;
  }
  return { kind, convPerMaand: conversions / maanden, hasValue: value > 0, cpa, roas, targetRatio };
}

// De fit-classificatie per campagne. De volgorde van de checks is bewust: eerst de
// blokkerende mismatches (waarde ontbreekt, te weinig volume), dan het doelniveau, dan de
// upgrades. Alle volumes zijn per afgesloten maand — het venster bepaalt de aanroeper.
export function classifyBidFit(
  campaign: CampaignBidInput,
  goal: BidGoal,
  maandenInVenster = 1
): BidStrategyFit {
  const d = leidAf(campaign, maandenInVenster);
  if (d.kind === "unknown") return "unknown";

  // Niet-conversie-strategie op een campagne die wel converteert en een doel heeft: review.
  if (d.kind === "non_conversion") {
    return d.convPerMaand >= SMART_BIDDING_MIN_CONV && (goal.hasCpaTarget || goal.hasRoasTarget)
      ? "review_non_conversion"
      : "fit";
  }

  // Waarde-strategie zonder conversiewaarde kan niet op waarde sturen.
  if (d.kind === "smart_value" && !d.hasValue) return "value_missing";

  // Smart bidding zonder genoeg volume kan niet leren.
  if ((d.kind === "smart_value" || d.kind === "smart_conversion") && d.convPerMaand < SMART_BIDDING_MIN_CONV) {
    return "insufficient_volume";
  }

  // Het ingestelde doel staat ver van wat de campagne realiseert: dan is niet de strategie
  // maar de doelwaarde het gesprek. Geldt alleen bij een expliciet doel (tCPA/tROAS met
  // waarde) en genoeg volume om het gerealiseerde cijfer te vertrouwen (hierboven bewaakt).
  if (d.targetRatio !== null && Math.abs(d.targetRatio - 1) > TARGET_AFWIJKING_REVIEW) {
    return "review_target";
  }

  // Handmatig bij voldoende volume laat rendement liggen: upgrade naar smart.
  if (d.kind === "manual") {
    return d.convPerMaand >= SMART_BIDDING_MIN_CONV ? "upgrade_to_smart" : "fit";
  }

  // Conversie-smart terwijl er een ROAS-doel, waarde en genoeg volume is: naar waarde-bieden.
  if (d.kind === "smart_conversion" && goal.hasRoasTarget && d.hasValue && d.convPerMaand >= VALUE_BIDDING_MIN_CONV) {
    return "switch_to_value";
  }

  return "fit";
}

export interface BidFact {
  campaignId: string;
  campaignName: string;
  strategy: string;
  kind: BidStrategyKind;
  /** Totaal over het venster. */
  conversions: number;
  /** Gemiddeld per afgesloten maand — de schaal waar de leerdrempels over gaan. */
  conversionsPerMaand: number;
  cost: number;
  hasValue: boolean;
  cpa: number | null;
  roas: number | null;
  /** Ingesteld doel (tCPA euro / tROAS verhouding), null indien niet gezet. */
  target: number | null;
  /** gerealiseerd ÷ doel; 1 = precies op doel. Null zonder doel of zonder realisatie. */
  targetRatio: number | null;
  fit: BidStrategyFit;
  recommendation: string;
}

const RECOMMENDATION: Record<BidStrategyFit, string> = {
  fit: "biedstrategie past bij volume, waarde en doel",
  upgrade_to_smart: "genoeg volume voor smart bidding: stap over van handmatig naar doel-CPA of doel-ROAS",
  switch_to_value: "ROAS-doel met conversiewaarde en volume: stap over naar waarde-bieden (doel-ROAS of maximaliseer conversiewaarde)",
  insufficient_volume: "te weinig conversies per maand voor smart bidding om betrouwbaar te leren: overweeg consolidatie of een eenvoudiger strategie",
  value_missing: "waarde-strategie zonder conversiewaarde: zet eerst conversiewaarde-tracking op of stap over naar een conversie-strategie",
  review_target: "het ingestelde doel staat ver van wat de campagne realiseert: herijk de doelwaarde voordat je aan de strategie sleutelt",
  review_non_conversion: "niet-conversie-strategie op een converterende campagne met een doel: heroverweeg naar conversie- of waarde-bieden",
  unknown: "biedstrategie onbekend of niet herkend: verifieer de instelling",
};

export interface BidStrategySummary {
  campaignsAnalysed: number;
  fit: number;
  /** Mismatches = alles behalve fit en unknown; unknown is een verificatievraag, geen oordeel. */
  mismatches: number;
  byFit: Record<BidStrategyFit, number>;
  /** Het venster waarover de volumes gaan, voor eerlijke rapportage. */
  maandenInVenster: number;
}

// De volledige analyse: per campagne de fit, met de mismatches vooraan zodat de
// belangrijkste heroverwegingen bovenaan staan.
export function analyzeBidStrategy(
  campaigns: CampaignBidInput[],
  goal: BidGoal,
  maandenInVenster = 1
): {
  campaigns: BidFact[];
  summary: BidStrategySummary;
} {
  const facts: BidFact[] = campaigns
    .filter((c) => c.campaignId)
    .map((c) => {
      const d = leidAf(c, maandenInVenster);
      const fit = classifyBidFit(c, goal, maandenInVenster);
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        strategy: c.biddingStrategy ?? "onbekend",
        kind: d.kind,
        conversions: num(c.conversions),
        conversionsPerMaand: Math.round(d.convPerMaand * 10) / 10,
        cost: num(c.cost),
        hasValue: d.hasValue,
        cpa: d.cpa === null ? null : Math.round(d.cpa * 100) / 100,
        roas: d.roas === null ? null : Math.round(d.roas * 100) / 100,
        target: num(c.biddingStrategyTarget) > 0 ? num(c.biddingStrategyTarget) : null,
        targetRatio: d.targetRatio === null ? null : Math.round(d.targetRatio * 100) / 100,
        fit,
        recommendation: RECOMMENDATION[fit],
      };
    });

  // Mismatches (alles behalve fit) eerst, daarbinnen op kosten aflopend zodat de campagnes
  // waar het meeste geld door de verkeerde strategie stroomt bovenaan staan.
  facts.sort((a, b) => {
    const am = a.fit === "fit" ? 1 : 0;
    const bm = b.fit === "fit" ? 1 : 0;
    if (am !== bm) return am - bm;
    if (b.cost !== a.cost) return b.cost - a.cost;
    return b.conversions - a.conversions;
  });

  const byFit = {} as Record<BidStrategyFit, number>;
  for (const f of facts) byFit[f.fit] = (byFit[f.fit] ?? 0) + 1;

  const summary: BidStrategySummary = {
    campaignsAnalysed: facts.length,
    fit: facts.filter((f) => f.fit === "fit").length,
    mismatches: facts.filter((f) => f.fit !== "fit" && f.fit !== "unknown").length,
    byFit,
    maandenInVenster,
  };

  return { campaigns: facts, summary };
}
