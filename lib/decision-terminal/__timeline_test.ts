// Test voor de Decision Log-samenvoeging. Deterministisch, geen IO.
// Draaien: npx tsx lib/decision-terminal/__timeline_test.ts

import { buildTimeline } from "./timeline";
import type { ChangeEvent } from "../learning/hypothesis-evaluator";
import type { HypothesisRecord } from "./lifecycle";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const basisHyp = (overrides: Partial<HypothesisRecord>): HypothesisRecord => ({
  id: "h1", hypothesis: "test", expected_result: null, measurement_metric: null, timeframe: null,
  status: "pending", source: null, ice_total: null, created_at: "2026-01-01",
  accepted_at: null, decided_at: null, decided_by: null, decision_reason: null,
  outcome: null, result_met: null, learning: null, verdict_metrics: null, evaluated_at: null,
  ...overrides,
});

console.log("Samenvoegen en sorteren");
{
  const changes: ChangeEvent[] = [
    { type: "budget", entity: "Campagne X", date: "2026-04-10" },
    { type: "bid", entity: "Campagne Y", date: "2026-04-05" },
  ];
  const hyps: HypothesisRecord[] = [
    basisHyp({ id: "h1", hypothesis: "Verhoog het budget", accepted_at: "2026-04-07T10:00:00Z" }),
  ];
  const timeline = buildTimeline(changes, hyps);
  check("drie entries: twee changes en een acceptatie", timeline.length === 3);
  check("nieuwste eerst", timeline[0].date === "2026-04-10" && timeline[2].date === "2026-04-05");
  check("de change-entry draagt type en entity in het label", timeline.some((t) => t.kind === "change" && t.label.includes("budget") && t.label.includes("Campagne X")));
  check("de acceptatie-entry draagt de hypothesetekst", timeline.some((t) => t.kind === "hypothesis_accepted" && t.detail === "Verhoog het budget"));
}

console.log("\nEvaluatie-mijlpaal");
{
  const hyps: HypothesisRecord[] = [
    basisHyp({ status: "accepted", accepted_at: "2026-04-01", evaluated_at: "2026-05-01", outcome: "uitgevoerd_en_gehaald", learning: "Cpa daalde met 20%." }),
  ];
  const timeline = buildTimeline([], hyps);
  check("twee entries: acceptatie en evaluatie", timeline.length === 2);
  const evalEntry = timeline.find((t) => t.kind === "hypothesis_evaluated");
  check("de evaluatie-entry draagt de reden als detail", evalEntry?.detail === "Cpa daalde met 20%.");
  check("het label vermeldt het lifecycle-label", evalEntry?.label.includes("Uitgevoerd: doel gehaald") ?? false);
}

console.log("\nRandgevallen");
{
  check("lege invoer levert lege lijst", buildTimeline([], []).length === 0);
  check("een hypothese zonder accepted_at of evaluated_at levert geen entries", buildTimeline([], [basisHyp({})]).length === 0);
  check("een onbruikbare datum wordt overgeslagen, geen crash", buildTimeline([{ type: "budget", entity: "X", date: "niet-een-datum" }], []).length === 0);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
