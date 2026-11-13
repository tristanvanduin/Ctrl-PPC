export {};
// Verificatie van F5 4a (backstop): de containsUngroundedNumber-guard die in de QA een red
// flag zet als de finale laag een percentage of eurobedrag bevat dat niet herleidbaar is tot
// de echte finding-data. De finale laag is al kwalitatief; deze guard vangt regressie of
// LLM-injectie. De echte functies uit monthly-structured.ts; hier stond een kopie
// die dezelfde fouten droeg als het origineel en daardoor niets bewaakte.
// Draaien: npx tsx lib/analysis/__ongegrond_getal_test.ts

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

import { containsUngroundedNumber, groundedNumbersFromCluster as uitCluster } from "./monthly-structured";

// De metriek bepaalt de soort: een percentage telt alleen als gegrond voor een percentage in de
// tekst, een bedrag alleen voor een bedrag (zie groundedNumbersFromCluster).
type Finding = { metric: string; current_value: number | null; previous_value: number | null; change_pct: number | null };
// De echte functie leest de findings van een cluster; meer heeft hij niet nodig.
const groundedNumbersFromCluster = (findings: Finding[]): number[] =>
  uitCluster({ findings } as unknown as Parameters<typeof uitCluster>[0]);

console.log("\n1. Vuurt op een niet-herleidbaar percentage, niet op een gegrond percentage");
check("'daling van 40 procent' zonder bron -> vuurt", containsUngroundedNumber("daling van 40 procent", []) === true);
check("'daling van 40 procent' met 40 in de data -> vuurt niet", containsUngroundedNumber("daling van 40 procent", [40]) === false);
check("'Lost IS van 23 procent' met 23 in de data -> vuurt niet", containsUngroundedNumber("tot circa 23 procent extra volume", [23]) === false);
check("percentage met '%' telt ook", containsUngroundedNumber("stijging van 40%", [23]) === true);

console.log("\n2. Vuurt op een niet-herleidbaar eurobedrag, niet op een gegrond bedrag");
check("'EUR 398' niet in de data -> vuurt", containsUngroundedNumber("besparing van EUR 398 per maand", [100]) === true);
check("'EUR 398' wel in de data -> vuurt niet", containsUngroundedNumber("besparing van EUR 398 per maand", [398]) === false);
check("euroteken telt ook", containsUngroundedNumber("besparing van € 250", [398]) === true);

console.log("\n3. Vensters en kwalitatieve tekst triggeren niet");
check("'meetbaar binnen 1-2 weken' -> geen trigger", containsUngroundedNumber("meetbaar binnen 1-2 weken", []) === false);
check("'binnen 7 dagen' -> geen trigger", containsUngroundedNumber("stop binnen 7 dagen", []) === false);
check("kwalitatieve claim zonder cijfers -> geen trigger", containsUngroundedNumber("CPA beweegt richting target", []) === false);

console.log("\n4. De QA-red-flag-scan over de finale aanbevelingen");
{
  type Rec = { doel: string; voorwaarde: string; risico: string };
  const findings: Finding[] = [
    { metric: "search_budget_lost_is", current_value: 23, previous_value: 31, change_pct: -8 }, // Lost IS 23
    { metric: "spend", current_value: 398, previous_value: 420, change_pct: -5 }, // spend 398
  ];
  const allowed = groundedNumbersFromCluster(findings);
  const scan = (recs: Rec[]) => recs.some((r) =>
    containsUngroundedNumber(r.doel, allowed) || containsUngroundedNumber(r.voorwaarde, allowed) || containsUngroundedNumber(r.risico, allowed));
  const fabricated: Rec[] = [{ doel: "Reductie van CPA met minimaal 40 procent", voorwaarde: "Bevestig binnen 1-2 weken", risico: "Tijdelijke learning reset" }];
  const grounded: Rec[] = [{ doel: "tot circa 23 procent extra volume, begrensd door 23 procent budget-IS-verlies", voorwaarde: "Bevestig binnen 1-2 weken", risico: "Beperkte extra spend" }];
  check("aanbeveling met verzonnen 40 procent -> red flag", scan(fabricated) === true);
  check("aanbeveling met gegronde 23 procent -> geen red flag", scan(grounded) === false);
  check("besparing EUR 398 die in findings staat -> geen red flag", scan([{ doel: "besparing van EUR 398 per maand", voorwaarde: "x", risico: "y" }]) === false);
  // Over de soort heen grondt niets: 398 is een bedrag in de data, dus "398 procent" is verzonnen,
  // en 23 is een aandeel, dus "EUR 23" ook.
  check("398 als bedrag grondt geen 398 procent", scan([{ doel: "een stijging van 398 procent", voorwaarde: "x", risico: "y" }]) === true);
  check("23 procent als aandeel grondt geen EUR 23", scan([{ doel: "besparing van EUR 23 per maand", voorwaarde: "x", risico: "y" }]) === true);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);