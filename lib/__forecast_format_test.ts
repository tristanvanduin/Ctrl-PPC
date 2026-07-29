// Test voor de gedeelde opmaak van forecast-getallen. Deterministisch, geen IO.
// Draaien: npx tsx lib/__forecast_format_test.ts
//
// Waarom deze test er is: dit bestand bestaat omdat dezelfde opmaak op acht plekken los stond en
// daar in drie schrijfwijzen uit kwam. Een test die de Nederlandse notatie vastlegt is de enige
// manier waarop dat niet stilletjes terugkomt.

import { formatRoas, formatPercent, formatDeltaPercent, formatCurrency, formatNumber } from "./forecast-format";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── ROAS ──
// De punt is in het Nederlands het duizendtalteken; "1.56" naast "€ 91.890" las als 1560.
assert(formatRoas(1.56) === "1,56×", "ROAS krijgt een komma en het maal-teken");
assert(formatRoas(4) === "4,00×", "een rond getal houdt zijn twee decimalen, zodat de kolom uitlijnt");
assert(!formatRoas(1.56).includes("."), "er staat nergens een punt in een ROAS");
assert(!formatRoas(1.56).includes("x"), "de letter x is het maal-teken niet — een schermlezer leest hem als letter");

// ── Percentages ──
assert(formatPercent(0.124) === "12,4%", "een verhouding wordt een percentage met een komma");
assert(formatPercent(0.124, 0) === "12%", "het aantal decimalen is te kiezen");
assert(formatPercent(1) === "100,0%", "honderd procent is honderd procent");
assert(formatPercent(NaN) === "—", "wat geen getal is krijgt een streepje en geen NaN%");

// ── Verschillen ──
// Het plusteken is het verschil tussen "erbij" en "in totaal"; zonder dat lezen ze hetzelfde.
assert(formatDeltaPercent(12.4) === "+12,4%", "een stijging draagt zijn plusteken");
assert(formatDeltaPercent(-7.7) === "-7,7%", "een daling draagt zijn minteken en geen tweede");
assert(formatDeltaPercent(0) === "0,0%", "geen verandering krijgt geen plusteken");
assert(formatDeltaPercent(12.4, 0) === "+12%", "ook hier is het aantal decimalen te kiezen");
assert(formatDeltaPercent(Infinity) === "—", "een oneindig verschil is geen verschil om te tonen");

// ── De andere twee, voor de volledigheid van dezelfde ladder ──
// Let op de  : Intl zet een harde spatie tussen het euroteken en het bedrag, geen gewone.
// Dat is precies de bedoeling — een bedrag hoort niet over twee regels te breken — maar wie hier
// een gewone spatie tikt, krijgt een test die faalt op iets dat goed is.
assert(formatCurrency(143520) === "€ 143.520", "een bedrag krijgt de Nederlandse duizendpunt en een harde spatie");
assert(formatNumber(1196) === "1.196", "een aantal ook");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
