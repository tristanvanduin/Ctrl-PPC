// Verificatie van F5 4c: het floor-scenario lowercasede de hele threadtitel mid-zin,
// waardoor entiteitsnamen als UK-MPC hun casing verloren. Ook de hypothese-success_next_month
// van hypothese 1 hergebruikt dit floor-scenario, dus de fix propageert daarheen.
// Getoetst op de echte buildSuccessScenario uit monthly-structured.ts; hier stond eerst een kopie.
// Draaien: npx tsx lib/analysis/__success_scenario_casing_test.ts

import { buildSuccessScenario, normalizeText } from "./monthly-structured";

type Threads = Parameters<typeof buildSuccessScenario>[0];
let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

// OUD (de bug), alleen als contrast: hele titel gelowercased.
const floorOld = (p: { title: string; monitoring_metrics: string[] }) =>
  `De maand is beter als ${p.monitoring_metrics.slice(0, 2).join(" en ")} stabiliseren zonder nieuwe escalatie in ${p.title.toLowerCase()}.`;

const thread = { title: "UK-MPC - Apple - Generic - Automated mist vraag", monitoring_metrics: ["ROAS", "CPA"] };
const scenario = buildSuccessScenario([thread] as unknown as Threads, []);

console.log("\n1. Het floor-scenario behoudt de casing van de entiteitsnamen");
const newFloor = scenario.floor_scenario;
const oldFloor = floorOld(thread);
console.log("     nieuw: " + newFloor);
console.log("     oud:   " + oldFloor);
check("nieuw behoudt 'UK-MPC'", newFloor.includes("UK-MPC"));
check("nieuw behoudt 'Apple'", newFloor.includes("Apple"));
check("oud sloopte het naar 'uk-mpc' (bewijs van de bug)", oldFloor.includes("uk-mpc") && !oldFloor.includes("UK-MPC"));

console.log("\n2. Floor en target vallen niet samen");
{
  // De gelijkheidsguard in buildSuccessScenario herschrijft target bij letterlijke samenval. Met de
  // huidige zinnen ("De maand is beter als..." tegen "Doelscenario: ...") kan dat niet gebeuren, dus
  // de guard zelf is van buiten niet te raken; wat hier wel te toetsen is, is de eigenschap die hij
  // beschermt. De kopie die hier stond forceerde een samenval die de echte functie nooit krijgt.
  check("target is het standaard doelscenario", scenario.target_scenario.startsWith("Doelscenario: de primaire thread"));
  check("floor en target verschillen", normalizeText(scenario.floor_scenario) !== normalizeText(scenario.target_scenario));
  const leeg = buildSuccessScenario([], []);
  check("zonder thread: eigen floor en target, ook verschillend", normalizeText(leeg.floor_scenario) !== normalizeText(leeg.target_scenario));
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
