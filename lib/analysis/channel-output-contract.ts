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
// confidenceBreakdown: niet gevuld voor Google. sop_insights draagt geen enkele confidence-kolom;
// de vijf componenten uit de vertrouwensdoctrine (masterplan sectie 3.2, regel 4) verzinnen zou
// precies ingaan tegen regel 3 van diezelfde doctrine ("het systeem zegt vaker 'ik weet het niet'
// dan de concurrentie"). Het veld staat in het contract voor kanalen die het wel kunnen vullen.
//
// targetStatus: altijd "insufficient_data". client_targets heeft nul rijen (masterplan sectie 3.4).

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
    confidenceBreakdown: null,
    marketContext: {
      marketRelationType: "insufficient_data",
      summary: "God View bestaat nog niet (masterplan fase 6); marktrelatie is niet te bepalen.",
    },
  };
}
