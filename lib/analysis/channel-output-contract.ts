// Fase 2 (docs/MASTERPLAN.md): het gedeelde kanaaloutputcontract uit
// CHANNEL_INTELLIGENCE_FRAMEWORK_V1 -- de genormaliseerde vorm die elk kanaal (Google, Meta,
// LinkedIn) moet opleveren, ook al is het pad ernaartoe per kanaal anders. Zie de kop van
// lib/analysis/channel-adapter.ts en lib/decision/channel-provider.ts voor de twee bestaande
// registries; dit is een DERDE laag, los van beide: geen promptinstructies (dat is de adapter),
// geen live signaalverzameling (dat is de provider), maar de vertaling van wat de bestaande
// maandelijkse SOP-pijplijn AL heeft opgeleverd naar één vorm die niet per kanaal verschilt.
//
// ── WAAROM DIT GEEN SPECULATIEF TYPE IS ──────────────────────────────────────
//
// lib/decision/types.ts is expliciet terughoudend: een type firmt pas op als een echte consument
// laat zien wat erin hoort. Dit bestand volgt diezelfde regel, alleen is de "consument" hier geen
// nieuwe pijplijnstap maar de ECHTE opgeslagen output van 14 augustus 2026: sop_insights (3.462
// rijen) en sop_recommendations (355 rijen). mapGoogleMonthlyToSharedOutput() is getest tegen
// exact de vorm die die tabellen dragen, en scripts/verify-channel-output-contract.mjs draait de
// mapper tegen een echte klant en print het resultaat -- dat is de vereiste uit het masterplan
// ("handmatig nagelopen op een echte maand"), niet een ongebruikt type dat de hygienepoort
// terecht zou afkeuren.
//
// ── WAT ER BEWUST NIET IN ZIT ─────────────────────────────────────────────────
//
// patterns: altijd leeg voor Google. Een patroon is een terugkerende waarneming over meerdere
// periodes of accounts heen (CHANNEL_INTELLIGENCE_FRAMEWORK_V1, "hogere-orde verschuivingen").
// sop_insights draagt geen kolom die dat onderscheidt van een eenmalige waarneming --
// is_structural leek een kandidaat, maar staat op 88-90% van ALLE insight_types op true (nagemeten
// 14 augustus), dus onderscheidt niets. Een patroon vaststellen vraagt God View of Agency Memory
// (herhaling over tijd/accounts), geen van beide bestaat nog. Leeg is hier het eerlijke antwoord,
// geen gok.
//
// confidenceBreakdown: DEELS gevuld voor Google, sinds 15 augustus (masterplan sectie 5.4-traject).
// Vijf componenten, geverifieerd tegen echte kolommen in plaats van in een keer aangenomen:
//
//   effectSize     GEVULD. sop_insights.change_pct is een echte, gemeten kolom (2.650 van 3.462
//                  rijen gevuld, nagemeten 15 augustus) -- geen gok.
//   sampleSize     GEVULD, mits canonicalMetrics is meegegeven. Hergebruikt exact dezelfde
//                  buildCanonicalMetricMap uit claim-consistency.ts die de Evidence Gate ook
//                  gebruikt -- geen tweede opzoekmechanisme.
//   trackingQuality BLIJFT NULL. fact_core.data_quality_score staat op 1.0 voor alle 9.543 rijen
//                  zonder uitzondering (nagemeten 15 augustus): een default die nooit is
//                  overschreven, geen gemeten signaal. Die als "tracking quality" tonen zou zelf
//                  de fake precisie zijn die regel 3 verbiedt. Blijft dicht tot
//                  refresh_fact_from_legacy() dit veld echt berekent.
//   consistency    BLIJFT NULL. Vraagt een lezing over meerdere analysis_dates heen; deze mapper
//                  krijgt maar één maand aangeleverd. Geen speculatieve multi-maand-query zonder
//                  een consument die hem nodig heeft.
//   marketCorroboration BLIJFT NULL. God View bestaat nog niet.
//
// Beide gevulde componenten zijn FRACTIES (0-1) over alle bevindingen met bruikbare data, niet
// per-bevinding: het contract draagt één confidenceBreakdown per maandoutput, terwijl een
// analyse 20-30 losse bevindingen bevat. "0.6" bij effectSize betekent dus: 60% van de
// bevindingen met een gemeten change_pct wijkt materieel af, niet dat elke bevinding dat doet.
// Bevindingen zonder de brondata voor een component tellen niet mee in de noemer van die component.
//
// targetStatus: altijd "insufficient_data". client_targets heeft nul rijen (masterplan sectie 3.4).

import { canonicalKey, type CanonicalMetricMap } from "./claim-consistency";
import type { Finding } from "../schema/analysis-schema";

export type MarketRelationType =
  | "market_driven"
  | "account_specific"
  | "mixed"
  | "seasonal"
  | "structural_shift"
  | "insufficient_data"
  | "unclear";

export type Severity = "low" | "medium" | "high";

/** De vijf severity-waarden zoals ze echt in sop_insights.severity staan (nagemeten 14 augustus
 *  2026: critical, high, low, medium, positive). "positive" is geen risico-ernst maar een teken
 *  dat het een gunstige waarneming is -- die insights gaan naar signals, nooit naar risks. */
export type StoredSeverity = "critical" | "high" | "medium" | "low" | "positive";

export interface ConfidenceBreakdown {
  sampleSize: number | null;
  trackingQuality: number | null;
  effectSize: number | null;
  consistency: number | null;
  marketCorroboration: number | null;
}

export interface ChannelSignal {
  signalType: string;
  title: string;
  evidence: string;
  severity: Severity;
  actionRequired: boolean;
}

export interface ChannelRisk {
  riskType: string;
  severity: Severity;
  evidence: string;
  affectedEntity: string | null;
}

export interface ChannelOpportunity {
  opportunityType: string;
  expectedImpact: Severity;
  recommendedAction: string;
  affectedEntity: string | null;
}

export interface ChannelPattern {
  patternType: string;
  title: string;
  description: string;
}

export interface ChannelHypothesis {
  title: string;
  description: string;
  metricTargeted: string | null;
  timeframe: string | null;
  iceTotal: number | null;
}

export interface SharedChannelOutput {
  channel: "google_ads" | "meta_ads" | "linkedin_ads";
  clientId: string;
  analysisPeriod: { periodType: "month"; analysisDate: string };
  targetStatus: { status: "insufficient_data"; primaryMetric: null; gapToTarget: null };
  signals: ChannelSignal[];
  patterns: ChannelPattern[];
  risks: ChannelRisk[];
  opportunities: ChannelOpportunity[];
  hypotheses: ChannelHypothesis[];
  confidenceBreakdown: ConfidenceBreakdown | null;
  marketContext: { marketRelationType: MarketRelationType; summary: string };
}

/** Input-vorm: exact de kolommen die deze mapper gebruikt uit sop_insights, geen select *. */
export interface SopInsightRow {
  insight_type: string;
  title: string;
  description: string;
  severity: string;
  affected_entity: string | null;
  action_required: boolean | null;
  /** Voor de sampleSize-component van confidenceBreakdown: samen met affected_entity dezelfde
   *  canonicalKey bouwen als de Evidence Gate gebruikt om de Conversies-waarde op te zoeken. */
  affected_entity_type?: string | null;
  /** Voor de effectSize-component van confidenceBreakdown. Vrije tekst uit oudere analyses kan
   *  hier ontbreken (76% gevuld, nagemeten 15 augustus) -- ontbreken telt niet mee, is geen 0%. */
  change_pct?: number | null;
}

/** Input-vorm: exact de kolommen die deze mapper gebruikt uit sop_recommendations. */
export interface SopRecommendationRow {
  hypothesis: string;
  rationale: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  ice_total: number | string | null;
}

function severityNaarSchaal(s: string): Severity {
  if (s === "critical" || s === "high") return "high";
  if (s === "low") return "low";
  return "medium"; // medium en positive: geen van beide is laag of hoog risico/impact
}

// Drempel voor effectSize: hoeveel procent verandering geldt als "materieel" in plaats van
// normale maandruis. 15 gekozen als middenwaarde -- laag genoeg om echte verschuivingen niet te
// missen, hoog genoeg om niet elke maandschommeling als signaal te tellen. Zelfde soort keuze als
// IMPLAUSIBLE_FACTOR in o2-targets-cost.ts: vastgelegd met reden, niet met een berekening.
const EFFECT_SIZE_DREMPEL_PCT = 15;

// Drempel voor sampleSize: hoeveel conversies een entiteit minimaal moet hebben gehad in de
// geanalyseerde maand om de bevinding erover te vertrouwen. Zelfde soort drempel als MIN_ACCOUNTS
// in lib/benchmark/cel.ts, onafhankelijk gekozen voor een ander doel (hier: ruis in een individuele
// conversieratio, daar: bureau-anonimiteit in een benchmarkcel).
const SAMPLE_SIZE_MIN_CONVERSIES = 10;

/**
 * Bouwt confidenceBreakdown uit wat er echt te meten valt (zie de toelichting bovenaan dit
 * bestand). Componenten zonder brondata blijven null in plaats van een gegokte waarde; het hele
 * object wordt null als geen enkele component iets opleverde, zodat "geen confidence-oordeel"
 * niet verward kan worden met "confidence is nul".
 */
function computeConfidenceBreakdown(
  insights: readonly SopInsightRow[],
  canonicalMetrics: CanonicalMetricMap | undefined
): ConfidenceBreakdown | null {
  const changePcts = insights
    .map((i) => i.change_pct)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const effectSize = changePcts.length > 0
    ? changePcts.filter((v) => Math.abs(v) >= EFFECT_SIZE_DREMPEL_PCT).length / changePcts.length
    : null;

  // Kijkt altijd naar Conversies, ongeacht welke metric de bevinding zelf claimt (CPA, ROAS,
  // CTR...): die herleiden allemaal tot dezelfde onderliggende conversievolume om te bepalen of
  // er genoeg volume was om de bevinding te vertrouwen.
  let sampleSize: number | null = null;
  if (canonicalMetrics) {
    const conversieAantallen: number[] = [];
    for (const i of insights) {
      if (!i.affected_entity) continue;
      const entityType = (i.affected_entity_type ?? "campaign") as Finding["entity_type"];
      const sleutel = canonicalKey(i.affected_entity, entityType, "Conversies");
      const conversies = canonicalMetrics.get(sleutel);
      if (conversies !== undefined) conversieAantallen.push(conversies);
    }
    if (conversieAantallen.length > 0) {
      sampleSize = conversieAantallen.filter((c) => c >= SAMPLE_SIZE_MIN_CONVERSIES).length / conversieAantallen.length;
    }
  }

  if (effectSize === null && sampleSize === null) return null;
  return { sampleSize, trackingQuality: null, effectSize, consistency: null, marketCorroboration: null };
}

/**
 * Vertaalt de bestaande maandelijkse Google-output (sop_insights + sop_recommendations voor één
 * klant/analysedatum) naar het gedeelde kanaalcontract. Raakt de brontabellen niet aan en roept
 * de monthly-route niet aan -- pure functie op wat er al is opgeslagen.
 */
export function mapGoogleMonthlyToSharedOutput(
  clientId: string,
  analysisDate: string,
  insights: readonly SopInsightRow[],
  recommendations: readonly SopRecommendationRow[],
  /** Optioneel: dezelfde CanonicalMetricMap die de Evidence Gate gebruikt (buildCanonicalMetricMap
   *  in claim-consistency.ts). Zonder dit argument blijft sampleSize null, de rest van het contract
   *  verandert niet -- achterwaarts compatibel met bestaande aanroepers. */
  canonicalMetrics?: CanonicalMetricMap,
): SharedChannelOutput {
  const signals: ChannelSignal[] = [];
  const risks: ChannelRisk[] = [];
  const opportunities: ChannelOpportunity[] = [];

  for (const i of insights) {
    const severity = severityNaarSchaal(i.severity);
    if (i.insight_type === "risk") {
      risks.push({
        riskType: i.insight_type,
        severity,
        evidence: i.description,
        affectedEntity: i.affected_entity,
      });
    } else if (i.insight_type === "opportunity") {
      opportunities.push({
        opportunityType: i.insight_type,
        expectedImpact: severity,
        recommendedAction: i.description,
        affectedEntity: i.affected_entity,
      });
    } else {
      // anomaly, performance, trend, positive: stuk voor stuk een individuele waarneming, geen
      // risico of kans op zich -- dat is precies de definitie van signal in het framework.
      signals.push({
        signalType: i.insight_type,
        title: i.title,
        evidence: i.description,
        severity,
        actionRequired: i.action_required ?? false,
      });
    }
  }

  const hypotheses: ChannelHypothesis[] = recommendations.map((r) => ({
    title: r.hypothesis,
    description: r.rationale ?? r.hypothesis,
    metricTargeted: r.measurement_metric,
    timeframe: r.timeframe,
    iceTotal: r.ice_total === null ? null : Number(r.ice_total),
  }));

  return {
    channel: "google_ads",
    clientId,
    analysisPeriod: { periodType: "month", analysisDate },
    targetStatus: { status: "insufficient_data", primaryMetric: null, gapToTarget: null },
    signals,
    patterns: [],
    risks,
    opportunities,
    hypotheses,
    confidenceBreakdown: computeConfidenceBreakdown(insights, canonicalMetrics),
    marketContext: {
      marketRelationType: "insufficient_data",
      summary: "God View bestaat nog niet (masterplan fase 6); marktrelatie is niet te bepalen.",
    },
  };
}
