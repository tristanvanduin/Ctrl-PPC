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
  comparisonWarning, vensterEindMaand, PERIOD_PRESETS, COMPARISON_MODES,
  type PeriodRange,
} from "./period-range";
import * as periodeRange from "./period-range";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PeriodProvider, usePeriod, type PeriodDataStand } from "./period-context";

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
// Hier stond eerder "2025-12..2026-01" als verwachting. Dat legde de fout vast in plaats van hem
// te vangen: normalizeRange draaide de omgekeerde grenzen om en haalde zo de LOPENDE maand
// binnen, de enige maand die elke andere preset juist weglaat. Het commentaar in resolvePeriod
// beloofde al "december van vorig jaar"; nu doet de code dat ook.
{
  const p = resolvePeriod("this_year", null, "2026-01");
  check("dit jaar in januari valt terug op december", toon(p) === "2025-12..2025-12", toon(p));
  check("en is nooit leeg", monthCount(p) >= 1);
  check("en bevat de lopende maand niet", p.end !== "2026-01" && p.start !== "2026-01", toon(p));
  const q = resolvePeriod("this_year", null, "2027-01");
  check("ook een jaar later", toon(q) === "2026-12..2026-12", toon(q));
  check("in februari is het gewoon januari", toon(resolvePeriod("this_year", null, "2026-02")) === "2026-01..2026-01");
}
// De invariant achter de hele module: geen preset (behalve "aangepast", waar de gebruiker zelf
// kiest) eindigt na de laatste volledige maand. Over de jaargrens, midden in het jaar en aan
// het eind; januari is waar het misging.
for (const preset of PERIOD_PRESETS) {
  if (preset === "custom") continue;
  for (const nu of ["2026-01", "2026-02", "2026-07", "2026-11", "2026-12", "2027-01"]) {
    const p = resolvePeriod(preset, null, nu);
    check(`${preset} op ${nu} bevat de lopende maand niet`,
      monthIndex(p.end) <= monthIndex(lastCompleteMonth(nu)), toon(p));
  }
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

// ── Waar de presets ophouden: de datastand ─────────────────────────────────
//
// De kalender alleen liet het venster doorlopen nadat de data stopte. Met data t/m 26 augustus
// liep "laatste 12 maanden" op 1 november t/m oktober, en telden september en oktober mee als
// maanden van nul.

console.log("\nDe eindmaand volgt de data");
check("zonder datastand de kalender", vensterEindMaand(null, "2026-11") === "2026-10");
check("ook zonder argument", vensterEindMaand(undefined, "2026-11") === "2026-10");
check("data t/m juli: eindigt op juli", vensterEindMaand("2026-07", "2026-11") === "2026-07");
check("nooit voorbij de kalender", vensterEindMaand("2026-11", "2026-11") === "2026-10");
check("ook niet bij een datastand uit de toekomst", vensterEindMaand("2027-03", "2026-11") === "2026-10");
check("onzin valt terug op de kalender", vensterEindMaand("2026-13", "2026-11") === "2026-10");
check("over de jaargrens", vensterEindMaand("2025-12", "2026-01") === "2025-12");
{
  // Zo rekent de provider: de maand na eindMaand als "nu".
  const viaStand = (preset: (typeof PERIOD_PRESETS)[number], stand: string | null, nu: string) =>
    resolvePeriod(preset, null, addMonths(vensterEindMaand(stand, nu), 1));
  check("12 maanden eindigen op de datastand", toon(viaStand("last_12m", "2026-07", "2026-11")) === "2025-08..2026-07",
    toon(viaStand("last_12m", "2026-07", "2026-11")));
  check("3 maanden ook", toon(viaStand("last_3m", "2026-07", "2026-11")) === "2026-05..2026-07");
  check("dit jaar loopt t/m de datastand", toon(viaStand("this_year", "2026-07", "2026-11")) === "2026-01..2026-07");
  check("zonder stand exact het oude gedrag",
    PERIOD_PRESETS.every((p) => toon(viaStand(p, null, "2026-11")) === toon(resolvePeriod(p, null, "2026-11"))));
  for (const nu of ["2026-01", "2026-02", "2026-07", "2026-11", "2026-12", "2027-01"]) {
    for (const stand of [null, "2025-06", "2026-07", "2026-12", "2027-06"]) {
      for (const preset of PERIOD_PRESETS) {
        if (preset === "custom") continue;
        const p = viaStand(preset, stand, nu);
        check(`${preset} op ${nu} met stand ${stand} blijft voor de lopende maand`,
          monthIndex(p.end) <= monthIndex(lastCompleteMonth(nu)), toon(p));
        check(`${preset} op ${nu} met stand ${stand} loopt vooruit`, monthIndex(p.start) <= monthIndex(p.end), toon(p));
      }
    }
  }
}

// Zo rekent de provider nu (periodeOpEind): wat hierboven via de maand na eindMaand ging, met twee
// gaten dicht.
// - Vorig jaar en dit jaar volgden het jaar van de DATA in plaats van de kalender: "nu" was de
//   maand na eindMaand, en daar las resolvePeriod het jaar uit. In januari 2027 met een stand t/m
//   november 2026 was "Vorig jaar" 2025; met data t/m 25 augustus 2026 was "Dit jaar" in 2027
//   januari-juli 2026. Nu op de kalender, met alleen het eind geklemd.
// - Een omgekeerde eigen periode (Van na Tot en met) ontliep de klem: die keek alleen naar het
//   eind, en pas resolvePeriod draaide de grenzen om. {2026-10, 2026-07} werd juli t/m oktober, met
//   september en oktober als nullen (de demo: -57,9% conversies waar -8,7% hoort).
console.log("\nDe periode op de eindmaand (periodeOpEind)");
{
  const { periodeOpEind } = periodeRange as Partial<typeof periodeRange>;
  check("periodeOpEind bestaat", typeof periodeOpEind === "function");
  if (typeof periodeOpEind === "function") {
    const op = (preset: (typeof PERIOD_PRESETS)[number], stand: string | null, nu: string, custom: PeriodRange | null = null) =>
      toon(periodeOpEind(preset, custom, vensterEindMaand(stand, nu), nu));
    check("vorig jaar in januari 2027, stand november 2026: 2026, t/m november", op("last_year", "2026-11", "2027-01") === "2026-01..2026-11", op("last_year", "2026-11", "2027-01"));
    check("vorig jaar in januari 2027, stand juli 2026: januari t/m juli 2026", op("last_year", "2026-07", "2027-01") === "2026-01..2026-07", op("last_year", "2026-07", "2027-01"));
    check("vorig jaar in november 2026 met een kanaal dat in september 2025 stopte: 2025 t/m september", op("last_year", "2025-09", "2026-11") === "2025-01..2025-09", op("last_year", "2025-09", "2026-11"));
    check("vorig jaar zonder data in dat jaar: alleen de laatste volle maand", op("last_year", "2024-06", "2026-11") === "2024-06..2024-06", op("last_year", "2024-06", "2026-11"));
    check("dit jaar in januari 2027 met data t/m juli 2026: niet januari-juli 2026", !op("this_year", "2026-07", "2027-01").startsWith("2026-01"), op("this_year", "2026-07", "2027-01"));
    check("dit jaar in november 2026, stand juli: januari t/m juli (zoals voorheen)", op("this_year", "2026-07", "2026-11") === "2026-01..2026-07");
    check("vorig jaar in november 2026, stand juli: heel 2025 (zoals voorheen)", op("last_year", "2026-07", "2026-11") === "2025-01..2025-12");
    check("12 maanden: zoals voorheen op de eindmaand", op("last_12m", "2026-07", "2026-11") === "2025-08..2026-07");
    check("omgekeerde eigen periode, eind binnen de data: geklemd", op("custom", "2026-07", "2026-11", { start: "2026-10", end: "2026-07" }) === "2026-07..2026-07",
      op("custom", "2026-07", "2026-11", { start: "2026-10", end: "2026-07" }));
    check("omgekeerd met een vroeg eind: maart t/m juli", op("custom", "2026-07", "2026-11", { start: "2026-10", end: "2026-03" }) === "2026-03..2026-07",
      op("custom", "2026-07", "2026-11", { start: "2026-10", end: "2026-03" }));
    check("een gewone eigen periode binnen de data blijft", op("custom", "2026-07", "2026-11", { start: "2026-01", end: "2026-06" }) === "2026-01..2026-06");
    check("zonder stand: elke preset exact als resolvePeriod", ["2026-01", "2026-11", "2027-01"].every((nu) =>
      PERIOD_PRESETS.every((p) => op(p, null, nu) === toon(resolvePeriod(p, null, nu)))));
    for (const nu of ["2026-01", "2026-02", "2026-07", "2026-11", "2026-12", "2027-01"]) {
      for (const stand of [null, "2024-06", "2025-06", "2026-07", "2026-11", "2026-12", "2027-06"]) {
        for (const preset of PERIOD_PRESETS) {
          const p = periodeOpEind(preset, { start: "2026-10", end: "2025-02" }, vensterEindMaand(stand, nu), nu);
          const eind = vensterEindMaand(stand, nu);
          if (!(monthIndex(p.start) <= monthIndex(p.end) && monthIndex(p.end) <= monthIndex(eind))) {
            check(`${preset} op ${nu} met stand ${stand}: binnen de data en vooruit`, false, toon(p));
          }
        }
      }
    }
  }
}

// De provider zelf, gerenderd zonder browser. Effecten draaien niet bij server-rendering, dus
// localStorage blijft buiten beeld en de standaardkeuze (12 maanden tegen vorig jaar) geldt.
console.log("\nDe provider");
{
  const lees = (dataStand?: PeriodDataStand | null) => {
    let gezien: ReturnType<typeof usePeriod> | null = null;
    const Kijker = () => { gezien = usePeriod(); return null; };
    renderToStaticMarkup(createElement(PeriodProvider, { scope: "test", dataStand, children: createElement(Kijker) }));
    return gezien as unknown as ReturnType<typeof usePeriod>;
  };
  const kalender = lastCompleteMonth();

  const zonder = lees();
  check("zonder datastand eindigt de periode op de kalender", zonder.eindMaand === kalender && zonder.range.end === kalender,
    `${zonder.eindMaand} / ${toon(zonder.range)}`);
  check("en is het dezelfde periode als voorheen", toon(zonder.range) === toon(resolvePeriod("last_12m")), toon(zonder.range));
  check("zonder datastand is dataStand null", zonder.dataStand === null);
  check("null is hetzelfde als weglaten", lees(null).eindMaand === kalender && lees(null).dataStand === null);

  const achter = addMonths(kalender, -3);
  const stand: PeriodDataStand = {
    laatsteVolleMaand: achter,
    partieel: { maand: addMonths(achter, 1), tmDag: 26, dagenInMaand: 31 },
    dataTot: `${addMonths(achter, 1)}-26`,
  };
  const met = lees(stand);
  check("met datastand eindigt de periode op de laatste volle maand met data", met.eindMaand === achter && met.range.end === achter,
    `${met.eindMaand} / ${toon(met.range)}`);
  check("nog steeds twaalf maanden", monthCount(met.range) === 12, toon(met.range));
  check("de vergelijking schuift mee", toon(met.compareRange) === toon(resolveComparison(met.range, "same_period_last_year")),
    toon(met.compareRange));
  check("de datastand komt door voor de melding", met.dataStand?.laatsteVolleMaand === achter
    && met.dataStand?.partieel?.tmDag === 26 && met.dataStand?.dataTot === stand.dataTot, JSON.stringify(met.dataStand));

  const vooruit = lees({ laatsteVolleMaand: addMonths(kalender, 2), partieel: null, dataTot: null });
  check("een datastand voorbij de kalender haalt de lopende maand niet binnen", vooruit.eindMaand === kalender
    && vooruit.range.end === kalender, `${vooruit.eindMaand} / ${toon(vooruit.range)}`);

  const leeg = lees({ laatsteVolleMaand: null, partieel: null, dataTot: null });
  check("een stand zonder volle maand valt terug op de kalender", leeg.eindMaand === kalender, leeg.eindMaand);
  check("maar wordt wel doorgegeven", leeg.dataStand !== null);
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
