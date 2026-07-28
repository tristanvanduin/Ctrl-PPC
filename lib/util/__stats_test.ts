// De gedeelde mediaan. Deterministisch, geen IO.
// Draaien: npx tsx lib/util/__stats_test.ts
//
// `median` stond zeven keer in de codebase, in drie smaken:
//
//   vier plekken   filter op eindige getallen, null bij een lege reeks
//   forecast.ts    gooide ook nullen en negatieven weg, gaf 0 bij leeg
//   event-forecast filterde niets en gaf NaN bij een lege reeks
//   asset-breakdown identiek aan de vier, maar onzichtbaar voor code-search door een NUL-byte
//                  in datzelfde bestand
//
// Dezelfde naam, hetzelfde begrip, drie antwoorden. De mediaan van [0, 0, 5] was 5 in
// forecast.ts en 0 in de rest.
//
// Dat verschil was niet cosmetisch. forecast.ts gebruikte median om de MAD te bepalen — de
// mediane absolute afwijking, de maat voor "hoeveel wisselt deze reeks normaal". Absolute
// afwijkingen zijn nul zodra een waarde gelijk is aan de mediaan, en juist die nullen gooide het
// filter weg.

import { median, medianAbsoluteDeviation } from "./stats";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── De mediaan zelf ───────────────────────────────────────────────────────

console.log("De mediaan");
{
  check("oneven aantal", median([3, 1, 2]) === 2);
  check("even aantal middelt de twee middelste", median([1, 2, 3, 4]) === 2.5);
  check("één waarde", median([7]) === 7);
  check("de invoer wordt niet gesorteerd teruggegeven", (() => {
    const invoer = [3, 1, 2];
    median(invoer);
    return invoer.join(",") === "3,1,2";
  })(), "median mag zijn invoer niet muteren");
}
{
  // Dit is het verschil dat ertoe deed. Nul is een meting, geen ontbrekende waarde.
  check("nullen tellen mee", median([0, 0, 5]) === 0, String(median([0, 0, 5])));
  check("negatieve waarden ook", median([-10, 0, 10]) === 0, String(median([-10, 0, 10])));
  check("een reeks van alleen nullen is nul", median([0, 0, 0]) === 0);
}
{
  // Leeg is niet nul: er valt niets te middelen. Nul zou als meting gelezen worden.
  check("een lege reeks geeft null", median([]) === null);
  check("en geen NaN", !Number.isNaN(median([]) as number));
  check("alleen niet-eindige waarden geeft ook null",
    median([NaN, Infinity, -Infinity]) === null, String(median([NaN, Infinity, -Infinity])));
  check("niet-eindige waarden worden eruit gefilterd", median([1, NaN, 3]) === 2, String(median([1, NaN, 3])));
}

// ── De MAD, waar het misging ──────────────────────────────────────────────

console.log("\nDe mediane absolute afwijking");
{
  // Stabiele reeks met één uitschieter: de afwijkingen zijn [0,0,0,0,200], mediaan 0.
  // Met het oude filter bleef alleen 200 over en werd de MAD 200.
  const reeks = [100, 100, 100, 100, 300];
  check("een stabiele reeks heeft MAD nul", medianAbsoluteDeviation(reeks) === 0,
    `${medianAbsoluteDeviation(reeks)} — met het oude filter was dit 200`);

  // Waarom dat uitmaakt: de uitschieterdrempel is mediaan + 3 × MAD.
  const med = median(reeks)!;
  const drempelJuist = med + 3 * (medianAbsoluteDeviation(reeks) || med * 0.5);
  const drempelOud = med + 3 * 200;
  check("de drempel ligt op 250", drempelJuist === 250, String(drempelJuist));
  check("en lag met het oude filter op 700", drempelOud === 700);
  check("300 wordt nu als uitschieter gezien", 300 > drempelJuist);
  check("en werd dat eerder niet", !(300 > drempelOud));
}
{
  check("een echt wisselende reeks heeft wel een MAD",
    medianAbsoluteDeviation([8, 10, 12, 40]) === 2, String(medianAbsoluteDeviation([8, 10, 12, 40])));
  check("een lege reeks geeft null", medianAbsoluteDeviation([]) === null);
  check("alles gelijk geeft nul", medianAbsoluteDeviation([50, 50, 50]) === 0);
  check("niet-eindige waarden storen niet",
    medianAbsoluteDeviation([10, NaN, 10, 10]) === 0, String(medianAbsoluteDeviation([10, NaN, 10, 10])));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
