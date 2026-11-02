// Test voor de brug tussen periodekeuze en datalaag. Deterministisch, geen IO.
// Draaien: npx tsx lib/period/__apply_period_test.ts
//
// Het gevaarlijke geval is een periode die verder terug ligt dan de geladen data. Stilzwijgend
// een kortere reeks teruggeven levert een trend over minder maanden dan gevraagd, en niets in
// de interface zou dat verraden. Daarom moet missing kloppen, niet alleen months.

import {
  flattenMonths, slicePeriod, comparePeriods, delta, gepaardeTotalen, alsBronReeks, ontbrekendeMaanden,
  type BronReeks, type Totalen,
} from "./apply-period";
import { resolvePeriod, resolveComparison, monthIndex, PERIOD_PRESETS, COMPARISON_MODES } from "./period-range";
import type { ClientHistoricalData, MonthlyRecord } from "../types";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const m = (month: number, conv: number, rev: number, spend: number): MonthlyRecord =>
  ({ month, conversions: conv, revenue: rev, adSpend: spend, weeks: [] });

// 2025 volledig, 2026 tot en met juni (juli t/m december nog niet gerealiseerd).
const data: ClientHistoricalData = {
  clientId: "demo",
  targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
  historicalYears: {
    2024: Array.from({ length: 12 }, (_, i) => m(i + 1, 10, 100, 50)),
    2025: Array.from({ length: 12 }, (_, i) => m(i + 1, 20, 200, 100)),
  },
  currentYearData: [
    ...Array.from({ length: 6 }, (_, i) => m(i + 1, 30, 300, 150)),
    ...Array(6).fill(null),
  ],
  currentYear: 2026,
} as ClientHistoricalData;

console.log("Afvlakken tot een doorlopende reeks");
{
  const alle = flattenMonths(data);
  check("twee volle jaren plus zes maanden", alle.length === 30, String(alle.length));
  check("oplopend gesorteerd", alle.every((x, i) => i === 0 || alle[i - 1].key <= x.key));
  check("eerste is januari 2024", alle[0].key === "2024-01");
  check("laatste is juni 2026", alle[alle.length - 1].key === "2026-06");
  // Niet-gerealiseerde maanden vallen weg in plaats van als nul mee te tellen: een lege
  // toekomstige maand zou elk gemiddelde en elke trend omlaag trekken.
  check("lege toekomstmaanden zitten er niet in", !alle.some((x) => x.key > "2026-06"));
}
// Staat het huidige jaar ook in historicalYears, dan wint de verse kant.
{
  const dubbel: ClientHistoricalData = {
    ...data,
    historicalYears: { ...data.historicalYears, 2026: [m(1, 999, 999, 999)] },
  };
  const jan = flattenMonths(dubbel).find((x) => x.key === "2026-01");
  check("currentYearData wint van historicalYears", jan?.conversions === 30, String(jan?.conversions));
  check("en de maand staat er maar een keer in",
    flattenMonths(dubbel).filter((x) => x.key === "2026-01").length === 1);
}

console.log("\nEen periode snijden");
{
  const s = slicePeriod(data, { start: "2026-01", end: "2026-06" });
  check("zes maanden", s.months.length === 6);
  check("niets ontbreekt", s.missing.length === 0);
  check("conversies tellen op", s.totals.conversions === 180);
  check("besteding telt op", s.totals.adSpend === 900);
}
// Dwars door de jaargrens: november 2025 tot en met februari 2026.
{
  const s = slicePeriod(data, { start: "2025-11", end: "2026-02" });
  check("vier maanden over de jaargrens", s.months.length === 4, s.months.map((x) => x.key).join(","));
  check("de volgorde blijft oplopend", s.months.map((x) => x.key).join(",") === "2025-11,2025-12,2026-01,2026-02");
  check("twee maanden a 20 plus twee a 30", s.totals.conversions === 100, String(s.totals.conversions));
}
// Het gevaarlijke geval: een periode die deels buiten de geladen data valt.
{
  const s = slicePeriod(data, { start: "2023-10", end: "2024-03" });
  check("alleen de bestaande maanden komen terug", s.months.length === 3, s.months.map((x) => x.key).join(","));
  check("en de ontbrekende worden gemeld", s.missing.join(",") === "2023-10,2023-11,2023-12", s.missing.join(","));
}
{
  const s = slicePeriod(data, { start: "2026-07", end: "2026-09" });
  check("een periode volledig in de toekomst is leeg", s.months.length === 0);
  check("met alle maanden als ontbrekend", s.missing.length === 3);
  check("en totalen op nul, niet NaN", s.totals.conversions === 0 && Number.isFinite(s.totals.revenue));
}
{
  const s = slicePeriod(data, { start: "2026-03", end: "2026-03" });
  check("een enkele maand werkt", s.months.length === 1 && s.months[0].key === "2026-03");
}

console.log("\nVergelijken");
{
  const r = comparePeriods(data, { start: "2026-01", end: "2026-06" }, { start: "2025-01", end: "2025-06" });
  check("huidige periode", r.current.totals.conversions === 180);
  check("vorige periode", r.previous?.totals.conversions === 120);
  check("de verandering klopt", Math.abs((r.deltas?.conversions.pct ?? 0) - 50) < 1e-9, String(r.deltas?.conversions.pct));
  check("omzet ook", Math.abs((r.deltas?.revenue.pct ?? 0) - 50) < 1e-9);
}
{
  const r = comparePeriods(data, { start: "2026-01", end: "2026-06" }, null);
  check("zonder vergelijking geen deltas", r.deltas === null && r.previous === null);
}
// Van niets naar iets is geen percentage.
check("nul als basis geeft null en geen Infinity", delta(100, 0).pct === null);
check("nul naar nul geeft ook null", delta(0, 0).pct === null);
check("een gewone daling", Math.abs((delta(50, 100).pct ?? 0) + 50) < 1e-9);
check("geen verandering is 0 procent", delta(100, 100).pct === 0);
check("de ruwe getallen blijven staan", delta(100, 0).huidig === 100 && delta(100, 0).vorig === 0);

// ── Gepaard vergelijken ────────────────────────────────────────────────────
//
// De vergelijking telde de volle totalen van beide perioden tegen elkaar, ongeacht of een bron
// aan beide kanten bestond. Op de demo kwamen Meta en LinkedIn er in maart 2026 bij, en de band
// toonde "+89%" kosten tegen een vorig jaar met alleen Google. De regel nu: per bron telt een
// maandpaar pas mee als beide maanden op of na de start van die bron liggen, en binnen die
// dekking is een ontbrekende maand een echte nul.

console.log("\nGepaard vergelijken");

// Een kanaal als ClientHistoricalData, zoals use-channel-period-data het per kanaal bouwt.
const kanaal = (hist: Record<number, (MonthlyRecord | null)[]>, cur: (MonthlyRecord | null)[]): ClientHistoricalData =>
  ({ clientId: "t", targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    historicalYears: hist, currentYearData: cur, currentYear: 2026 } as ClientHistoricalData);
const jaar = (n: number, maak: (maand: number) => MonthlyRecord | null) => Array.from({ length: n }, (_, i) => maak(i + 1));
const leegRest = (n: number) => Array(12 - n).fill(null);

// De demovorm: Google elke maand (100 kosten, 10 conversies), Meta pas vanaf maart 2026.
const google = kanaal(
  { 2025: jaar(12, (k) => m(k, 10, 100, 100)) },
  [...jaar(6, (k) => m(k, 10, 100, 100)), ...leegRest(6)],
);
const meta = kanaal({}, [null, null, ...jaar(4, (k) => m(k + 2, 10, 100, 100)), ...leegRest(6)]);
// De optelling zoals samenvoegen() in lib/use-channel-period-data.ts hem maakt.
const blended = kanaal(
  { 2025: jaar(12, (k) => m(k, 10, 100, 100)) },
  [m(1, 10, 100, 100), m(2, 10, 100, 100), ...jaar(4, (k) => m(k + 2, 20, 200, 200)), ...leegRest(6)],
);
const H1: { start: string; end: string } = { start: "2026-01", end: "2026-06" };
const H1_VJ = { start: "2025-01", end: "2025-06" };
{
  const r = comparePeriods(blended, H1, H1_VJ, [alsBronReeks("google", google), alsBronReeks("meta", meta)]);
  check("de getallen in beeld blijven de volle optelling",
    r.current.totals.adSpend === 1000 && r.previous?.totals.adSpend === 600,
    `${r.current.totals.adSpend} / ${r.previous?.totals.adSpend}`);
  // Oud: 1000 tegen 600 = +66,7%. Alleen Google bestond in beide perioden, en die bleef gelijk.
  check("de kosten-delta gaat alleen over de Google-paren: 0%, niet +67%", r.deltas?.adSpend.pct === 0,
    String(r.deltas?.adSpend.pct));
  check("de conversie-delta ook", r.deltas?.conversions.pct === 0, String(r.deltas?.conversions.pct));
  check("de delta toont de gepaarde bedragen", r.deltas?.adSpend.huidig === 600 && r.deltas?.adSpend.vorig === 600,
    `${r.deltas?.adSpend.huidig} / ${r.deltas?.adSpend.vorig}`);
  check("vier Meta-maanden vallen erbuiten, en dat wordt gemeld",
    r.ongepaard?.huidig === 4 && r.ongepaard?.vorig === 0, JSON.stringify(r.ongepaard));
  const g = r.perBron?.find((b) => b.naam === "google");
  const mt = r.perBron?.find((b) => b.naam === "meta");
  check("Google: zes paren", g?.gepaard === 6 && g?.start === "2025-01" && g?.ongepaardHuidig === 0, JSON.stringify(g));
  check("Meta zonder vorig-jaar-data: nul paren", mt?.gepaard === 0, JSON.stringify(mt));
  check("met maart 2026 als start en vier ongepaarde maanden", mt?.start === "2026-03" && mt?.ongepaardHuidig === 4
    && mt?.ongepaardVorig === 0, JSON.stringify(mt));
}
{
  // Een kanaal dat alleen dit jaar bestaat, los bekeken: geen basis, dus geen percentage.
  const r = comparePeriods(meta, H1, H1_VJ);
  check("een kanaal zonder enige vorig-jaar-data: gepaard 0", r.perBron?.[0]?.gepaard === 0, JSON.stringify(r.perBron));
  check("en geen percentage", r.deltas?.adSpend.pct === null, String(r.deltas?.adSpend.pct));
  check("en het totaal in beeld staat er gewoon", r.current.totals.adSpend === 400);
  const r2 = comparePeriods(meta, { start: "2026-03", end: "2026-06" }, { start: "2025-11", end: "2026-02" });
  check("vier maanden tegen een periode van voor de start: geen percentage", r2.deltas?.adSpend.pct === null,
    String(r2.deltas?.adSpend.pct));
}

// Een gat midden in de dekking is een echte nul (gepauzeerd), geen ontbrekend paar.
{
  // Meta vanaf februari 2025, april 2025 ontbreekt (gepauzeerd), daarna elke maand.
  const metaMetGat = kanaal(
    { 2025: [null, ...jaar(11, (k) => (k + 1 === 4 ? null : m(k + 1, 10, 100, 100)))] },
    [...jaar(6, (k) => m(k, 10, 100, 100)), ...leegRest(6)],
  );
  const r = comparePeriods(metaMetGat, H1, H1_VJ);
  // Januari 2025 ligt voor de start: dat paar valt weg. Februari t/m juni tellen, april 2025 als 0.
  // Oud: 600 tegen 400 = +50%. Zonder de nulregel (alleen paren met data aan beide kanten): 0%.
  check("het gat telt als 0: 500 tegen 400 is +25%", r.deltas?.adSpend.pct === 25, String(r.deltas?.adSpend.pct));
  check("vijf paren, waarvan het gat er een is", r.perBron?.[0]?.gepaard === 5, JSON.stringify(r.perBron));
  check("januari 2026 heeft geen tegenhanger van na de start", r.ongepaard?.huidig === 1 && r.ongepaard?.vorig === 0,
    JSON.stringify(r.ongepaard));
}
{
  // Zelfde gat, maar in het huidige venster: februari 2026 gepauzeerd.
  const googleMetGat = kanaal(
    { 2025: jaar(12, (k) => m(k, 10, 100, 100)) },
    [m(1, 10, 100, 100), null, ...jaar(4, (k) => m(k + 2, 10, 100, 100)), ...leegRest(6)],
  );
  const r = comparePeriods(googleMetGat, H1, H1_VJ);
  check("een pauze dit jaar telt als daling: 500 tegen 600", r.deltas?.adSpend.huidig === 500 && r.deltas?.adSpend.vorig === 600,
    `${r.deltas?.adSpend.huidig} / ${r.deltas?.adSpend.vorig}`);
  check("en het paar telt mee", r.perBron?.[0]?.gepaard === 6 && r.ongepaard?.vorig === 0, JSON.stringify(r.perBron));
}

// De adapter vult een historisch jaar zonder data aan met nulmaanden. Die zijn geen start: een
// klant die in juni 2025 begon, mag januari t/m mei 2025 niet als "echt nul" vergelijken.
{
  const laatStarter = kanaal(
    { 2025: jaar(12, (k) => (k < 6 ? m(k, 0, 0, 0) : m(k, 10, 100, 100))) },
    [...jaar(6, (k) => m(k, 10, 100, 100)), ...leegRest(6)],
  );
  const r = comparePeriods(laatStarter, H1, H1_VJ);
  // Oud: 600 tegen 100 = +500%.
  check("nulmaanden van de adapter tellen niet als start", r.perBron?.[0]?.start === "2025-06", JSON.stringify(r.perBron));
  check("alleen juni tegen juni: 0%", r.deltas?.adSpend.pct === 0, String(r.deltas?.adSpend.pct));
  check("januari t/m mei 2026 vallen erbuiten", r.ongepaard?.huidig === 5, JSON.stringify(r.ongepaard));
}

// Eén bron met een volledige historie: precies de oude delta, voor elke preset en vergelijking.
{
  const oud = (p: { start: string; end: string }, c: { start: string; end: string }) => {
    const a = slicePeriod(data, p).totals, b = slicePeriod(data, c).totals;
    return [delta(a.conversions, b.conversions), delta(a.revenue, b.revenue), delta(a.adSpend, b.adSpend)];
  };
  const vensters: Array<[{ start: string; end: string }, { start: string; end: string }]> = [
    [H1, H1_VJ],
    [{ start: "2025-07", end: "2026-06" }, { start: "2024-07", end: "2025-06" }],
    [{ start: "2025-01", end: "2025-12" }, { start: "2024-01", end: "2024-12" }],
    [H1, { start: "2025-07", end: "2025-12" }],
    // Voorbij het eind van de data: dat lost het venster op, niet de paring, dus ook dit blijft gelijk.
    [{ start: "2026-04", end: "2026-09" }, { start: "2025-04", end: "2025-09" }],
  ];
  for (const nu of ["2026-07", "2026-04"]) {
    for (const preset of PERIOD_PRESETS) {
      for (const mode of COMPARISON_MODES) {
        const p = resolvePeriod(preset, { start: "2025-03", end: "2025-09" }, nu);
        const c = resolveComparison(p, mode);
        if (c && monthIndex(c.start) >= monthIndex("2024-01")) vensters.push([p, c]);
      }
    }
  }
  let gelijk = 0;
  for (const [p, c] of vensters) {
    const r = comparePeriods(data, p, c);
    const nieuw = [r.deltas!.conversions, r.deltas!.revenue, r.deltas!.adSpend];
    const o = oud(p, c);
    const ok = nieuw.every((d, i) => d.pct === o[i].pct && d.huidig === o[i].huidig && d.vorig === o[i].vorig);
    check(`één bron, volledige historie: ${p.start}..${p.end} tegen ${c.start}..${c.end} gelijk aan de oude delta`, ok,
      JSON.stringify({ nieuw, oud: o }));
    if (ok) gelijk += 1;
    const metBron = comparePeriods(data, p, c, [alsBronReeks("totaal", data)]);
    check("en de bron expliciet meegeven verandert niets", JSON.stringify(metBron.deltas) === JSON.stringify(r.deltas));
  }
  check("er zijn genoeg vensters getoetst", gelijk >= 10, String(gelijk));
}

// De kale functie, zoals een server-route of de pacing hem aanroept.
{
  const reeks = (naam: string, rijen: Array<[string, number]>): BronReeks =>
    ({ naam, maanden: new Map(rijen.map(([k, kosten]): [string, Totalen] => [k, { conversions: 1, revenue: 0, adSpend: kosten }])) });
  const g = reeks("google", [["2025-01", 10], ["2025-02", 10], ["2025-03", 10], ["2026-01", 20], ["2026-02", 20], ["2026-03", 20]]);
  const leeg = reeks("microsoft", []);
  const r = gepaardeTotalen([g, leeg], { start: "2026-01", end: "2026-03" }, { start: "2025-02", end: "2025-03" });
  // Ongelijke lengte: het derde paar heeft geen vergelijkingsmaand; maart 2026 telt als ongepaard.
  check("bij ongelijke lengte telt het overschot als ongepaard", r.ongepaard.huidig === 1 && r.perBron[0].gepaard === 2,
    JSON.stringify(r));
  check("en de paren zijn 40 tegen 20", r.huidig.adSpend === 40 && r.vorig.adSpend === 20, JSON.stringify(r));
  check("een bron zonder rijen heeft geen start en geen paren", r.perBron[1].start === null && r.perBron[1].gepaard === 0
    && r.perBron[1].ongepaardHuidig === 0, JSON.stringify(r.perBron[1]));
  check("de volgorde van perBron is die van de bronnen", r.perBron.map((b) => b.naam).join(",") === "google,microsoft");
}
{
  const r = comparePeriods(data, H1, null);
  check("zonder vergelijking niets ongepaard en geen bronnen",
    r.ongepaard.huidig === 0 && r.ongepaard.vorig === 0 && r.perBron.length === 0);
}

// Welke maanden het percentage ECHT vergelijkt. Een paar telt pas als ook de vergelijkingsmaand op
// of na de start ligt, dus vallen ook maanden van de gekozen periode NA de start weg. De band zei
// "het percentage telt alleen maanden vanaf september 2024 in beide perioden", terwijl augustus 2025
// niet meetelde: het teken van de demo draaide om (-6,9% tegen +4,0% voor wat de zin beschreef).
console.log("\nHet bereik van de paren per bron");
{
  const reeks = (naam: string, van: string, tot: string): BronReeks => {
    const maanden = new Map<string, Totalen>();
    for (let k = van; monthIndex(k) <= monthIndex(tot); k = `${Number(k.slice(0, 4)) + (k.endsWith("-12") ? 1 : 0)}-${String((Number(k.slice(5)) % 12) + 1).padStart(2, "0")}`) {
      maanden.set(k, { conversions: 1, revenue: 0, adSpend: 10 });
    }
    return { naam, maanden };
  };
  const g = reeks("google", "2024-09", "2026-07");
  const r = gepaardeTotalen([g], { start: "2025-08", end: "2026-07" }, { start: "2024-08", end: "2025-07" });
  const b = r.perBron[0] as typeof r.perBron[0] & { bereik?: { huidig: { start: string; end: string }; vorig: { start: string; end: string } } | null };
  check("de demo-vorm: september 2025 t/m juli 2026 tegen september 2024 t/m juli 2025",
    b.bereik?.huidig.start === "2025-09" && b.bereik?.huidig.end === "2026-07" && b.bereik?.vorig.start === "2024-09" && b.bereik?.vorig.end === "2025-07",
    JSON.stringify(b.bereik));
  // Meta op de demo, laatste 3 maanden tegen de voorgaande: eerste volle maand april 2026.
  const meta = { ...reeks("meta", "2026-03", "2026-07"), vanaf: "2026-04" };
  const kort = gepaardeTotalen([meta], { start: "2026-05", end: "2026-07" }, { start: "2026-02", end: "2026-04" });
  const km = kort.perBron[0] as typeof b;
  check("alleen juli tegen april, niet mei en juni", km.bereik?.huidig.start === "2026-07" && km.bereik?.huidig.end === "2026-07"
    && km.bereik?.vorig.start === "2026-04" && km.bereik?.vorig.end === "2026-04", JSON.stringify(km.bereik));
  const niets = gepaardeTotalen([meta], { start: "2025-05", end: "2025-07" }, { start: "2025-02", end: "2025-04" });
  check("geen enkel paar: geen bereik", (niets.perBron[0] as typeof b).bereik === null, JSON.stringify(niets.perBron[0]));
}

// Ontbrekende maanden vóór de start. Was het kanaal toen al geladen (de band laadt 36 maanden), dan
// is zo'n maand geen laadprobleem maar "nog geen data". De band zei op de demo-Meta-tab "Voor 7
// maanden is geen data geladen (aug 2025 t/m feb 2026)", terwijl die maanden wel geladen waren.
console.log("\nOntbrekende maanden vóór de start");
{
  // Via een losse signatuur: op de oude code bestaan de vierde parameter en voorStart niet, en dan
  // moet de test per geval falen in plaats van op de typen.
  const ontbrekend = ontbrekendeMaanden as unknown as (d: ClientHistoricalData, missing: readonly string[], dataTot?: string | null, geladenVanaf?: string | null) =>
    { nietGeladen: string[]; gemetenNul: string[]; voorStart?: string[]; start?: string | null };
  // Data vanaf april 2026; gevraagd januari t/m juni 2026, dus januari t/m maart ontbreken.
  const vanApril: ClientHistoricalData = { ...data, historicalYears: {},
    currentYearData: [null, null, null, ...Array.from({ length: 3 }, (_, i) => m(i + 4, 30, 300, 150)), ...Array(6).fill(null)] } as ClientHistoricalData;
  const gevraagd = ["2026-01", "2026-02", "2026-03"];
  const zonder = ontbrekend(vanApril, gevraagd, null);
  check("zonder laadgrens: niet geladen, zoals voorheen", zonder.nietGeladen.join() === gevraagd.join() && (zonder.voorStart ?? []).length === 0, JSON.stringify(zonder));
  const geladen = ontbrekend(vanApril, gevraagd, null, "2023-11");
  check("geladen vanaf 2023-11: vóór de start, niet 'niet geladen'",
    geladen.nietGeladen.length === 0 && (geladen.voorStart ?? []).join() === gevraagd.join() && geladen.start === "2026-04", JSON.stringify(geladen));
  const deels = ontbrekend(vanApril, gevraagd, null, "2026-02");
  check("geladen vanaf februari: januari niet geladen, februari en maart vóór de start",
    deels.nietGeladen.join() === "2026-01" && (deels.voorStart ?? []).join() === "2026-02,2026-03", JSON.stringify(deels));
  const na = ontbrekend(vanApril, ["2026-07"], "2026-06-30", "2023-11");
  check("na het eind van de data blijft het 'niet geladen' (nog niet binnen)", na.nietGeladen.join() === "2026-07" && (na.voorStart ?? []).length === 0, JSON.stringify(na));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
