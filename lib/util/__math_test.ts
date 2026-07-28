// De gedeelde deling. Deterministisch, geen IO.
// Draaien: npx tsx lib/util/__math_test.ts
//
// `safeDiv` stond vijf keer in de codebase, in drie gedragingen. Ze waren het oneens over wat
// "veilig" betekent, en dat werd zichtbaar zodra de invoer niet netjes was. Gemeten:
//
//   geval                vier van de vijf   de strengste
//   negatieve noemer     -2,5               null
//   NaN in de teller     NaN                null
//   Infinity als noemer  0                  null
//
// Die laatste is de gevaarlijkste: 10 / Infinity is 0, en een 0 leest als een meting ("de CTR
// was 0%") terwijl de noemer kapot was. Een NaN die doorstroomt wordt door JSON.stringify
// stilzwijgend `null`, en dan is niet meer te zien of er niets gemeten is of dat er iets is
// misgegaan.

import { safeDiv } from "./math";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("Gewone deling");
check("deelt", safeDiv(10, 4) === 2.5, String(safeDiv(10, 4)));
check("een negatieve teller mag", safeDiv(-10, 4) === -2.5, String(safeDiv(-10, 4)));
check("een teller van nul geeft nul", safeDiv(0, 4) === 0, String(safeDiv(0, 4)));

console.log("\nWat null hoort te geven");
{
  // Deling door nul: het klassieke geval, en het enige dat alle vijf de varianten al aankonden.
  check("noemer nul", safeDiv(10, 0) === null);
  // De noemers in deze codebase zijn tellingen of bedragen; negatief betekent kapotte data.
  check("negatieve noemer", safeDiv(10, -4) === null, String(safeDiv(10, -4)));
  // En dit is de belangrijkste: geen 0 die als meting leest.
  check("Infinity als noemer geeft null en geen nul", safeDiv(10, Infinity) === null,
    `${safeDiv(10, Infinity)} — vier van de vijf varianten gaven hier 0`);
  check("Infinity als teller", safeDiv(Infinity, 4) === null);
  check("NaN als teller", safeDiv(NaN, 4) === null);
  check("NaN als noemer", safeDiv(10, NaN) === null);
  check("null als teller", safeDiv(null, 4) === null);
  check("null als noemer", safeDiv(10, null) === null);
  check("undefined telt als ontbrekend", safeDiv(undefined, 4) === null && safeDiv(10, undefined) === null);
  // Eindige invoer kan alsnog overlopen. Deze test vond dat gat in de eerste versie van safeDiv:
  // alle guards lieten het door en er kwam Infinity uit.
  check("een overlopende deling geeft null", safeDiv(1e308, 1e-308) === null,
    String(safeDiv(1e308, 1e-308)));
}

console.log("\nGeen NaN of Infinity in de uitvoer");
{
  const invoer: Array<[number | null | undefined, number | null | undefined]> = [
    [10, 4], [10, 0], [10, -4], [NaN, 4], [10, NaN], [Infinity, 4], [10, Infinity],
    [null, 4], [10, null], [undefined, undefined], [0, 0], [-0, 5], [1e308, 1e-308],
  ];
  const kapot = invoer
    .map(([n, d]) => safeDiv(n, d))
    .filter((v) => v !== null && !Number.isFinite(v));
  check("geen enkele uitkomst is NaN of Infinity", kapot.length === 0, JSON.stringify(kapot));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
