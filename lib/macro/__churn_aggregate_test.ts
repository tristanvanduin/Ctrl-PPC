// De churn-aggregator: rijen naar cellen, op elk segmentniveau waarop een klant is afgebakend,
// nooit twee bureaus samengevoegd in één cel, tellingen (niet sommen) van rood/amber/groen/onbekend.

import { bouwMacroChurn } from "./churn-aggregate";
import type { MacroChurnInvoerRij } from "./churn-aggregate";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

function rij(deel: Partial<MacroChurnInvoerRij> & { clientId: string }): MacroChurnInvoerRij {
  return { agencyId: "bureau-a", bedrijfsmodel: null, niche: null, licht: "groen", ...deel };
}

console.log("geen segment: alleen de agency-brede cel");
const kaal = bouwMacroChurn([rij({ clientId: "k1", licht: "rood" })]);
check("precies één cel", kaal.length === 1, JSON.stringify(kaal));
check("zonder model en niche", kaal[0].sleutel.bedrijfsmodel === null && kaal[0].sleutel.niche === null);
check("1 rood geteld", kaal[0].telling.rood === 1);

console.log("\nmodel én niche: vier cellen uit één rij");
const compleet = bouwMacroChurn([rij({ clientId: "k1", bedrijfsmodel: "b2b", niche: "software", licht: "amber" })]);
check("vier dieptes (alles, model, niche, model+niche)", compleet.length === 4, JSON.stringify(compleet.map((c) => c.sleutel)));
check("elke cel telt hetzelfde amber", compleet.every((c) => c.telling.amber === 1));

console.log("\ntellen, niet optellen: rood/amber/groen apart, per bureau gescheiden");
const tweeBureaus = bouwMacroChurn([
  rij({ clientId: "a1", agencyId: "bureau-a", bedrijfsmodel: "b2c", licht: "rood" }),
  rij({ clientId: "a2", agencyId: "bureau-a", bedrijfsmodel: "b2c", licht: "groen" }),
  rij({ clientId: "b1", agencyId: "bureau-b", bedrijfsmodel: "b2c", licht: "rood" }),
]);
const modelCellen = tweeBureaus.filter((c) => c.sleutel.bedrijfsmodel === "b2c" && c.sleutel.niche === null);
check("twee bureaus geven twee cellen, geen samengevoegde", modelCellen.length === 2, JSON.stringify(modelCellen));
const bureauA = modelCellen.find((c) => c.sleutel.agencyId === "bureau-a")!;
check("bureau A: 1 rood, 1 groen, 2 accounts", bureauA.telling.rood === 1 && bureauA.telling.groen === 1 && bureauA.accounts === 2, JSON.stringify(bureauA));
const bureauB = modelCellen.find((c) => c.sleutel.agencyId === "bureau-b")!;
check("bureau B ziet niets van bureau A's telling", bureauB.telling.rood === 1 && bureauB.telling.groen === 0);

console.log("\nonbekend telt apart, niet als groen");
const metOnbekend = bouwMacroChurn([rij({ clientId: "k1", licht: "onbekend" })]);
check("onbekend komt in de onbekend-teller terecht", metOnbekend[0].telling.onbekend === 1 && metOnbekend[0].telling.groen === 0);

console.log("\nsortering: meeste rood+amber eerst");
const gesorteerd = bouwMacroChurn([
  rij({ clientId: "k1", niche: "rustig", licht: "groen" }),
  rij({ clientId: "k2", niche: "onrustig", licht: "rood" }),
  rij({ clientId: "k3", niche: "onrustig", licht: "rood" }),
]);
check("de onrustige niche staat vooraan", gesorteerd[0].sleutel.niche === "onrustig" || gesorteerd.find((c) => c.sleutel.niche)!.sleutel.niche === "onrustig",
  JSON.stringify(gesorteerd.map((c) => c.sleutel)));

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
