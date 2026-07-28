// Test voor de gedeelde trendberekening.
// Draaien: npx tsx lib/analysis/__trend_test.ts
//
// De CPA-trend werd op zes plekken zelfstandig uitgerekend, met vier verschillende drempels.
// Op een account waar de CPA 12 procent steeg vuurde dgm-view regel 617 een waarschuwing af
// terwijl regel 236 in hetzelfde bestand zweeg. Twee blokken op hetzelfde scherm, hetzelfde
// account, tegengestelde uitspraken.
//
// En de berekening zelf klopte niet: alle zes vergeleken de eerste maand met de laatste en
// negeerden alles ertussen.

import { trendOver, cpaTrendFrom, CPA_TREND, TREND_WINDOW } from "./trend";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const punten = (waarden: (number | null)[]) =>
  waarden.map((v, i) => ({ realized: v, monthLabel: `M${i + 1}` }));

// ── De berekening kijkt naar de periode, niet naar twee losse maanden ──────

console.log("De trend over een periode");
{
  // Twaalf maanden wegzakken, laatste maand herstelt. Eerste-tegen-laatste gaf +1 procent.
  const reeks = [100, 95, 88, 80, 72, 65, 58, 52, 48, 44, 40, 38, 101];
  const eersteVsLaatste = ((reeks[12] - reeks[0]) / reeks[0]) * 100;
  check("eerste-tegen-laatste zag hier niets", Math.abs(eersteVsLaatste) < 5, `${eersteVsLaatste.toFixed(1)}%`);
  check("de periodevergelijking geeft iets anders", trendOver(reeks) !== eersteVsLaatste);
}
{
  // Een halve eerste maand na de lancering gaf duizenden procenten "groei".
  const reeks = [3, 80, 84, 79, 88, 91, 85, 90, 87, 92, 88, 90, 86];
  check("eerste-tegen-laatste verzon 2767 procent", ((reeks[12] - reeks[0]) / reeks[0]) * 100 > 2000);
  check("de periodevergelijking ziet een vlakke reeks", Math.abs(trendOver(reeks)) < 10, `${trendOver(reeks).toFixed(1)}%`);
}
check("een echte daling wordt gezien", trendOver([100, 98, 96, 90, 85, 80, 70, 62, 55, 48, 42, 38, 34]) < -15);
check("een echte stijging ook", trendOver([34, 38, 42, 48, 55, 62, 70, 80, 85, 90, 96, 98, 100]) > 15);
check("een losse piek kantelt de trend niet", trendOver([50, 50, 50, 50, 50, 50, 50, 50, 500]) < 400);

// ── Nooit NaN of Infinity, want die belanden in een zin ────────────────────

console.log("\nRandgevallen leveren een bruikbaar getal");
for (const reeks of [[], [42], [0, 0], [0, 0, 0, 5, 5, 5], [1, 2], [-5, -3, -1], [1e9, 1]]) {
  check(`[${reeks.join(",")}] is eindig`, Number.isFinite(trendOver(reeks)), String(trendOver(reeks)));
}
check("een nulbasis geeft 0 en geen Infinity", trendOver([0, 0, 0, 10, 10, 10]) === 0);

// ── cpaTrendFrom ───────────────────────────────────────────────────────────

console.log("\nDe CPA-trend uit forecast-punten");
{
  const t = cpaTrendFrom(punten([50, 52, 51, 60, 62, 61]));
  check("er komt een percentage uit", t.pct !== null);
  check("de stijging is ongeveer 19 procent", Math.abs((t.pct ?? 0) - 19.6) < 1, String(t.pct));
  check("dat is een stijging", t.stijgt);
  check("maar niet hard", !t.stijgtHard);
  check("en geen daling", !t.daalt);
  check("het label noemt de vergeleken maanden", t.periode.includes("M1") && t.periode.includes("M6"), t.periode);
}
{
  // Te weinig maanden: geen uitspraak, en zeker geen 0 procent die als "stabiel" leest.
  const t = cpaTrendFrom(punten([50]));
  check("een enkele maand geeft geen trend", t.pct === null);
  check("en dus geen signaal", !t.stijgt && !t.daalt && !t.stijgtHard);
  check("en geen label", t.periode === "");
}
{
  // Lopende maanden (null) tellen niet mee: als nul lezen zou de CPA kunstmatig verlagen.
  const t = cpaTrendFrom(punten([50, 52, 51, 60, 62, 61, null, null]));
  const zonder = cpaTrendFrom(punten([50, 52, 51, 60, 62, 61]));
  check("nulls veranderen de uitkomst niet", t.pct === zonder.pct, `${t.pct} tegen ${zonder.pct}`);
}
{
  const t = cpaTrendFrom(punten([60, 62, 61, 50, 52, 51]));
  check("een daling wordt herkend", t.daalt, String(t.pct));
  check("en niet als stijging", !t.stijgt);
}

// ── De drempels zijn er maar één keer ──────────────────────────────────────

console.log("\nEén set drempels");
check("stijgt ligt op 15", CPA_TREND.stijgt === 15);
check("stijgtHard ligt hoger dan stijgt", CPA_TREND.stijgtHard > CPA_TREND.stijgt);
check("daalt is negatief", CPA_TREND.daalt < 0);
check("het venster is minstens 2", TREND_WINDOW >= 2);

// Het geval waarop de blokken uiteenliepen: een stijging van 12 procent. Onder één drempel
// zegt iedereen nu hetzelfde, wat dat ook is.
{
  const t = cpaTrendFrom(punten([50, 50, 50, 56, 56, 56]));
  check("12 procent is een eenduidige uitkomst", Math.abs((t.pct ?? 0) - 12) < 0.5, String(t.pct));
  check("en valt onder de drempel", !t.stijgt, `${t.pct} tegen drempel ${CPA_TREND.stijgt}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
