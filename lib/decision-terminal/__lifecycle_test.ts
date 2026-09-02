// Test voor de Decision Terminal-levenscyclus-afleidingen. Deterministisch, geen IO.
// Draaien: npx tsx lib/decision-terminal/__lifecycle_test.ts

import { lifecycleOf, provenanceOf, metricSnapshotsOf, type HypothesisRecord } from "./lifecycle";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const basis = (overrides: Partial<HypothesisRecord>): HypothesisRecord => ({
  id: "h1",
  hypothesis: "test",
  expected_result: null,
  measurement_metric: null,
  timeframe: null,
  status: "pending",
  source: null,
  ice_total: null,
  created_at: "2026-01-01T00:00:00Z",
  accepted_at: null,
  decided_at: null,
  decided_by: null,
  decision_reason: null,
  outcome: null,
  result_met: null,
  learning: null,
  verdict_metrics: null,
  evaluated_at: null,
  ...overrides,
});

console.log("Levenscyclus-stadia");
check("pending is een voorstel", lifecycleOf(basis({ status: "pending" })).stage === "propose");
check("rejected blijft rejected, geen synoniem", lifecycleOf(basis({ status: "rejected" })).stage === "rejected");
check("completed blijft completed", lifecycleOf(basis({ status: "completed" })).stage === "completed");
check("accepted zonder evaluatie wacht", lifecycleOf(basis({ status: "accepted", accepted_at: "2026-04-01" })).stage === "accepted");
check("uitgevoerd_en_gehaald wordt correct herkend", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "uitgevoerd_en_gehaald" })).stage === "executed_gehaald");
check("uitgevoerd_en_niet_gehaald wordt correct herkend", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "uitgevoerd_en_niet_gehaald" })).stage === "executed_niet_gehaald");
check("niet_uitgevoerd is een eigen stadium, geen rejected", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "niet_uitgevoerd" })).stage === "niet_uitgevoerd");
check("unmeasurable is evaluated_onbekend, geen gok", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "unmeasurable" })).stage === "evaluated_onbekend");
check("expired is ook evaluated_onbekend", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "expired" })).stage === "evaluated_onbekend");
check("outcome accepted zonder uitvoeringsbewijs is GEEN uitgevoerd-stadium", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "accepted", result_met: true })).stage === "evaluated_uitvoering_onbekend");
check("outcome rejected met result_met=false idem, label zegt niet vastgesteld", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "rejected", result_met: false })).label.includes("niet vastgesteld"));
check("onbekende outcome zonder result_met is evaluated_onbekend", lifecycleOf(basis({ status: "accepted", evaluated_at: "2026-05-01", outcome: "iets_nieuws" })).stage === "evaluated_onbekend");

console.log("\nProvenance");
check("een hypothese met source is AI", provenanceOf(basis({ source: "meta_funnel" })).bedenker === "AI (meta_funnel)");
check("een hypothese zonder source is handmatig", provenanceOf(basis({ source: null })).bedenker === "Handmatig");
check("wanneer prefereert decided_at boven accepted_at boven created_at", provenanceOf(basis({ decided_at: "d", accepted_at: "a", created_at: "c" })).wanneer === "d");
check("zonder decided_at valt terug op accepted_at", provenanceOf(basis({ decided_at: null, accepted_at: "a", created_at: "c" })).wanneer === "a");
check("zonder allebei valt terug op created_at", provenanceOf(basis({ decided_at: null, accepted_at: null, created_at: "c" })).wanneer === "c");

console.log("\nMetric-snapshots uit verdict_metrics");
check("geldige jsonb-array levert snapshots op", metricSnapshotsOf([{ metric: "cpa", baseline: 20, measured: 16, delta: -4, met: true }]).length === 1);
check("een snapshot draagt de juiste velden", metricSnapshotsOf([{ metric: "cpa", baseline: 20, measured: 16, delta: -4, met: true }])[0].baseline === 20);
check("geen array levert lege lijst, geen crash", metricSnapshotsOf(null).length === 0);
check("een rij zonder metric-veld wordt overgeslagen", metricSnapshotsOf([{ baseline: 1 }]).length === 0);
check("string in plaats van array levert lege lijst", metricSnapshotsOf("niet een array").length === 0);

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
