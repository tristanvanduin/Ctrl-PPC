// Draaien: npx tsx lib/analysis/__channel_output_contract_test.ts
//
// Fixtures zijn geen verzonnen vormen: ze volgen precies de rijen die op 14 augustus 2026 echt in
// sop_insights en sop_recommendations stonden (zie het commentaar in channel-output-contract.ts).

import { mapGoogleMonthlyToSharedOutput, type SopInsightRow, type SopRecommendationRow } from "./channel-output-contract";
import { canonicalKey } from "./claim-consistency";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const insights: SopInsightRow[] = [
  {
    insight_type: "risk",
    title: "[Stap 3] Ad group: Branded - Voorbeeld: CPA",
    description: "CPA: 22.73 (was 9.75). Plotselinge halvering van conversie-output.",
    severity: "critical",
    affected_entity: "Ad group: Branded - Voorbeeld",
    affected_entity_type: "adgroup",
    action_required: true,
    change_pct: 133.1, // (22.73 - 9.75) / 9.75 * 100 -- materieel, boven de 15%-drempel
  },
  {
    insight_type: "opportunity",
    title: "Onderbenutte Search-impression share",
    description: "Budget-lost-IS 34% op een campagne met CPA ruim onder target.",
    severity: "positive",
    affected_entity: "Campagne: Generiek - NL",
    affected_entity_type: "campaign",
    action_required: false,
    change_pct: null, // budget-lost-IS is geen periode-op-periode-vergelijking, geen change_pct
  },
  {
    insight_type: "trend",
    title: "CTR stijgt drie maanden op rij",
    description: "CTR van 3,1% naar 4,2% over drie maanden.",
    severity: "low",
    affected_entity: null,
    action_required: null,
    change_pct: 35.5, // (4.2 - 3.1) / 3.1 * 100 -- ook materieel
  },
  {
    insight_type: "positive",
    title: "ROAS boven target",
    description: "ROAS 4,8x tegen een target van 3,5x.",
    severity: "positive",
    affected_entity: null,
    action_required: false,
    change_pct: null, // vergelijking met target, geen periode-op-periode change
  },
];

const recommendations: SopRecommendationRow[] = [
  {
    hypothesis: "Containment: observatiemodus voor In-market-doelgroepen",
    rationale: "Gepromoveerd uit 3 signaalbronnen. CPA +1456% in de aangetaste campagne.",
    measurement_metric: "CPA",
    timeframe: "2-4 weken",
    ice_total: "5",
  },
];

// Zelfde vorm als buildCanonicalMetricMap (claim-consistency.ts) zou opleveren: alleen campagne-
// en accountniveau, geen ad groups -- dat dekt de Evidence Gate ook niet, dus insight 1
// (Ad group: Branded - Voorbeeld) hoort hier terecht geen match te vinden.
const canonicalMetrics = new Map<string, number>([
  [canonicalKey("Campagne: Generiek - NL", "campaign", "Conversies"), 42],
]);

const out = mapGoogleMonthlyToSharedOutput("gads-test", "2026-04-17", insights, recommendations, canonicalMetrics);

console.log("Indeling per insight_type");
check("risk gaat naar risks, niet signals", out.risks.length === 1 && out.signals.every((s) => s.signalType !== "risk"));
check("opportunity gaat naar opportunities", out.opportunities.length === 1);
check("trend en positive gaan naar signals", out.signals.length === 2);
check("patterns blijft leeg (geen brondata voor patroonherkenning)", out.patterns.length === 0);

console.log("\nSeverity-schaal");
check("critical wordt high", out.risks[0]!.severity === "high");
check("low blijft low", out.signals.find((s) => s.signalType === "trend")!.severity === "low");
check("positive wordt medium (geen laag/hoog risico of kans)", out.opportunities[0]!.expectedImpact === "medium");

console.log("\nHypotheses");
check("één aanbeveling wordt één hypothese", out.hypotheses.length === 1);
check("ice_total als tekst wordt een getal", out.hypotheses[0]!.iceTotal === 5);
check("measurement_metric komt over", out.hypotheses[0]!.metricTargeted === "CPA");

console.log("\nEerlijke standaardwaarden (geen verzonnen precisie)");
check("targetStatus is insufficient_data (client_targets is leeg)", out.targetStatus.status === "insufficient_data");
check("marketContext is insufficient_data (God View bestaat nog niet)", out.marketContext.marketRelationType === "insufficient_data");

console.log("\nconfidenceBreakdown: deels gevuld, deels eerlijk null");
check("object bestaat (er was meetbare data)", out.confidenceBreakdown !== null);
check(
  "effectSize telt alleen insights met change_pct: 2 van 2 gemeten insights zijn materieel (>=15%)",
  out.confidenceBreakdown?.effectSize === 1,
  String(out.confidenceBreakdown?.effectSize)
);
check(
  "sampleSize vindt alleen de campagne-insight (ad group en null-entiteiten zijn geen match)",
  out.confidenceBreakdown?.sampleSize === 1,
  String(out.confidenceBreakdown?.sampleSize)
);
check("trackingQuality blijft null (data_quality_score is een dode default)", out.confidenceBreakdown?.trackingQuality === null);
check("consistency blijft null (geen multi-maand-lezing)", out.confidenceBreakdown?.consistency === null);
check("marketCorroboration blijft null (God View bestaat nog niet)", out.confidenceBreakdown?.marketCorroboration === null);

console.log("\nconfidenceBreakdown: de fractie klopt ook als niet alles dezelfde kant op wijst");
const gemengdeInsights: SopInsightRow[] = [
  { insight_type: "trend", title: "A", description: "d", severity: "medium", affected_entity: "Campagne: A", affected_entity_type: "campaign", action_required: false, change_pct: 60 },
  { insight_type: "trend", title: "B", description: "d", severity: "medium", affected_entity: "Campagne: B", affected_entity_type: "campaign", action_required: false, change_pct: 3 },
];
const gemengdeMetrics = new Map<string, number>([
  [canonicalKey("Campagne: A", "campaign", "Conversies"), 50],
  [canonicalKey("Campagne: B", "campaign", "Conversies"), 2],
]);
const gemengd = mapGoogleMonthlyToSharedOutput("gads-gemengd", "2026-04-17", gemengdeInsights, [], gemengdeMetrics);
check("effectSize: 1 van 2 boven de drempel (60% wel, 3% niet)", gemengd.confidenceBreakdown?.effectSize === 0.5, String(gemengd.confidenceBreakdown?.effectSize));
check("sampleSize: 1 van 2 boven de drempel (50 conversies wel, 2 niet)", gemengd.confidenceBreakdown?.sampleSize === 0.5, String(gemengd.confidenceBreakdown?.sampleSize));

console.log("\nRandgevallen");
const leeg = mapGoogleMonthlyToSharedOutput("gads-leeg", "2026-04-17", [], []);
check("geen insights/recommendations geeft lege arrays, geen crash", leeg.signals.length === 0 && leeg.hypotheses.length === 0);
check("confidenceBreakdown blijft null zonder enige meetbare insight", leeg.confidenceBreakdown === null);
const zonderCanonicalMetrics = mapGoogleMonthlyToSharedOutput("gads-geen-map", "2026-04-17", insights, []);
check(
  "zonder canonicalMetrics-argument: effectSize werkt nog, sampleSize blijft eerlijk null",
  zonderCanonicalMetrics.confidenceBreakdown?.effectSize === 1 && zonderCanonicalMetrics.confidenceBreakdown?.sampleSize === null
);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
