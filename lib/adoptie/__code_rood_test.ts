// Combinatielaag boven account-stoplicht.ts en health-score.ts. Deterministisch, geen IO.
// Draaien: npx tsx lib/adoptie/__code_rood_test.ts

import { beoordeelCodeRood } from "./code-rood";
import type { AccountOordeel } from "./account-stoplicht";
import type { HealthScore, Anomaly } from "../health-score";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const groenAccount: AccountOordeel = { licht: "groen", redenen: [] };
const amberAccount: AccountOordeel = { licht: "amber", redenen: ["1 signaal actief"] };
const roodAccount: AccountOordeel = { licht: "rood", redenen: ["signaal a", "signaal b"] };

function health(anomalies: Anomaly[]): HealthScore {
  return { total: 50, grade: "C", color: "", factors: [], anomalies, assessedCount: 5 };
}

const geenAnomalieen = health([]);
const alleenWarning = health([{ severity: "warning", title: "CPA stijgt snel", description: "" }]);
const eenCritical = health([{ severity: "critical", title: "Sterke neerwaartse trend", description: "" }]);
const criticalEnWarning = health([
  { severity: "warning", title: "Zoekterm verspilling", description: "" },
  { severity: "critical", title: "Geschat jaardoel in gevaar", description: "" },
]);

check("groen account + geen anomalieen is groen",
  beoordeelCodeRood(groenAccount, geenAnomalieen).licht === "groen");

check("groen account + alleen warning blijft groen (warning is Code Oranje-terrein)",
  beoordeelCodeRood(groenAccount, alleenWarning).licht === "groen");

check("groen account + een critical anomaly is rood",
  beoordeelCodeRood(groenAccount, eenCritical).licht === "rood");

{
  const o = beoordeelCodeRood(groenAccount, eenCritical);
  check("rood via health-score draagt de anomaly-titel als reden",
    o.redenen.includes("Sterke neerwaartse trend"), JSON.stringify(o));
}

check("amber account + geen anomalieen blijft amber",
  beoordeelCodeRood(amberAccount, geenAnomalieen).licht === "amber");

check("amber account + alleen warning blijft amber, niet rood",
  beoordeelCodeRood(amberAccount, alleenWarning).licht === "amber");

check("amber account + een critical anomaly wordt rood",
  beoordeelCodeRood(amberAccount, eenCritical).licht === "rood");

check("rood account blijft rood, ongeacht health-score",
  beoordeelCodeRood(roodAccount, geenAnomalieen).licht === "rood");

{
  const o = beoordeelCodeRood(roodAccount, criticalEnWarning);
  check("rood draagt zowel de account-redenen als de critical anomaly, niet de warning",
    o.redenen.includes("signaal a") && o.redenen.includes("signaal b") &&
    o.redenen.includes("Geschat jaardoel in gevaar") && !o.redenen.includes("Zoekterm verspilling"),
    JSON.stringify(o));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
