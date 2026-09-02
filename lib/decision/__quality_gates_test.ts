// Bewijst het vangnet: een poort die gegarandeerd gooit, mag de andere acht niet meeslepen.
// Zonder deze test zegt "shadow mode is veilig" niets -- zie AGENTS.md: deze codebase heeft
// eerder een controle gehad die iets anders verifieerde dan hij beweerde.

import { GATES, runGates, gewogenRankLostIs, type GateInput } from "./quality-gates";
import type { RecommendationLike } from "@/lib/analysis/contradiction-resolver";
import type { Finding, Recommendation } from "@/lib/schema/analysis-schema";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const basisInvoer: GateInput = {
  runId: "test-run", agencyId: "agency-test", accountId: "client-test", analysisDate: "2026-08-09",
};

console.log("negen echte poorten, allemaal zonder invoer");
const zonderInvoer = runGates(basisInvoer);
check("negen resultaten", zonderInvoer.length === 9, String(zonderInvoer.length));
check("elk zonder invoer is warn, nooit een verzonnen pass", zonderInvoer.every((r) => r.status === "warn"), JSON.stringify(zonderInvoer.map((r) => r.status)));
check("geen enkele poort blokkeert in shadow mode", zonderInvoer.every((r) => r.blocking === false));
check("elke reden noemt 'input ontbreekt'", zonderInvoer.every((r) => (r.reason ?? "").includes("input ontbreekt")));

console.log("\nhet vangnet: een poort die gegarandeerd gooit");
const kapottePoort = { name: "Kapotte Poort", run: () => { throw new Error("expres kapot voor de test"); } };
const metKapottePoort = runGates(basisInvoer, [...GATES, kapottePoort]);
check("tien resultaten, geen crash van de hele run", metKapottePoort.length === 10, String(metKapottePoort.length));
const kapotResultaat = metKapottePoort.find((r) => r.gateName === "Kapotte Poort");
check("de kapotte poort komt terug als warn, niet als crash", kapotResultaat?.status === "warn", JSON.stringify(kapotResultaat));
check("de reden noemt de fout", (kapotResultaat?.reason ?? "").includes("expres kapot voor de test"), kapotResultaat?.reason);
check("repairAttempted staat op false", kapotResultaat?.repairAttempted === false);
check("de andere negen poorten hebben gewoon hun eigen resultaat",
  metKapottePoort.filter((r) => r.gateName !== "Kapotte Poort").length === 9);

console.log("\nData Quality Gate met echte, geldige invoer");
const metData: GateInput = {
  ...basisInvoer,
  dataQuality: {
    accountMonthly: [
      { month: "2026-06", impressions: 10000, clicks: 500, cost: 1000, conversions: 20, conversions_value: 4000 },
      { month: "2026-07", impressions: 11000, clicks: 520, cost: 1050, conversions: 22, conversions_value: 4200 },
    ],
    campaignMonthly: [],
    conversionLagDays: 3,
    lastCompleteMonth: 7,
    hasKpiTargets: true,
  },
};
const metDataResultaat = runGates(metData).find((r) => r.gateName === "Data Quality Gate");
check("met echte data geeft de Data Quality Gate geen 'input ontbreekt' meer",
  !(metDataResultaat?.reason ?? "").includes("input ontbreekt"), JSON.stringify(metDataResultaat));

console.log("\nFase 2: de snelle paden die de al-opgeslagen run hergebruiken");

const metStepValidaties: GateInput = {
  ...basisInvoer,
  stepValidationsReport: [
    { stepNumber: 1, valid: true, warnings: [], errors: [] },
    { stepNumber: 2, valid: true, warnings: ["klein foutje"], errors: [] },
  ],
};
const stepPurityUitkomst = runGates(metStepValidaties).find((r) => r.gateName === "Step Purity Gate");
check("stepValidationsReport geeft warn bij een waarschuwing, geen 'input ontbreekt'",
  stepPurityUitkomst?.status === "warn" && !(stepPurityUitkomst.reason ?? "").includes("input ontbreekt"),
  JSON.stringify(stepPurityUitkomst));

const metOngeldigeStap: GateInput = {
  ...basisInvoer,
  stepValidationsReport: [{ stepNumber: 3, valid: false, warnings: [], errors: ["AC-07: geen log entries"] }],
};
const stepPurityFail = runGates(metOngeldigeStap).find((r) => r.gateName === "Step Purity Gate");
check("een ongeldige stap geeft fail, niet warn of pass", stepPurityFail?.status === "fail", JSON.stringify(stepPurityFail));

const metCoverageReport: GateInput = {
  ...basisInvoer,
  coverageReport: [
    { dimension: "campaign", data_available: true, findings_surfaced: 3, surfaced_cluster_ids: ["c1"], status: "covered", note: "" },
    { dimension: "audience", data_available: true, findings_surfaced: 0, surfaced_cluster_ids: [], status: "no_signal", note: "" },
  ],
};
const coverageUitkomst = runGates(metCoverageReport).find((r) => r.gateName === "Coverage Gate");
check("coverageReport vangt een beschikbare dimensie zonder signaal",
  coverageUitkomst?.status === "warn" && (coverageUitkomst.reason ?? "").includes("audience"),
  JSON.stringify(coverageUitkomst));

const metPublishReport: GateInput = {
  ...basisInvoer,
  publishReport: { passed: false, state: "blocked_invalid_steps", blockingReasons: ["Step 4 is invalid"] },
};
const publishUitkomst = runGates(metPublishReport).find((r) => r.gateName === "Publish Gate");
check("publishReport met passed=false geeft fail bij blocked_invalid_steps", publishUitkomst?.status === "fail", JSON.stringify(publishUitkomst));

console.log("\nContradiction Gate en Sprint Readiness Gate draaien voor het eerst op echte vorm");

const recA: RecommendationLike = {
  phase: "immediate", ice_total: 8, rationale: "test", measurement_metric: "CPA", dependencies: [],
  action_intent_class: "budget_reduce", action_unit_key: "campaign:123", primary_entity_scope: "campaign",
  primary_entity_key: "123", canonical_entity_name: "Campagne A",
};
const recB: RecommendationLike = { ...recA, ice_total: 5 }; // zelfde entiteit, ander bod -> conflict
const contradictionUitkomst = runGates({ ...basisInvoer, contradiction: { recommendations: [recA, recB], tasks: [] } })
  .find((r) => r.gateName === "Contradiction Gate");
check("twee aanbevelingen op dezelfde entiteit worden samengevoegd, niet 'input ontbreekt'",
  contradictionUitkomst?.status === "warn" && !(contradictionUitkomst.reason ?? "").includes("input ontbreekt"),
  JSON.stringify(contradictionUitkomst));

const kleinBedragFinding: Finding = {
  step: 1, issue_cluster: "search_budget_cap", entity_type: "campaign", entity_name: "Campagne A",
  metric: "cost", current_value: 10, previous_value: 8, change_pct: 25, severity: "low",
  insight_type: "risk", is_seasonal: false, is_structural: false, cause: null, action_required: true,
  evidence_level: "deterministic", confidence: "high",
};
const kleinBedragRec: Recommendation = {
  finding_index: 0, cluster_id: "c1", thread_id: null, source: "finding", hypothesis: "test",
  expected_result: "test", measurement_metric: "cost", timeframe: "2 weken", rationale: "test",
  ice_impact: 5, ice_confidence: 5, ice_ease: 5, ice_total: 5,
  action_readiness: "direct_action", evidence_level: "deterministic", confidence: "high",
};
const sprintUitkomst = runGates({ ...basisInvoer, actionGating: { findings: [kleinBedragFinding], recommendations: [kleinBedragRec] } })
  .find((r) => r.gateName === "Sprint Readiness Gate");
check("een klein bedrag (<€50) wordt afgewaardeerd van direct_action, niet 'input ontbreekt'",
  sprintUitkomst?.status === "warn" && !(sprintUitkomst.reason ?? "").includes("input ontbreekt"),
  JSON.stringify(sprintUitkomst));

console.log("\nlege invoer is geen pass: aanwezig-maar-leeg telt als 'input ontbreekt'");
const leeg = runGates({
  ...basisInvoer,
  rankLoss: { keywords: [], rankLostIs: 0 },
  claimCheck: { stepNumber: 1, findings: [], campaignRows: [], accountRows: [], periodStart: "2026-07-01", periodEnd: "2026-07-31" },
  contradiction: { recommendations: [], tasks: [] },
  coverageReport: [],
  actionGating: { findings: [], recommendations: [] },
});
for (const naam of ["Math Gate", "Evidence Gate", "Contradiction Gate", "Coverage Gate", "Sprint Readiness Gate"]) {
  const r = leeg.find((x) => x.gateName === naam);
  check(`${naam} met lege lijst is warn 'input ontbreekt', geen pass`, r?.status === "warn" && (r.reason ?? "").includes("input ontbreekt"), JSON.stringify(r));
}
const causaal = runGates({
  ...basisInvoer,
  kpiChain: { previousMonth: { conversions: 10, clicks: 100, impressions: 1000, cost: 100 }, currentMonth: { conversions: 12, clicks: 110, impressions: 1100, cost: 110 }, resultMetric: "conversions" },
}).find((x) => x.gateName === "Causal Chain Gate");
check("Causal Chain Gate zegt in zijn reden dat hij beschrijvend is", (causaal?.reason ?? "").includes("beschrijvend"), JSON.stringify(causaal));

console.log("\ngewogenRankLostIs: gewogen naar impressies, null zonder rijen");
check("zonder rijen null (geen data is geen 0%)", gewogenRankLostIs([]) === null);
check("gewogen: 40.000 impressies wegen zwaarder dan 40",
  Math.abs((gewogenRankLostIs([{ search_rank_lost_is: 0.5, impressions: 40000 }, { search_rank_lost_is: 0.1, impressions: 40 }]) ?? 0) - 0.4996) < 0.001,
  String(gewogenRankLostIs([{ search_rank_lost_is: 0.5, impressions: 40000 }, { search_rank_lost_is: 0.1, impressions: 40 }])));
check("zonder impressies valt terug op het gewone gemiddelde", gewogenRankLostIs([{ search_rank_lost_is: 0.2 }, { search_rank_lost_is: 0.4 }]) === 0.30000000000000004 || Math.abs((gewogenRankLostIs([{ search_rank_lost_is: 0.2 }, { search_rank_lost_is: 0.4 }]) ?? 0) - 0.3) < 1e-9);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
