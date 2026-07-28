// Test voor de periodekeuze. Deterministisch, geen IO.
// Draaien: npx tsx lib/period/__period_range_test.ts
//
// Een periodefilter is verraderlijk omdat een fout er niet uitziet als een fout: je krijgt
// gewoon getallen, alleen over de verkeerde maanden. De tests gaan daarom vooral over de
// grenzen — jaarovergangen, een periode van een maand, en of de vergelijkingsperiode
// werkelijk even lang is en nergens overlapt.

import {
  addMonths, monthCount, monthsIn, monthIndex, monthFromIndex, isValidMonth, normalizeRange,
  lastCompleteMonth, resolvePeriod, resolveComparison, overlaps, formatMonth, formatRange,
  comparisonWarning, PERIOD_PRESETS, COMPARISON_MODES,
  type PeriodRange,
} from "./period-range";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const toon = (p: PeriodRange | null) => (p ? `${p.start}..${p.end}` : "null");

// ── Maandrekenen ───────────────────────────────────────────────────────────

console.log("Maandrekenen");
check("heen en terug", monthFromIndex(monthIndex("2026-07")) === "2026-07");
check("over de jaargrens vooruit", addMonths("2026-12", 1) === "2027-01");
check("over de jaargrens terug", addMonths("2026-01", -1) === "2025-12");
check("een heel jaar", addMonths("2026-03", 12) === "2027-03");
check("meerdere jaren terug", addMonths("2026-03", -27) === "2023-12");
check("nul verschuiving", addMonths("2026-03", 0) === "2026-03");
// Schrikkeljaren en zomertijd bestaan op maandkorrel niet; dat is het hele punt van deze opzet.
check("februari in een schrikkeljaar is gewoon een maand", addMonths("2024-01", 1) === "2024-02");
check("en een maand verder", addMonths("2024-02", 1) === "2024-03");

check("maandtelling telt beide grenzen", monthCount({ start: "2026-01", end: "2026-03" }) === 3);
check("een enkele maand telt als een", monthCount({ start: "2026-05", end: "2026-05" }) === 1);
check("over de jaargrens", monthCount({ start: "2025-11", end: "2026-02" }) === 4);
check("monthsIn levert ze allemaal", monthsIn({ start: "2025-11", end: "2026-02" }).join(",") === "2025-11,2025-12,2026-01,2026-02");

check("geldige maand", isValidMonth("2026-07") && isValidMonth("2026-01") && isValidMonth("2026-12"));
check("ongeldige maand", !isValidMonth("2026-13") && !isValidMonth("2026-00") && !isValidMonth("2026-7") && !isValidMonth("") && !isValidMonth(null));

check("omgedraaide grenzen worden rechtgezet", toon(normalizeRange("2026-06", "2026-02")) === "2026-02..2026-06");
check("goede grenzen blijven staan", toon(normalizeRange("2026-02", "2026-06")) === "2026-02..2026-06");

// ── De lopende maand telt niet mee ─────────────────────────────────────────

console.log("\nDe laatste volledige maand");
check("in juli is dat juni", lastCompleteMonth("2026-07") === "2026-06");
check("in januari is dat december vorig jaar", lastCompleteMonth("2026-01") === "2025-12");

// ── De presets ─────────────────────────────────────────────────────────────

console.log("\nDe presets");
{
  const nu = "2026-07"; // laatste volledige maand is juni 2026
  check("3 maanden", toon(resolvePeriod("last_3m", null, nu)) === "2026-04..2026-06");
  check("6 maanden", toon(resolvePeriod("last_6m", null, nu)) === "2026-01..2026-06");
  check("12 maanden", toon(resolvePeriod("last_12m", null, nu)) === "2025-07..2026-06");
  check("dit jaar", toon(resolvePeriod("this_year", null, nu)) === "2026-01..2026-06");
  check("vorig jaar", toon(resolvePeriod("last_year", null, nu)) === "2025-01..2025-12");
}
// Elke preset levert exact het aantal maanden dat de naam belooft.
{
  const nu = "2026-07";
  check("3 maanden zijn er ook 3", monthCount(resolvePeriod("last_3m", null, nu)) === 3);
  check("6 maanden zijn er ook 6", monthCount(resolvePeriod("last_6m", null, nu)) === 6);
  check("12 maanden zijn er ook 12", monthCount(resolvePeriod("last_12m", null, nu)) === 12);
  check("vorig jaar is 12 maanden", monthCount(resolvePeriod("last_year", null, nu)) === 12);
}
// Over de jaargrens: in februari loopt de laatste 3 maanden terug tot in het vorige jaar.
{
  const nu = "2026-02"; // laatste volledige maand is januari 2026
  check("3 maanden over de jaargrens", toon(resolvePeriod("last_3m", null, nu)) === "2025-11..2026-01");
  check("12 maanden over de jaargrens", toon(resolvePeriod("last_12m", null, nu)) === "2025-02..2026-01");
}
// Januari is het lastige geval voor "dit jaar": er is nog geen volledige maand in dit jaar.
{
  const p = resolvePeriod("this_year", null, "2026-01");
  check("dit jaar in januari valt terug op december", toon(p) === "2025-12..2026-01", toon(p));
  check("en is nooit leeg", monthCount(p) >= 1);
}
// Aangepast, inclusief onzin-invoer.
check("aangepast wordt overgenomen", toon(resolvePeriod("custom", { start: "2025-03", end: "2025-09" }, "2026-07")) === "2025-03..2025-09");
check("aangepast met omgedraaide grenzen", toon(resolvePeriod("custom", { start: "2025-09", end: "2025-03" }, "2026-07")) === "2025-03..2025-09");
check("aangepast zonder waarde valt terug op 12 maanden", toon(resolvePeriod("custom", null, "2026-07")) === "2025-07..2026-06");
check("aangepast met onzin valt terug", toon(resolvePeriod("custom", { start: "onzin", end: "2026-13" }, "2026-07")) === "2025-07..2026-06");

// Geen enkele preset mag een omgekeerde of lege periode opleveren.
for (const preset of PERIOD_PRESETS) {
  for (const nu of ["2026-01", "2026-02", "2026-07", "2026-12", "2027-01"]) {
    const p = resolvePeriod(preset, { start: "2025-03", end: "2025-09" }, nu);
    check(`${preset} op ${nu} loopt vooruit`, monthIndex(p.start) <= monthIndex(p.end), toon(p));
    check(`${preset} op ${nu} is niet leeg`, monthCount(p) >= 1);
  }
}

// ── De vergelijkingsperiode ────────────────────────────────────────────────

console.log("\nDe vergelijking");
{
  const p: PeriodRange = { start: "2026-04", end: "2026-06" };
  check("geen vergelijking is null", resolveComparison(p, "none") === null);
  check("voorgaande periode sluit direct aan", toon(resolveComparison(p, "previous_period")) === "2026-01..2026-03");
  check("vorig jaar verschuift twaalf maanden", toon(resolveComparison(p, "same_period_last_year")) === "2025-04..2025-06");
}
// De belangrijkste invariant: de vergelijking is even lang. Ongelijke perioden vergelijken
// levert getallen op die nergens op slaan, en niets in de UI zou dat verraden.
for (const preset of PERIOD_PRESETS) {
  for (const mode of COMPARISON_MODES) {
    if (mode === "none") continue;
    const p = resolvePeriod(preset, { start: "2025-03", end: "2025-09" }, "2026-07");
    const c = resolveComparison(p, mode)!;
    check(`${preset} + ${mode}: even lang`, monthCount(p) === monthCount(c), `${toon(p)} tegen ${toon(c)}`);
    check(`${preset} + ${mode}: ligt in het verleden`, monthIndex(c.start) < monthIndex(p.start));
  }
}
// Voorgaande periode mag nooit overlappen, hoe lang de periode ook is.
for (const lengte of [1, 2, 3, 6, 12, 18, 24]) {
  const p: PeriodRange = { start: addMonths("2026-06", -(lengte - 1)), end: "2026-06" };
  const c = resolveComparison(p, "previous_period")!;
  check(`voorgaande periode van ${lengte} maanden overlapt niet`, !overlaps(p, c), `${toon(p)} tegen ${toon(c)}`);
  check(`en sluit er direct op aan`, addMonths(c.end, 1) === p.start);
}
// Vorig jaar overlapt wél zodra de periode langer is dan een jaar. Dat is geen fout maar een
// gevolg van de vraag, en het hoort zichtbaar te zijn.
{
  const kort: PeriodRange = { start: "2026-01", end: "2026-06" };
  check("vorig jaar overlapt niet bij zes maanden", !overlaps(kort, resolveComparison(kort, "same_period_last_year")!));
  const lang: PeriodRange = { start: "2025-01", end: "2026-06" };
  check("vorig jaar overlapt wel bij achttien maanden", overlaps(lang, resolveComparison(lang, "same_period_last_year")!));
  check("en dat wordt gemeld", (comparisonWarning(lang, "same_period_last_year") ?? "").includes("twee keer"));
  check("bij zes maanden geen melding", comparisonWarning(kort, "same_period_last_year") === null);
}
// De beurs-waarschuwing.
{
  const p: PeriodRange = { start: "2026-04", end: "2026-06" };
  const w = comparisonWarning(p, "previous_period", { jaarlijkseEditie: true });
  check("jaarlijkse editie waarschuwt bij voorgaande periode", (w ?? "").includes("vorig jaar"), String(w));
  check("en niet bij vorig jaar zelf", comparisonWarning(p, "same_period_last_year", { jaarlijkseEditie: true }) === null);
  check("en niet zonder editie-vlag", comparisonWarning(p, "previous_period") === null);
}

// ── Weergave ───────────────────────────────────────────────────────────────

console.log("\nWeergave");
check("een maand", formatMonth("2026-03") === "maart 2026");
check("kort", formatMonth("2026-03", true) === "maa 2026");
check("een periode", formatRange({ start: "2026-03", end: "2026-06" }) === "maart 2026 t/m juni 2026");
check("een enkele maand toont geen bereik", formatRange({ start: "2026-03", end: "2026-03" }) === "maart 2026");
check("onzin blijft onzin en crasht niet", formatMonth("kapot") === "kapot");

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
