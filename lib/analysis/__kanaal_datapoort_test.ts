// De datapoort van de kanaalanalyses: melding en status uit de dagstand.
// Draaien: npx tsx lib/analysis/__kanaal_datapoort_test.ts

import { kanaalDatapoort } from "./kanaal-datapoort";
import { beoordeelDagstand } from "../sync/datastand";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = "2026-09-03";
const dood = kanaalDatapoort(beoordeelDagstand({ kanaal: "meta", laatsteDag: "2026-04-17", nu: NU }));
check("dood: 409, blokkadetekst, actie wijst naar de sync/koppeling van het bureau", dood.status === 409 && dood.melding.startsWith("Geen bruikbare Meta-dagdata") && dood.action.includes("/api/sync/meta"), JSON.stringify(dood));
const geen = kanaalDatapoort(beoordeelDagstand({ kanaal: "linkedin", laatsteDag: null, nu: NU }));
check("geen: 409, actie wijst naar de kanaalkoppeling per klant", geen.status === 409 && geen.action.includes("Kanaalkoppelingen per klant"), JSON.stringify(geen));
const achter = kanaalDatapoort(beoordeelDagstand({ kanaal: "microsoft", laatsteDag: "2026-08-25", nu: NU }));
check("achter: 404 met de stand in de tekst (het venster was leeg, de sync leeft)", achter.status === 404 && achter.melding.includes("analysevenster") && achter.melding.includes("2026-08-25"), JSON.stringify(achter));
check("de melding noemt nooit Google", !dood.melding.includes("Google") && !geen.melding.includes("Google") && !achter.melding.includes("Google"));

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
