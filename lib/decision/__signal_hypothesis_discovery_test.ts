// Test voor de eerste HypothesisDiscovery-implementatie. Deterministisch, geen IO.
// Draaien: npx tsx lib/decision/__signal_hypothesis_discovery_test.ts

import { signalHypothesisDiscovery } from "./signal-hypothesis-discovery";
import { classify } from "./hypothesis-discovery";
import type { Signal, CandidateCause } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const basisInput = { agencyId: "bureau-1", accountId: "klant-1" };

console.log("discover: elk signaal wordt exact een hypothese:");
{
  const signals: Signal[] = [
    { id: "schedule_waste", channel: "google", description: "Kosten zonder conversie in dit dagdeel." },
    { id: "budget_pacing", channel: "meta", description: "Budget loopt vast op het plafond." },
  ];
  const result = signalHypothesisDiscovery.discover({ ...basisInput, signals, causes: [] });
  assert(result.length === 2, "twee signalen leveren twee hypotheses, geen samenvoeging en geen verlies");
  assert(result[0].statement === signals[0].description, "de statement is de ongewijzigde signaalomschrijving");
  assert(result.every((h) => h.agencyId === "bureau-1" && h.accountId === "klant-1"), "elke hypothese draagt de meegegeven tenant-scope, niet verzonnen");
  assert(result.every((h) => h.category === undefined), "zonder detectorcategorie blijft category ongezet: discovery raadt niets");
  assert(new Set(result.map((h) => h.id)).size === 2, "elke hypothese krijgt een eigen id, geen hergebruik");
}

console.log("discover: lege invoer levert lege uitvoer, niets verzonnen:");
{
  const result = signalHypothesisDiscovery.discover({ ...basisInput, signals: [], causes: [] });
  assert(result.length === 0, "geen signalen en geen oorzaken: geen hypotheses, geen gok");
}

console.log("discover: causes leveren ook hypotheses op, niet alleen signals:");
{
  const causes: CandidateCause[] = [
    { id: "c1", agencyId: "bureau-1", accountId: "klant-1", description: "De landingspagina laadt traag op mobiel." },
  ];
  const result = signalHypothesisDiscovery.discover({ ...basisInput, signals: [], causes });
  assert(result.length === 1 && result[0].statement === causes[0].description, "een oorzaak wordt net als een signaal een kandidaat-hypothese");
}

console.log("discover -> classify: de keten werkt, discovery classificeert niet vooraf:");
{
  const signals: Signal[] = [
    { id: "budget_signal", channel: "google", description: "Het budget voor Search staat te laag afgesteld." },
  ];
  const [hypothese] = signalHypothesisDiscovery.discover({ ...basisInput, signals, causes: [] });
  assert(hypothese.category === undefined, "voor classify() draait is category nog leeg");
  assert(classify(hypothese) === "budget", "classify() herkent budget uit dezelfde tekst die discovery opleverde");
}

console.log("discover: de categorie van de detector reist mee en wint van de tekstmatch:");
{
  // De echte verhaaltekst van schedule_waste (lib/signals/google-schedule.ts) bevat geen enkel
  // trefwoord uit TREFWOORDEN; zonder de meegereisde categorie kwam dit signaal als null binnen.
  const signals: Signal[] = [{
    id: "schedule_waste", channel: "google", category: "budget_pacing",
    description: "zondag 02 tot 05 uur: In dit dagdeel ging 84.20 aan kosten (3.1% van het accounttotaal) naar 61 klikken zonder een enkele conversie. toets de biedaanpassing of uitsluiting voor dit dagdeel.",
  }];
  const [hypothese] = signalHypothesisDiscovery.discover({ ...basisInput, signals, causes: [] });
  assert(hypothese.category === "budget", "budget_pacing wordt de gesloten categorie budget");
  assert(classify(hypothese) === "budget", "classify() honoreert de meegereisde categorie, ook zonder trefwoord in de tekst");
  const zonderTag: Signal[] = [{ id: "x", channel: "google", category: "cross_channel", description: "Iets zonder trefwoord." }];
  const [los] = signalHypothesisDiscovery.discover({ ...basisInput, signals: zonderTag, causes: [] });
  assert(los.category === undefined && classify(los) === null, "cross_channel heeft geen vaste categorie: geen tag, en de tekst beslist (null)");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
