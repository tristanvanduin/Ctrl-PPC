// De periodekeuze op de echte demo-dataset, via dezelfde adapter als de UI.
// Draaien: npx tsx lib/period/__period_demo_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De rekenlaag is los getest, maar dat bewijst niet dat de keten werkt: demo-mock ->
// adapter -> ClientHistoricalData -> slicePeriod. Juist daar zit de aanname die stil fout kan
// gaan, namelijk dat de vorm die de demo oplevert dezelfde is als die van echte data. Gaat dat
// mis, dan toont het dashboard lege of halve totalen zonder een foutmelding.
//
// Deze test loopt precies de weg die de browser ook loopt, met de echte demo-data.

import { buildGreentechClientData, DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import { flattenMonths, slicePeriod, comparePeriods } from "./apply-period";
import { resolvePeriod, resolveComparison, monthCount, PERIOD_PRESETS, COMPARISON_MODES } from "./period-range";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Exact dezelfde aanroep als lib/use-client-data.ts doet.
const api = buildGreentechClientData(DEMO_GREENTECH_ID);
const data = buildClientDataFromApi(
  DEMO_GREENTECH_ID,
  api.historicalYears as YearDataInput[],
  api.currentYearMonthly as ApiMonthlyData[],
  api.currentYearWeekly as ApiWeeklyData[],
  api.targetCurrentYear,
  api.currentYear,
  api.realizedThroughMonth,
);

// ── DEZE TEST STOND STIL IN DE TIJD ────────────────────────────────────────
//
// Hier stond `alle.length === 30` en "eindigt in juni 2026", plus verderop `const nu = "2026-07"`.
// Alle drie bevroren op het moment van schrijven. Daardoor bleef deze test groen terwijl het
// dashboard in augustus 2026 wél een amberen melding gaf: "Voor juli 2026 is geen data geladen."
// De test toetste de foto, de app leefde door.
//
// Nu leiden de verwachtingen zich af uit dezelfde bron als de app: realizedThroughMonth uit de
// mock, en de echte klok voor "nu". Wat er getoetst wordt is de EIGENSCHAP -- de demo dekt zijn
// eigen standaardperiode -- en niet de stand van één dag.
const GEREALISEERD = api.realizedThroughMonth as number;
const LAATSTE_MAAND = `2026-${String(GEREALISEERD).padStart(2, "0")}`;
// Dezelfde maand die de UI als "nu" hanteert: de lopende maand, in UTC net als de demo-data.
const NU = (() => {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
})();

console.log("De demo-data door de adapter");
{
  const alle = flattenMonths(data);
  check("er zijn maanden", alle.length > 0, String(alle.length));
  check("2024 en 2025 compleet plus 2026 tot de laatste afgesloten maand",
    alle.length === 24 + GEREALISEERD, `${alle.length} bij gerealiseerd t/m ${GEREALISEERD}`);
  check("begint in januari 2024", alle[0].key === "2024-01", alle[0]?.key);
  check("eindigt op de laatste gerealiseerde maand",
    alle[alle.length - 1].key === LAATSTE_MAAND, `${alle[alle.length - 1]?.key} vs ${LAATSTE_MAAND}`);
  check("elke maand heeft besteding", alle.every((m) => m.adSpend > 0));
  check("geen dubbele maanden", new Set(alle.map((m) => m.key)).size === alle.length);
  check("oplopend gesorteerd", alle.every((m, i) => i === 0 || alle[i - 1].key < m.key));
}

console.log("\nDe standaardinstelling van de kiezer");
{
  // last_12m plus same_period_last_year is wat een gebruiker als eerste ziet. Beide moeten
  // volledig gedekt zijn, anders opent het dashboard met een waarschuwing over ontbrekende
  // maanden terwijl er niets aan de hand is.
  // De echte klok, net als de app. Zie de toelichting bovenaan: een vastgezette "nu" liet
  // deze test een dag toetsen in plaats van een eigenschap.
  const nu = NU;
  const p = resolvePeriod("last_12m", null, nu);
  const c = resolveComparison(p, "same_period_last_year")!;
  const huidig = slicePeriod(data, p);
  const vorig = slicePeriod(data, c);
  check("de standaardperiode is volledig gedekt", huidig.missing.length === 0, huidig.missing.join(","));
  check("de vergelijking ook", vorig.missing.length === 0, vorig.missing.join(","));
  check("twaalf maanden data", huidig.months.length === 12, String(huidig.months.length));
  check("en twaalf om tegen af te zetten", vorig.months.length === 12);
  check("er is besteding in beide", huidig.totals.adSpend > 0 && vorig.totals.adSpend > 0);
}

console.log("\nElke preset levert cijfers op de demo");
{
  const nu = NU;
  for (const preset of PERIOD_PRESETS) {
    const p = resolvePeriod(preset, { start: "2025-03", end: "2025-09" }, nu);
    const s = slicePeriod(data, p);
    check(`${preset}: heeft maanden`, s.months.length > 0, `${p.start}..${p.end}`);
    check(`${preset}: geen ontbrekende maanden`, s.missing.length === 0, s.missing.join(","));
    check(`${preset}: totalen zijn eindig`, [s.totals.conversions, s.totals.revenue, s.totals.adSpend].every(Number.isFinite));
    check(`${preset}: besteding is positief`, s.totals.adSpend > 0);
  }
}

console.log("\nElke vergelijking levert een deltaset op");
{
  const nu = NU;
  for (const mode of COMPARISON_MODES) {
    const p = resolvePeriod("last_6m", null, nu);
    const c = resolveComparison(p, mode);
    const r = comparePeriods(data, p, c);
    if (mode === "none") {
      check("geen vergelijking geeft geen deltas", r.deltas === null);
      continue;
    }
    check(`${mode}: er zijn deltas`, r.deltas !== null);
    check(`${mode}: even veel maanden`, r.previous?.months.length === r.current.months.length,
      `${r.current.months.length} tegen ${r.previous?.months.length}`);
    check(`${mode}: percentages zijn eindig of null`,
      [r.deltas!.conversions.pct, r.deltas!.revenue.pct, r.deltas!.adSpend.pct]
        .every((v) => v === null || Number.isFinite(v)));
    // De demo groeit jaar op jaar; een vergelijking die overal nul teruggeeft zou betekenen
    // dat de snede de verkeerde maanden pakt.
    check(`${mode}: de cijfers verschillen echt`, r.current.totals.adSpend !== r.previous!.totals.adSpend);
  }
}

console.log("\nDe grenzen van de demo-dataset");
{
  // Verder terug dan de demo reikt: dat hoort gemeld te worden, niet stil ingekort.
  const s = slicePeriod(data, { start: "2023-07", end: "2024-06" });
  check("ontbrekende maanden worden gemeld", s.missing.length === 6, String(s.missing.length));
  check("en de bestaande komen wel terug", s.months.length === 6);
  check("het totaal gaat alleen over wat er is", s.totals.adSpend > 0);
  check("de gevraagde lengte klopt met de som", s.months.length + s.missing.length === monthCount({ start: "2023-07", end: "2024-06" }));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
