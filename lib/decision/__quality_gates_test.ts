// Bewijst het vangnet: een poort die gegarandeerd gooit, mag de andere acht niet meeslepen.
// Zonder deze test zegt "shadow mode is veilig" niets -- zie AGENTS.md: deze codebase heeft
// eerder een controle gehad die iets anders verifieerde dan hij beweerde.

import { GATES, runGates, type GateInput } from "./quality-gates";

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

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
