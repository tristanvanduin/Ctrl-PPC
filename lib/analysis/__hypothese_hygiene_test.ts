export {};
// Verificatie van F5 4b: guardrails overlapten de success-metrics (circulaire accept/reject),
// en identieke aanbevelingen konden identieke hypotheses geven. Getoetst op de echte helpers van de
// hypothese-builder in monthly-structured.ts (hier stonden eerst kopieen).
// Draaien: npx tsx lib/analysis/__hypothese_hygiene_test.ts

import { disjunctGuardrails, dedupeOpInterventie } from "./monthly-structured";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}
type Route = "validation" | "containment" | "recovery" | "controlled scale";
const disjointGuardrails = disjunctGuardrails;
const disjoint = (a: string[], b: string[]) => {
  const bk = new Set(b.map((x) => x.toLowerCase()));
  return a.every((x) => !bk.has(x.toLowerCase()));
};

console.log("\n1. Guardrails zijn in alle routes disjunct van de success-metrics");
{
  const cases: { route: Route; success: string[] }[] = [
    { route: "containment", success: ["ROAS", "Conversies"] },
    { route: "containment", success: ["CPA"] },
    { route: "recovery", success: ["ROAS", "CPA"] },
    { route: "controlled scale", success: ["ROAS", "CPA"] },
    { route: "validation", success: ["ROAS", "CVR"] },
  ];
  let allDisjoint = true;
  for (const c of cases) {
    const g = disjointGuardrails(c.route, c.success);
    const ok = disjoint(g, c.success);
    console.log(`     ${c.route} | success ${c.success.join(",")} -> guardrail ${g.join(",")} ${ok ? "" : " OVERLAP"}`);
    if (!ok) allDisjoint = false;
  }
  check("alle routes: guardrail bevat geen success-metric", allDisjoint);
  // expliciet het oude probleemgeval
  check("containment met success ROAS+Conversies -> complement CPA, CVR", JSON.stringify(disjointGuardrails("containment", ["ROAS", "Conversies"])) === JSON.stringify(["CPA", "CVR"]));
  check("recovery met success ROAS+CPA -> complement CPC, Spend", JSON.stringify(disjointGuardrails("recovery", ["ROAS", "CPA"])) === JSON.stringify(["CPC", "Spend"]));
  // geen overlap betekent ook: oude logica zou ROAS in beide hebben gehad
  const oldContainment = ["ROAS", "Conversies"]; // de oude guardrail
  check("oude containment-guardrail overlapte success wel (bewijs van de bug)", !disjoint(oldContainment, ["ROAS", "Conversies"]));
}

console.log("\n2. Hypotheses worden op interventie gededupliceerd, zonder aanvullen");
{
  type Entry = { route: Route; intervention: string };
  // De echte dedupe leest de interventie uit validation_or_exploitation_step.
  const dedupe = (entries: Entry[]): Entry[] =>
    dedupeOpInterventie(entries.map((e) => ({ ...e, validation_or_exploitation_step: e.intervention })));
  const dupes: Entry[] = [
    { route: "containment", intervention: "Pauzeer landset Noord" },
    { route: "containment", intervention: "Pauzeer  landset  Noord" }, // zelfde modulo opmaak
    { route: "recovery", intervention: "Herstart in aparte set" },
  ];
  const out = dedupe(dupes);
  check("twee identieke interventies -> 1 hypothese", out.length === 2);
  check("verschillende interventie blijft behouden", out.some((e) => e.route === "recovery"));
  // niet aanvullen tot 3
  const twoUnique: Entry[] = [
    { route: "containment", intervention: "A" },
    { route: "recovery", intervention: "B" },
  ];
  check("twee unieke routes blijven twee (geen opvulling tot drie)", dedupe(twoUnique).length === 2);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);