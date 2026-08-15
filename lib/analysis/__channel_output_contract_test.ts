// Draaien: npx tsx lib/analysis/__channel_output_contract_test.ts
//
// Fixtures zijn geen verzonnen vormen: ze volgen precies de rijen die op 14 augustus 2026 echt in
// sop_insights en sop_recommendations stonden (zie het commentaar in channel-output-contract.ts).

import { mapGoogleMonthlyToSharedOutput, type SopInsightRow, type SopRecommendationRow } from "./channel-output-contract";

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
    action_required: true,
  },
  {
    insight_type: "opportunity",
    title: "Onderbenutte Search-impression share",
    description: "Budget-lost-IS 34% op een campagne met CPA ruim onder target.",
    severity: "positive",
    affected_entity: "Campagne: Generiek - NL",
    action_required: false,
  },
  {
    insight_type: "trend",
    title: "CTR stijgt drie maanden op rij",
    description: "CTR van 3,1% naar 4,2% over drie maanden.",
    severity: "low",
    affected_entity: null,
    action_required: null,
  },
  {
    insight_type: "positive",
    title: "ROAS boven target",
    description: "ROAS 4,8x tegen een target van 3,5x.",
    severity: "positive",
    affected_entity: null,
    action_required: false,
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

const out = mapGoogleMonthlyToSharedOutput("gads-test", "2026-04-17", insights, recommendations);

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
check("confidenceBreakdown is null (sop_insights draagt geen confidence-kolom)", out.confidenceBreakdown === null);

console.log("\nRandgevallen");
const leeg = mapGoogleMonthlyToSharedOutput("gads-leeg", "2026-04-17", [], []);
check("geen insights/recommendations geeft lege arrays, geen crash", leeg.signals.length === 0 && leeg.hypotheses.length === 0);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
