// Regressietest: wat de beursaftelling en de pacingkop op het scherm zetten.
// Draai met: tsx lib/fair/__aftelling_weergave_test.ts
//
// __fair_countdown_test.ts bewaakt de rekenkern (weeksToFair, fairCountdown, toFairWeeks). Dit
// bestand kijkt naar de plekken die hem tonen: de hero-chip (brand-header-bar.tsx), de kop van de
// pacingkaarten (pacing-monitor.tsx, channel-pacing.tsx) en de beurssectie
// (fair-weeks-overview.tsx). Waar het kan wordt de component echt gerenderd (react-dom/server);
// ChannelPacing en PacingMonitor zelf hangen aan een dataprovider, daar dekt een bronbewaking af
// dat ze de gedeelde stukken gebruiken die hier wél gerenderd worden.
//
// Wat er misging:
//   - In de beursweek stond er "0 weken tot ...", en sinds de editie na afloop actief blijft ook op
//     de dagen ná een woensdagbeurs.
//   - De kop van de beurssectie nam de afstand vanaf de week waar de strook op staat; buiten
//     data.currentYear is dat een vastgeklemde week, en dan klopte het getal niet.
//   - ROAS en CPA werden in een maand waar de weekemmers niet op de maandagen pasten opgeteld en
//     gedeeld, als hele getallen.
//   - Een week zonder realisatie en zonder prognose stond er als "Prognose 0".
//   - De pacingkaart telde de dagen van het jaar met de browserklok en deelde door 365.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// Als namespace: tegen een versie zonder deze exports levert dat een FAIL-regel op in plaats van
// een crash bij het laden.
import * as hero from "../../components/branding/brand-header-bar";
import * as pacing from "../../components/dashboard/pacing-monitor";
import * as beurs from "../../components/dashboard/fair-weeks-overview";
import { addDays, today } from "../reporting-date";
import { computeForecast, deriveForecast, type ClientForecast, type ForecastMetric, type WeeklyPoint } from "../forecast";
import { mondaysInMonth, type UpcomingEdition } from "./fair-weeks";
import type { ClientHistoricalData, MonthlyRecord } from "../types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

/** De zichtbare tekst: tags weg, React's tekstscheidingen weg, witruimte samengevouwen. */
function tekst(el: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(el)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ :/g, ":")
    .trim();
}
const render = <P extends object>(c: unknown, props: P) =>
  typeof c === "function" ? tekst(createElement(c as ComponentType<P>, props)) : null;

// Het label is in de praktijk een jaartal: editieLabel valt terug op het jaar van de datum, en de
// demo zaait `${year}`. Hier stond "GRN 2026", en daarmee las de pacingkop als een zin met een
// naam erin, terwijl hij op het scherm "Nog 32 weken tot 2027" zei (2027 is negen weken weg).
function editie(fairDate: string, label = "2026"): UpcomingEdition {
  return {
    eventId: "grn", eventName: "GreenTech North America", abbrev: "GRN", fairDate, label,
    afgeleid: false, cadence: null, previousFairDate: null, previousLabel: null,
  };
}

const VANDAAG = today();
const bron = (pad: string) => readFileSync(join(__dirname, "..", "..", pad), "utf8");

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. De hero-chip. Gerenderd tegen de echte klok, met beursdata relatief aan vandaag, zodat het
//    resultaat niet afhangt van de dag waarop de test draait.
// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("hero-chip (brand-header-bar.tsx)");
{
  const inBeursweek = render(hero.BrandHeaderBar, { edition: editie(VANDAAG) }) ?? "";
  assert(inBeursweek.includes("Beursweek"), `beurs vandaag: de chip zegt "Beursweek" (kreeg: "${inBeursweek}")`);
  assert(!inBeursweek.includes("0 weken"), "beurs vandaag: geen \"0 weken\"");
  const overTwee = render(hero.BrandHeaderBar, { edition: editie(addDays(VANDAAG, 14)) }) ?? "";
  assert(overTwee.includes("2 weken tot GreenTech North America 2026"), `over twee weken: "2 weken tot ..." (kreeg: "${overTwee}")`);
  const voorbij = render(hero.BrandHeaderBar, { edition: editie(addDays(VANDAAG, -14)) }) ?? "";
  assert(!voorbij.includes("weken") && !voorbij.includes("Beursweek"), "twee weken na de beurs: geen chip");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. De kop van de pacingkaarten (BeursAftelling, gedeeld door PacingMonitor en ChannelPacing).
//    Vaste data: GRN op woensdag 4 november 2026.
// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("pacingkop (BeursAftelling in pacing-monitor.tsx)");
{
  assert(typeof pacing.BeursAftelling === "function", "pacing-monitor.tsx exporteert BeursAftelling");
  const kop = (vandaag: string) => render(pacing.BeursAftelling, { edition: editie("2026-11-04"), vandaag });
  assert(kop("2026-10-14") === "Nog 3 weken tot GRN 2026 ·", `wo 14 okt: "Nog 3 weken tot GRN 2026 ·" (kreeg: "${kop("2026-10-14")}")`);
  assert(kop("2026-11-01") === "Nog 1 week tot GRN 2026 ·", "zo 1 nov: nog 1 week (kalenderweek, zoals de strook)");
  assert(kop("2026-11-02") === "Beursweek GRN 2026 ·", "ma 2 nov: Beursweek");
  assert(kop("2026-11-05") === "Beursweek GRN 2026 ·", "do 5 nov, de dag na de beurs: nog steeds Beursweek, geen \"0 weken\"");
  assert(kop("2026-11-09") === "", "ma 9 nov (nasleep): niets in de kop");
  assert(render(pacing.BeursAftelling, { edition: null, vandaag: "2026-11-01" }) === "", "zonder beurs: niets");
  // Een editie die verder weg ligt dan het jaartal doet vermoeden: de naam staat erbij.
  const grt = render(pacing.BeursAftelling, { edition: { ...editie("2027-06-10", "2027"), abbrev: "GRT" }, vandaag: "2026-11-01" });
  assert(grt === "Nog 32 weken tot GRT 2027 ·", `GRT juni 2027: "Nog 32 weken tot GRT 2027 ·", niet "tot 2027" (kreeg: "${grt}")`);
  // Zonder afkorting de eventnaam; staat de naam al in het label, dan niet dubbel.
  const zonderAfk = render(pacing.BeursAftelling, { edition: { ...editie("2026-11-04"), abbrev: "" }, vandaag: "2026-10-14" });
  assert(zonderAfk === "Nog 3 weken tot GreenTech North America 2026 ·", `zonder afkorting: de eventnaam (kreeg: "${zonderAfk}")`);
  const alInLabel = render(pacing.BeursAftelling, { edition: editie("2026-11-04", "GRN 2026"), vandaag: "2026-10-14" });
  assert(alInLabel === "Nog 3 weken tot GRN 2026 ·", `label met de afkorting erin: niet "GRN GRN 2026" (kreeg: "${alInLabel}")`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. Het jaarverloop van de pacingkaart: t/m de laatste gerealiseerde maand, echte jaarlengte.
// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("jaarverloop (gerealiseerdeJaardagen in pacing-monitor.tsx)");
{
  const f = pacing.gerealiseerdeJaardagen as undefined | ((j: number, m: number) => { dagen: number; dagenInJaar: number });
  assert(typeof f === "function", "pacing-monitor.tsx exporteert gerealiseerdeJaardagen");
  if (typeof f === "function") {
    const okt = f(2026, 10);
    assert(okt.dagen === 304 && okt.dagenInJaar === 365, `t/m oktober 2026: dag 304 van 365 (kreeg ${okt.dagen}/${okt.dagenInJaar})`);
    const sep = f(2026, 9);
    assert(sep.dagen === 273, "t/m september 2026: 273 dagen, niet de 304 die de klok op 31 oktober gaf");
    const schrikkel = f(2028, 2);
    assert(schrikkel.dagen === 60 && schrikkel.dagenInJaar === 366, "t/m februari 2028: dag 60 van 366");
    const niets = f(2026, 0);
    assert(niets.dagen === 0 && niets.dagenInJaar === 365, "nog geen gerealiseerde maand: dag 0");
    const heel = f(2026, 12);
    assert(heel.dagen === 365 && heel.dagenInJaar === 365, "t/m december: het hele jaar");
  }
  // Het TEMPO loopt niet vanaf 1 januari maar vanaf de eerste maand met een rij: een account dat
  // in maart begon heeft in januari en februari niets gemeten, en die dagen erbij delen gaf een
  // tempo dat 28% te laag stond (en een "seizoensduiding" op een volkomen vlakke reeks).
  const g = pacing.actieveJaardagen as undefined | ((j: number, m: number, reeks: readonly unknown[]) => number);
  assert(typeof g === "function", "pacing-monitor.tsx exporteert actieveJaardagen");
  if (typeof g === "function") {
    const reeks = (vanaf: number, tot: number) => Array.from({ length: 12 }, (_, i) => (i >= vanaf && i <= tot ? {} : null));
    assert(g(2026, 7, reeks(2, 6)) === 153, `vanaf maart t/m juli 2026: 153 dagen (kreeg ${g(2026, 7, reeks(2, 6))})`);
    assert(g(2026, 7, reeks(0, 6)) === 212, "vanaf januari: hetzelfde als gerealiseerdeJaardagen (212)");
    assert(g(2026, 7, reeks(2, 6).map((r, i) => (i === 4 ? null : r))) === 153,
      "een gat binnen de reeks blijft in de deler: gepauzeerd is een echte nul");
    assert(g(2026, 0, reeks(0, -1)) === 0, "nog niets gerealiseerd: 0 dagen");
    assert(g(2026, 7, reeks(0, -1)) === 212, "geen enkele rij: vanaf 1 januari, zoals voorheen");
  }
  // Het tempo zelf, als gedrag: hier stond alleen een broncontrole op de naam van de deler
  // (`/ tempoDagen`), en die bleef groen toen de deler zelf weer Math.max(dayOfYear, 1) werd.
  // Een account vanaf maart met 60 per maand, t/m juli: 300 over 153 dagen, niet over 212.
  const t = (pacing as { pacingTempo?: (jaar: number, f: ReturnType<typeof computeForecast>) => { dagen: number; conversiesPerDag: number; spendPerDag: number } }).pacingTempo;
  assert(typeof t === "function", "pacing-monitor.tsx exporteert pacingTempo");
  if (typeof t === "function") {
    const rec = (month: number, c: number) => ({ month, conversions: c, revenue: c * 100, adSpend: c * 40, weeks: [] });
    const vanafMaart = computeForecast({
      clientId: "t", currentYear: 2026, targetCurrentYear: { conversions: 700, revenue: 70_000, adSpend: 28_000 },
      historicalYears: { 2025: Array.from({ length: 12 }, (_, i) => rec(i + 1, 50)) },
      currentYearData: Array.from({ length: 12 }, (_, i) => (i >= 2 && i <= 6 ? rec(i + 1, 60) : null)),
    });
    const tempo = t(2026, vanafMaart);
    assert(tempo.dagen === 153 && Math.abs(tempo.conversiesPerDag - 300 / 153) < 1e-9 && Math.abs(tempo.spendPerDag - 12_000 / 153) < 1e-9,
      `vanaf maart: 300 conversies over 153 dagen (kreeg ${JSON.stringify(tempo)})`);
    const leeg = t(2027, computeForecast({ clientId: "t", currentYear: 2027, targetCurrentYear: { conversions: 700, revenue: 0, adSpend: 0 }, historicalYears: {}, currentYearData: Array(12).fill(null) }));
    assert(leeg.dagen === 1 && leeg.conversiesPerDag === 0, `nog niets gerealiseerd: minstens één dag, tempo 0 (kreeg ${JSON.stringify(leeg)})`);
  }
  const pm = bron("components/dashboard/pacing-monitor.tsx");
  assert(/=\s*pacingTempo\(data\.currentYear,\s*forecast\)/.test(pm),
    "pacing-monitor.tsx haalt het tempo uit pacingTempo, met dezelfde forecast als de rest van de kaart");
  assert(!pm.includes("new Date()"), "pacing-monitor.tsx leest de klok van de browser niet");
  assert(!/\/\s*365\b/.test(pm) && !/\b365\s*-/.test(pm), "pacing-monitor.tsx rekent niet met een vaste 365");
  assert(pm.includes("gerealiseerdeJaardagen(data.currentYear, totMaand)") && pm.includes("conv.realizedThroughMonth"),
    "pacing-monitor.tsx telt t/m forecast.conversions.kpi.realizedThroughMonth");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4. Eén aftelling: niemand rekent hem nog zelf uit.
// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("bronbewaking: één aftelling");
{
  const paden = [
    "components/branding/brand-header-bar.tsx",
    "components/dashboard/pacing-monitor.tsx",
    "components/dashboard/channel-pacing.tsx",
    "components/dashboard/fair-weeks-overview.tsx",
  ];
  for (const p of paden) {
    const b = bron(p);
    assert(!b.includes("weeksToFair("), `${p} roept weeksToFair niet zelf aan`);
    assert(b.includes("fairCountdown(") || b.includes("<BeursAftelling"), `${p} leest fairCountdown (direct of via BeursAftelling)`);
  }
  const cp = bron("components/dashboard/channel-pacing.tsx");
  assert(cp.includes("<BeursAftelling"), "channel-pacing.tsx gebruikt dezelfde kop als pacing-monitor.tsx");
  assert(!/new Date\(new Date\(vandaag\(\)\)/.test(cp) && cp.includes("daysInMonthOf(vandaag())"),
    "channel-pacing.tsx haalt de maandlengte uit de datumtekst, niet uit new Date() in de tijdzone van de kijker");
  const fw = bron("components/dashboard/fair-weeks-overview.tsx");
  const aanroepen = fw.split("toFairWeeks(").slice(1).map((r) => r.slice(0, r.indexOf(");")));
  assert(aanroepen.length > 0 && aanroepen.every((a) => a.includes("additief")),
    "fair-weeks-overview.tsx geeft bij elke toFairWeeks-aanroep op of de metric optelbaar is");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. ROAS en CPA in een maand waar de emmers niet op de maandagen passen.
// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("beursweken per metric (beursWekenVan in fair-weeks-overview.tsx)");

const wp = (month: number, week: number, realized: number | null, forecast: number | null, expected = 0): WeeklyPoint =>
  ({ month, week, label: `W${week}`, expected, realized, forecast });
const emmers = (month: number, n: number, realized: number | null, forecast: number | null, expected = 0) =>
  Array.from({ length: n }, (_, i) => wp(month, i + 1, realized, forecast, expected));

type Rij = [conversies: number, kosten: number, omzet: number];
const maanden = (rijen: Rij[]): MonthlyRecord[] =>
  rijen.map(([conversions, adSpend, revenue], i) => ({ month: i + 1, conversions, adSpend, revenue, weeks: [] }));
function basisForecast(jaar: number): { data: ClientHistoricalData; forecast: ClientForecast } {
  const rij: Rij = [100, 4000, 9600];
  const data: ClientHistoricalData = {
    clientId: "test",
    currentYear: jaar,
    targetCurrentYear: { conversions: 1200, revenue: 115200, adSpend: 48000 },
    historicalYears: { [jaar - 1]: maanden(Array.from({ length: 12 }, () => rij)) },
    currentYearData: maanden(Array.from({ length: 11 }, () => rij)).concat([null as unknown as MonthlyRecord]),
  };
  return { data, forecast: computeForecast(data) };
}
const metWeken = (f: ClientForecast, per: (m: ForecastMetric) => WeeklyPoint[]): ClientForecast => {
  const uit: ClientForecast = { ...f };
  for (const m of ["conversions", "revenue", "roas", "cpa"] as const) uit[m] = { ...f[m], weeklyPoints: per(m) };
  return uit;
};
{
  assert(typeof beurs.beursWekenVan === "function", "fair-weeks-overview.tsx exporteert beursWekenVan");
  if (typeof beurs.beursWekenVan === "function") {
    // Oktober 2026 heeft vier maandagen, november vijf. Het blended pad levert vijf emmers voor
    // oktober (31 dagen) en vier voor november (30): allebei verkeerd om.
    // Elke emmer gelijk, en de verhoudingen kloppen met de tellers (10.800 / 4.500 = 2,4 en
    // 4.500 / 100 = 45): dan is het maandcijfer gewoon die waarde. Hier stond een omzet van 240
    // naast een ROAS van 2,4 bij een ongemoeide kostenreeks; dat kon alleen zolang de strook de
    // ROAS-emmers middelde en de tellers niet bekeek (zie het geval hieronder).
    const waarde: Record<ForecastMetric | "adSpend", number> = { conversions: 100, revenue: 10800, adSpend: 4500, roas: 2.4, cpa: 45 };
    const basis = basisForecast(2026).forecast;
    const f = metWeken(basis, (m) => [...emmers(10, 5, waarde[m], null), ...emmers(11, 4, waarde[m], null)]);
    f.adSpend = { ...basis.adSpend, weeklyPoints: [...emmers(10, 5, waarde.adSpend, null), ...emmers(11, 4, waarde.adSpend, null)] };
    const fair = "2026-11-04";
    for (const m of ["roas", "cpa"] as const) {
      const w = beurs.beursWekenVan(f, m, 2026, fair);
      const okt = w.filter((x) => x.weekStart.startsWith("2026-10"));
      const nov = w.filter((x) => x.weekStart.startsWith("2026-11"));
      assert(okt.length === 4 && nov.length === 5, `${m}: oktober vier weken, november vijf`);
      assert([...okt, ...nov].every((x) => x.realized === waarde[m]),
        `${m}: elke week houdt het maandgemiddelde ${waarde[m]} (kreeg okt ${okt.map((x) => x.realized).join("/")}, nov ${nov.map((x) => x.realized).join("/")})`);
    }
    for (const m of ["conversions", "revenue"] as const) {
      const w = beurs.beursWekenVan(f, m, 2026, fair);
      const som = (mnd: string) => w.filter((x) => x.weekStart.startsWith(mnd)).reduce((s, x) => s + (x.realized ?? 0), 0);
      assert(som("2026-10") === 5 * waarde[m] && som("2026-11") === 4 * waarde[m], `${m}: het maandtotaal blijft staan`);
    }

    // De emmers verschillen: het kanaalpad deelt oktober in dag-emmers 1-7, 8-14, 15-21, 22-28 en
    // 29-31, en op 29-31 oktober is er niets geconverteerd. deriveForecast geeft die emmer een CPA
    // (en ROAS) van 0 in plaats van "niet te berekenen". Het gewone gemiddelde van de vijf
    // emmer-CPA's was (4 x 100 + 0) / 5 = 80, terwijl oktober echt 3.100 / 28 = 110,71 kostte; een
    // CPA onder de verwachting kleurt groen, dus de strook zei "goed" waar het slecht ging. Ook
    // zonder nul is het gemiddelde scheef: een korte emmer van drie dagen telt even zwaar als een
    // hele week. In een herverdeelde maand is de verhouding dus die van de maandtellers.
    const tel = (month: number, waarden: number[], soort: "realized" | "forecast", verwacht: number[] = waarden): WeeklyPoint[] =>
      waarden.map((v, i) => wp(month, i + 1, soort === "realized" ? v : null, soort === "forecast" ? v : null, verwacht[i]));
    const conversions = { ...basis.conversions, weeklyPoints: [
      ...tel(10, [7, 7, 7, 7, 0], "realized", [8, 8, 8, 8, 0]), ...tel(11, [5, 5, 5, 10], "forecast")] };
    const adSpend = { ...basis.adSpend, weeklyPoints: [
      ...tel(10, [700, 700, 700, 700, 300], "realized"), ...tel(11, [600, 600, 600, 1200], "forecast")] };
    const revenue = { ...basis.revenue, weeklyPoints: [
      ...tel(10, [1750, 1750, 1750, 1750, 0], "realized"), ...tel(11, [1800, 1800, 1800, 1800], "forecast")] };
    const scheef: ClientForecast = {
      ...basis, conversions, adSpend, revenue,
      roas: deriveForecast(revenue, adSpend, "roas", true),
      cpa: deriveForecast(adSpend, conversions, "cpa", true),
    };
    // Hier stond "100,100,100,100,0": deriveForecast gaf die emmer een CPA van 0, en dat was precies
    // de fout (300 / 0 is geen CPA, en € 0 kleurt groen). Nu is hij null, met de vlag geenNoemer:
    // kosten zonder conversie is gemeten, geen gat. De maand blijft gerealiseerd: dat leest de
    // strook van de noemerreeks, niet van de verhouding.
    assert(scheef.cpa.weeklyPoints.filter((p) => p.month === 10).map((p) => p.realized).join(",") === "100,100,100,100,",
      "voorwaarde: de emmer van 29-31 oktober heeft geen CPA (deriveForecast: noemer nul)");
    const cpa = beurs.beursWekenVan(scheef, "cpa", 2026, fair);
    const roas = beurs.beursWekenVan(scheef, "roas", 2026, fair);
    const oktCpa = cpa.filter((x) => x.weekStart.startsWith("2026-10"));
    const oktRoas = roas.filter((x) => x.weekStart.startsWith("2026-10"));
    const novRoas = roas.filter((x) => x.weekStart.startsWith("2026-11"));
    assert(oktCpa.length === 4 && oktCpa.every((x) => x.realized === 110.71),
      `CPA oktober: elke week 3.100 / 28 = 110,71 (kreeg ${oktCpa.map((x) => x.realized).join("/")})`);
    assert(oktCpa.every((x) => x.expected === 96.88),
      `CPA oktober: de verwachting uit de verwachte tellers, 3.100 / 32 = 96,88 (kreeg ${oktCpa.map((x) => x.expected).join("/")})`);
    assert(oktRoas.every((x) => x.realized === 2.26),
      `ROAS oktober: elke week 7.000 / 3.100 = 2,26 (kreeg ${oktRoas.map((x) => x.realized).join("/")})`);
    // November: vier emmers bij vijf maandagen, nog prognose. Emmer-ROAS 3/3/3/1,5 middelde tot
    // 2,63; de maand is 7.200 / 3.000 = 2,4.
    assert(novRoas.length === 5 && novRoas.every((x) => x.realized === null && x.forecast === 2.4),
      `ROAS november: prognose 2,4 in elke week (kreeg ${novRoas.map((x) => `${x.realized}/${x.forecast}`).join(" ")})`);

    // Een PASSENDE maand (augustus 2026: vijf emmers, vijf maandagen) met een emmer zonder
    // conversies (300 kosten, 0 conversies). De emmers gaan dan één op één door, en die week stond
    // er als "gerealiseerd CPA 0" tegen een verwachting van 105, groen. Daarna als "Geen data" in
    // het grijs, alsof er niets gemeten was. Nu zonder getal, met de vlag geenNoemer: de week heet
    // "Geen conversies", in het rood.
    const aug = (v: number[], soort: "realized" | "forecast" = "realized") => tel(8, v, soort);
    const augConv = { ...basis.conversions, weeklyPoints: aug([7, 7, 7, 7, 0]) };
    const augSpend = { ...basis.adSpend, weeklyPoints: aug([700, 700, 700, 700, 300]) };
    const augRev = { ...basis.revenue, weeklyPoints: aug([1750, 1750, 1750, 1750, 0]) };
    const passend: ClientForecast = {
      ...basis, conversions: augConv, adSpend: augSpend, revenue: augRev,
      roas: deriveForecast(augRev, augSpend, "roas", true), cpa: deriveForecast(augSpend, augConv, "cpa", true),
    };
    const augCpa = beurs.beursWekenVan(passend, "cpa", 2026, "2026-09-30").filter((x) => x.weekStart.startsWith("2026-08"));
    assert(augCpa.length === 5 && augCpa.slice(0, 4).every((x) => x.realized === 100 && !x.geenNoemer)
      && augCpa[4].realized === null && augCpa[4].forecast === null && augCpa[4].geenNoemer === true,
      `CPA augustus (passend): de week zonder conversies heeft geen CPA, wel de vlag (kreeg ${augCpa.map((x) => `${x.realized}/${x.forecast}/${x.geenNoemer}`).join(" ")})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 6. De beurssectie gerenderd: de kop en weken zonder data.
//    data.currentYear ligt twee jaar terug, zodat de strook op zijn laatste week vastgeklemd staat
//    en de afstand vanaf die week (100+ weken) duidelijk anders is dan die vanaf vandaag.
// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log("beurssectie (FairWeeksView in fair-weeks-overview.tsx)");
{
  const jaar = Number(VANDAAG.slice(0, 4)) - 2;
  const basis = basisForecast(jaar);
  // Januari t/m november gerealiseerd; december zonder realisatie en zonder prognose (zoals de
  // forecast een lege maand vóór de laatste gerealiseerde maand aanlevert).
  const punten = (waarde: number) => {
    const uit: WeeklyPoint[] = [];
    for (let m = 1; m <= 12; m++) uit.push(...emmers(m, mondaysInMonth(jaar, m), m < 12 ? waarde : null, null, waarde));
    return uit;
  };
  const forecast = metWeken(basis.forecast, (m) => punten(m === "roas" ? 2.4 : m === "cpa" ? 40 : 25));

  // Dezelfde naam als de pacingkop (BeursAftelling). Hier stond "Nog 3 weken tot 2026" en
  // "Beursweek: 2026": het label is een jaartal, dus las de regel als een afstand tot het jaar.
  // De titel erboven ("Weken tot GreenTech North America") verzachtte dat, maar de regel zelf
  // noemde geen beurs, en de pacingkop zei het intussen wel goed.
  const over3 = render(beurs.FairWeeksView, { data: basis.data, forecast, edition: editie(addDays(VANDAAG, 21)) }) ?? "";
  assert(over3.includes("Nog 3 weken tot GRN 2026"), `beurs over drie weken: "Nog 3 weken tot GRN 2026" in de kop (kreeg: "${over3.slice(0, 160)}")`);
  const nu = render(beurs.FairWeeksView, { data: basis.data, forecast, edition: editie(VANDAAG) }) ?? "";
  assert(nu.includes("Beursweek: GRN 2026"), `beurs vandaag: "Beursweek: GRN 2026" in de kop (kreeg: "${nu.slice(0, 160)}")`);
  assert(!/Nog \d+ weken? tot/.test(nu), "beurs vandaag: geen \"Nog N weken tot\"");

  // De laatste weken (december) hebben geen waarde: "Geen data" en een streep, geen "Prognose 0".
  assert(over3.includes("Geen data"), "een week zonder realisatie en prognose heet \"Geen data\"");
  assert(!over3.includes("Prognose"), "zo'n week heet niet \"Prognose\"");
  const decemberWeken = mondaysInMonth(jaar, 12);
  assert(over3.split("—").length - 1 >= decemberWeken, `de ${decemberWeken} decemberweken tonen "—" in de strook`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
