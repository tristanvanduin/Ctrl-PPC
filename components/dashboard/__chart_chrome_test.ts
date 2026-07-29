// Test voor de grafiek-chrome. Deterministisch, geen IO.
// Draaien: npx tsx components/dashboard/__chart_chrome_test.ts

import { asSchaal, kortGetal, kortEuro, maandLabel } from "./chart-chrome";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Compacte getallen ──
assert(kortGetal(950) === "950", "onder duizend blijft het hele getal staan");
assert(kortGetal(26000) === "26k", "duizendtallen worden k");
assert(kortGetal(6500) === "6,5k", "onder de tienduizend één decimaal, met een komma");
assert(kortGetal(1_240_000) === "1,2M", "miljoenen worden M");
assert(kortEuro(20000) === "€ 20k", "de euro staat ervoor met een spatie");

// ── Maandlabels ──
assert(maandLabel("2026-02") === "feb '26", "een ISO-maand wordt een leesbare maand");
assert(maandLabel("2026-02-01") === "feb '26", "een volledige datum ook");
assert(maandLabel("onzin") === "onzin", "wat geen maand is blijft staan zoals het is");

// ── De y-schaal ──
// Twee eisen tegelijk: elke tick op een ronde stap, én zo min mogelijk loze ruimte boven de
// hoogste balk. Alleen het eerste is makkelijk (rond ruim naar boven af); de combinatie is het punt.
for (const max of [9.4, 174, 1650, 25790, 26000, 1_240_000, 3, 47]) {
  const { domain, tickCount } = asSchaal(max);
  const stap = domain[1] / (tickCount - 1);

  assert(domain[0] === 0, `${max}: de as begint op nul`);
  assert(domain[1] >= max, `${max}: het plafond ligt boven het maximum`);

  // Elke tick valt op een veelvoud van de stap, en de stap is zelf rond (1/2/2,5/5 × macht van 10).
  const genormaliseerd = stap / Math.pow(10, Math.floor(Math.log10(stap)));
  const rond = [1, 2, 2.5, 5].some((r) => Math.abs(genormaliseerd - r) < 1e-9);
  assert(rond, `${max}: de stap ${stap} is een ronde stap`);

  // Niet meer dan een kwart loze ruimte: anders drukt het plafond de balken plat en lijken de
  // verschillen kleiner dan ze zijn.
  assert(domain[1] <= max * 1.25 || max < 10, `${max}: het plafond ${domain[1]} voegt hoogstens een kwart lucht toe`);
  assert(tickCount >= 3 && tickCount <= 6, `${max}: ${tickCount} ticks is een leesbaar aantal`);
}

// Randgevallen: een lege of onzinnige reeks mag geen NaN-as opleveren.
for (const kapot of [0, -5, NaN, Infinity]) {
  const { domain, tickCount } = asSchaal(kapot);
  assert(Number.isFinite(domain[1]) && domain[1] > 0, `${kapot} geeft een bruikbaar plafond`);
  assert(Number.isFinite(tickCount) && tickCount >= 2, `${kapot} geeft een bruikbaar aantal ticks`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
