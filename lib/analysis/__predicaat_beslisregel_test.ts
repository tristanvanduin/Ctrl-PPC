export {};
// Verificatie van F2 4e: het gestructureerde validation_predicate en de deterministische
// renderer, getoetst op de echte functies uit monthly-structured.ts (hier stonden eerst kopieen).
// Draaien: npx tsx lib/analysis/__predicaat_beslisregel_test.ts

import { renderPredicate, hasMalformedDecisionRule, hasDoubleConditional } from "./monthly-structured";

type ValidationPredicate = {
  metrics: string[];
  direction: "daalt" | "stijgt" | "stabiliseert" | "verbetert";
  window: string;
  connector?: "en" | "of";
};

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// de render-paden, predicaat-tak: de zinnen uit decisionRuleForRoute om de echte renderPredicate heen
const recoveryRule = (p: ValidationPredicate, metric: string) =>
  `Continueer alleen als ${renderPredicate(p)}; stop de herstelroute als ${metric} niet aantoonbaar verbetert.`;
const validationRule = (p: ValidationPredicate) =>
  `Ga alleen door naar containment of recovery als ${renderPredicate(p)}; stop escalatie als de validatie de hoofdverklaring niet bevestigt.`;
const stopContinueRecovery = (p: ValidationPredicate) =>
  `Continueer alleen als ${renderPredicate(p)}; stop of schaal af als de metric uitblijft.`;

console.log("\n1. renderPredicate: meervoudscongruentie, connector en komma-lijst");
check("enkelvoud daalt", renderPredicate({ metrics: ["Wasteful Spend"], direction: "daalt", window: "7 dagen" }) === "Wasteful Spend daalt binnen 7 dagen");
check("twee metrics 'en' -> meervoud verbeteren", renderPredicate({ metrics: ["ROAS", "CPA"], direction: "verbetert", window: "1-2 weken" }) === "ROAS en CPA verbeteren binnen 1-2 weken");
check("twee metrics connector 'of'", renderPredicate({ metrics: ["CVR", "ROAS"], direction: "verbetert", window: "2-4 weken", connector: "of" }) === "CVR of ROAS verbeteren binnen 2-4 weken");
check("drie metrics -> komma-lijst met afsluitend voegwoord", renderPredicate({ metrics: ["tracking", "conversie-acties", "dashboarddata"], direction: "stabiliseert", window: "deze week" }) === "tracking, conversie-acties en dashboarddata stabiliseren binnen deze week");
check("drie metrics connector 'of'", renderPredicate({ metrics: ["ROAS", "CVR", "CPA"], direction: "verbetert", window: "2-4 weken", connector: "of" }) === "ROAS, CVR of CPA verbeteren binnen 2-4 weken");

console.log("\n2. De render-paden produceren schone beslisregels, geen doubling");
{
  const predicates: ValidationPredicate[] = [
    { metrics: ["CVR", "ROAS"], direction: "verbetert", window: "2-4 weken", connector: "of" },
    { metrics: ["Wasteful Spend"], direction: "daalt", window: "7 dagen" },
    { metrics: ["tracking", "conversie-acties", "dashboarddata"], direction: "stabiliseert", window: "deze week" },
    { metrics: ["Search Lost IS (Budget)"], direction: "daalt", window: "1-2 weken" },
  ];
  let allClean = true;
  for (const p of predicates) {
    for (const rule of [recoveryRule(p, p.metrics[0]), validationRule(p), stopContinueRecovery(p)]) {
      if (hasDoubleConditional(rule) || hasMalformedDecisionRule(rule)) { allClean = false; console.log("       VUIL: " + rule); }
    }
  }
  check("alle predicaten in alle paden: geen dubbele conditie, geen misvorming", allClean);
  // toon een voorbeeld
  console.log("     voorbeeld recovery: " + recoveryRule(predicates[0], "CVR"));
  console.log("     voorbeeld tracking: " + stopContinueRecovery(predicates[2]));
}

console.log("\n3. Contrast: het oude directe-wikkel-pad gaf doubling, het predicaat-pad niet");
{
  // OUD stopContinueRule: wikkelde validation_condition (een directief) direct
  const directiveCondition = "Doorzetten alleen als CVR of CPA in de testset aantoonbaar beter zijn dan in de hoofdset.";
  const oldRule = `Continueer alleen als ${directiveCondition.toLowerCase()}; stop of schaal af als de metric uitblijft.`;
  const newRule = stopContinueRecovery({ metrics: ["CVR", "CPA"], direction: "verbetert", window: "2-4 weken", connector: "of" });
  console.log("     oud: " + oldRule);
  console.log("     nieuw: " + newRule);
  check("oud pad: dubbele conditie aanwezig", hasDoubleConditional(oldRule));
  check("nieuw pad: geen dubbele conditie", !hasDoubleConditional(newRule));

  // OUD voor een 'dat'-conditie die geen blacklist/strip kon redden
  const datCondition = "Bevestig dat ROAS en CPA op de overblijvende inventory binnen 1-2 weken verbeteren.";
  const oldDat = `Continueer alleen als ${datCondition.toLowerCase()}; stop of schaal af als de metric uitblijft.`;
  const newDat = stopContinueRecovery({ metrics: ["ROAS", "CPA"], direction: "verbetert", window: "1-2 weken" });
  console.log("     oud (dat): " + oldDat);
  console.log("     nieuw (dat): " + newDat);
  check("oud 'dat'-pad: misvormde grammatica ('als bevestig dat ...')", /als bevestig dat/i.test(oldDat));
  check("nieuw 'dat'-pad: schone kale predicaat-render", !/als bevestig dat/i.test(newDat) && newDat.includes("ROAS en CPA verbeteren binnen 1-2 weken"));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);