// Test voor de grafiek-chrome. Deterministisch, geen IO.
// Draaien: npx tsx components/dashboard/__chart_chrome_test.ts

import { asSchaal, asSchaalLijn, balkBreedte, kortGetal, kortEuro, maandLabel } from "./chart-chrome";

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
// Een komma-nul draagt geen informatie: op één as stond "€ 5,0k" naast "€ 10k" en "€ 15k".
assert(kortGetal(5000) === "5k", "een ronde vijfduizend is 5k en niet 5,0k");
assert(kortGetal(2_000_000) === "2M", "twee miljoen is 2M en niet 2,0M");
assert(kortGetal(1500) === "1,5k", "een halve duizend blijft wél staan");

// ── Balkbreedte ──
// De breedte volgt het aantal categorieën, maar altijd onder het plafond.
assert(balkBreedte(4) > balkBreedte(12), "minder categorieën geeft bredere balken");
assert(balkBreedte(4) >= balkBreedte(6) && balkBreedte(6) >= balkBreedte(12), "de reeks loopt aflopend");
// Het plafond is geen richtlijn maar een grens: boven de 24 pixels leest een verzadigde vulling
// als een verfvlak in plaats van als een meetwaarde. Dat is de reden dat het palet mag zoals het is.
for (const n of [1, 2, 4, 6, 12, 40]) {
  const b = balkBreedte(n);
  assert(b <= 24, `${n} categorieën blijft onder het plafond van 24 (${b})`);
  assert(b >= 10, `${n} categorieën blijft dik genoeg om te zien (${b})`);
}

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

// ── De y-schaal voor een lijn ──
// Een balk mag het plafond raken: hij eindigt op zijn waarde. Een lijn niet — die heeft dikte, en
// bij een plafond gelijk aan het maximum wordt de bovenste helft van de streek weggesneden.
for (const max of [1500, 174, 9.4, 25790]) {
  const strak = asSchaal(max);
  const ruim = asSchaalLijn(max);

  assert(ruim.domain[1] > max, `${max}: de lijn-as ligt boven het maximum en niet erop`);
  assert(ruim.domain[1] >= strak.domain[1], `${max}: de lijn-as is nooit krapper dan de balk-as`);
  // Wel lucht, geen zaal: meer dan de helft erbij drukt de vorm plat.
  assert(ruim.domain[1] <= max * 1.5 || max < 10, `${max}: het lijn-plafond ${ruim.domain[1]} blijft in de buurt van de data`);

  const stap = ruim.domain[1] / (ruim.tickCount - 1);
  const genormaliseerd = stap / Math.pow(10, Math.floor(Math.log10(stap)));
  assert([1, 2, 2.5, 5].some((r) => Math.abs(genormaliseerd - r) < 1e-9), `${max}: ook de lijn-as houdt ronde stappen`);
}

// Het geval dat het probleem liet zien: 1.500 acties tegen een plafond van precies 1.500.
assert(asSchaal(1500).domain[1] === 1500, "de balk-as sluit strak op 1500 aan");
assert(asSchaalLijn(1500).domain[1] > 1500, "de lijn-as laat 1500 niet tegen de bovenrand plakken");

// Randgevallen: een lege of onzinnige reeks mag geen NaN-as opleveren.
for (const kapot of [0, -5, NaN, Infinity]) {
  const { domain, tickCount } = asSchaal(kapot);
  assert(Number.isFinite(domain[1]) && domain[1] > 0, `${kapot} geeft een bruikbaar plafond`);
  assert(Number.isFinite(tickCount) && tickCount >= 2, `${kapot} geeft een bruikbaar aantal ticks`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
