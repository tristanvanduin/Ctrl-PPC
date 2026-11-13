// De trechter op het Overzicht in de nieuwe weergave (lib/overzicht/trechter.ts en de blokken in
// components/dashboard/overzicht-trechter.tsx en overzicht-wat-nu.tsx).
// Draaien: tsx --tsconfig ./tsconfig.json lib/overzicht/__trechter_test.ts
//
// Wat deze test vasthoudt:
// - DE STATUSREGEL: zonder vergelijking alleen de totalen; met vergelijking de verandering en de CPA;
//   een percentage over een deel zegt dat; zonder vergelijkbaar deel geen percentage; en nooit een
//   oordeel dat de cijfers niet dragen.
// - DE TRECHTER: CTR en conversieratio via safeDiv (geen klikken is "niet te berekenen", geen 0%),
//   onbekende tellers zijn geen nullen, meer conversies dan klikken wordt uitgelegd, en de
//   veranderingen gaan over het paar.
// - DE PAREN: per maand dezelfde regel als de tegels (gepaardeTotalen), met de tellers over dezelfde
//   maanden; per dag de telling, met de tellers uit dezelfde dagrijen (link_clicks bij Meta).
// - DE BIJDRAGE: aandeel kosten tegen aandeel conversies, een kenmerk pas vanaf de grens, geen
//   kenmerk bij één kanaal, en de CPA-verandering alleen waar gepaard is.
// - WAT NU: leeg is leeg, per kanaal gefilterd zoals het logboek, to-do's eerst, dan ICE, hooguit drie.
// - DE SCHAKELAAR: de nieuwe blokken staan alleen in de nieuwe weergave.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BIJDRAGE_VERSCHIL_VANAF, WAT_NU_MAX, balkBreedtes, bijdragePerKanaal, kanaalParenUitDagen, kanaalParenUitMaanden,
  procentTekst, statusRegel, tellersOver, tellersPerMaand, trechter, watNuItems,
  type KanaalStand,
} from "./trechter";
import { delta, type BronReeks, type Totalen } from "../period/apply-period";
import type { KaartCijfers } from "./bovenkant";
import type { LogboekItem } from "./logboek";
import { telDagVergelijking } from "../period/dag-telling";
import { resolveChannelConversionConfig } from "../analysis/channel-conversion-config";
import { BijdragePerKanaal, KanaalTrechter, StatusRegel } from "../../components/dashboard/overzicht-trechter";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const tot = (conversions: number, adSpend: number, revenue = 0): Totalen => ({ conversions, adSpend, revenue });
// Woorden die een oordeel geven dat in deze cijfers niet zit: er is geen doel of norm om het aan af te meten.
const OORDEEL = /\b(goed|slecht|beter|slechter|zorgwekkend|sterk|zwak|uitstekend|teleurstellend|gezond|probleem|helaas|gelukkig)\b/i;

console.log("De statusregel");
{
  const zonder = statusRegel({ totalen: tot(120, 5400), deltas: null, tegen: null });
  // Intl zet een harde spatie achter het euroteken.
  check("zonder vergelijking: de totalen en de CPA", zonder.replace(/\u00A0/g, " ") === "120 conversies voor € 5.400 aan kosten, een CPA van € 45.", zonder);
  check("zonder vergelijking: geen percentage", !/%/.test(zonder), zonder);

  const met = statusRegel({
    totalen: tot(112, 5040),
    deltas: { conversions: delta(112, 100), adSpend: delta(5040, 4500) },
    tegen: "november 2024 t/m oktober 2025",
  });
  // CPA nu 45, toen 45: vrijwel gelijk. Conversies +12%.
  check("met vergelijking: de verandering van de conversies tegen het venster", met.startsWith("Conversies +12% tegen november 2024 t/m oktober 2025"), met);
  check("met vergelijking: de CPA met zijn richting", met.includes("bij een CPA die vrijwel gelijk bleef"), met);

  const steeg = statusRegel({
    totalen: tot(110, 5148),
    deltas: { conversions: delta(110, 100), adSpend: delta(5148, 4500) },
    tegen: "de vorige editie",
  });
  check("een CPA die steeg zegt 'steeg' met het percentage", steeg === "Conversies +10% tegen de vorige editie, bij een CPA die 4% steeg.", steeg);

  const daalde = statusRegel({ totalen: tot(80, 4000), deltas: { conversions: delta(80, 100), adSpend: delta(4000, 4500) }, tegen: "vorig jaar" });
  check("dalende conversies krijgen een minteken, de CPA 'steeg' of 'daalde'", daalde.startsWith("Conversies -20%") && daalde.includes("CPA die 11% steeg"), daalde);

  // Een deel: het totaal is 150, gepaard is maar 100 (een kanaal liep toen nog niet).
  const deel = statusRegel({ totalen: tot(150, 6000), deltas: { conversions: delta(100, 90), adSpend: delta(4000, 4000) }, tegen: "vorig jaar" });
  check("een percentage over een deel zegt dat", deel.includes("alleen over het deel dat in beide periodes liep"), deel);

  const nietsTePaaren = statusRegel({ totalen: tot(40, 2000), deltas: { conversions: delta(0, 0), adSpend: delta(0, 0) }, tegen: "vorig jaar" });
  check("niets te paren: geen percentage, wel de totalen en waarom niet", !/%/.test(nietsTePaaren) && nietsTePaaren.includes("geen vergelijkbaar deel"), nietsTePaaren);

  const leeg = statusRegel({ totalen: tot(0, 0), deltas: null, tegen: null });
  check("niets gebeurd: dat in een zin, geen CPA van nul", leeg === "Geen kosten en geen conversies in deze periode.", leeg);
  const geenConv = statusRegel({ totalen: tot(0, 800), deltas: null, tegen: null });
  check("kosten zonder conversies: geen CPA", !geenConv.includes("CPA") && geenConv.includes("geen conversies"), geenConv);

  // De conversies dekken het hele totaal, de kosten niet: een nieuw kanaal met kosten en zonder
  // conversies telt mee in de CPA van de tegel (2000 / 100 = 20) maar niet in het paar (15 tegen 15).
  // Dan mag de CPA-verandering niet klinken alsof ze over die 20 gaat.
  const kostenDeel = statusRegel({
    totalen: tot(100, 2000), deltas: { conversions: delta(100, 80), adSpend: delta(1500, 1200) }, tegen: "vorig jaar",
  });
  check("conversies heel, kosten deel: de CPA-verandering zegt dat ze over het gepaarde deel gaat",
    kostenDeel.startsWith("Conversies +25% tegen vorig jaar,") && kostenDeel.includes("CPA die over het gepaarde deel vrijwel gelijk bleef"), kostenDeel);
  check("conversies heel: geen voorbehoud bij de conversies zelf", !kostenDeel.includes("(alleen over het deel"), kostenDeel);

  // Wel gepaard, maar toen geen conversies: er IS een vergelijkbaar deel, alleen geen basis.
  const toenNul = statusRegel({ totalen: tot(30, 1500), deltas: { conversions: delta(30, 0), adSpend: delta(1500, 900) }, tegen: "vorig jaar" });
  check("toen geen conversies: geen percentage, en niet 'geen vergelijkbaar deel'",
    !/%/.test(toenNul) && !toenNul.includes("geen vergelijkbaar deel") && toenNul.includes("in vorig jaar waren er geen conversies"), toenNul);
  const toenNulDeel = statusRegel({ totalen: tot(50, 2500), deltas: { conversions: delta(30, 0), adSpend: delta(1500, 900) }, tegen: "vorig jaar" });
  check("toen geen conversies in een deel: dat staat erbij", toenNulDeel.includes("in het deel dat in beide periodes liep"), toenNulDeel);

  for (const zin of [zonder, met, steeg, daalde, deel, nietsTePaaren, leeg, geenConv, kostenDeel, toenNul, toenNulDeel]) {
    check(`geen oordeel: "${zin}"`, !OORDEEL.test(zin), zin);
  }
  check("procentTekst rondt af en geeft een teken", procentTekst(12.4) === "+12%" && procentTekst(-3.6) === "-4%" && procentTekst(0.3) === "vrijwel gelijk");
}

console.log("De trechter");
{
  const stand: KanaalStand = { totalen: tot(50, 2000), tellers: { impressions: 100_000, clicks: 2_000 } };
  const t = trechter(stand, null);
  check("drie stappen in vaste volgorde", t.stappen.map((s) => s.sleutel).join(",") === "vertoningen,klikken,conversies");
  check("CTR is klikken gedeeld door vertoningen", t.overgangen[0].waarde === 0.02, String(t.overgangen[0].waarde));
  check("conversieratio is conversies gedeeld door klikken", t.overgangen[1].waarde === 0.025, String(t.overgangen[1].waarde));
  check("kosten per 1.000 vertoningen, per klik, per conversie", t.stappen[0].kosten.waarde === 20 && t.stappen[1].kosten.waarde === 1 && t.stappen[2].kosten.waarde === 40,
    JSON.stringify(t.stappen.map((s) => s.kosten.waarde)));
  check("zonder paar: geen veranderingen", t.vergelijking === "geen" && t.stappen.every((s) => s.pct === null && s.kosten.pct === null));
  check("zonder bijzonderheden: geen opmerkingen", t.opmerkingen.length === 0, JSON.stringify(t.opmerkingen));

  const geenKlik = trechter({ totalen: tot(0, 300), tellers: { impressions: 5000, clicks: 0 } }, null);
  check("geen klikken: conversieratio niet te berekenen (null, geen 0)", geenKlik.overgangen[1].waarde === null);
  check("geen klikken: kosten per klik niet te berekenen", geenKlik.stappen[1].kosten.waarde === null);
  check("geen klikken: geen conversies dus geen CPA", geenKlik.stappen[2].kosten.waarde === null);
  check("geen klikken: de CTR is gewoon 0%", geenKlik.overgangen[0].waarde === 0);
  check("geen klikken: dat wordt gezegd", geenKlik.opmerkingen.some((o) => o.includes("Geen klikken")), JSON.stringify(geenKlik.opmerkingen));

  const niets = trechter({ totalen: tot(0, 0), tellers: { impressions: 0, clicks: 0 } }, null);
  check("niets: elke verhouding null", niets.overgangen.every((o) => o.waarde === null) && niets.stappen.every((s) => s.kosten.waarde === null));
  check("niets: in één zin", niets.opmerkingen.length === 1 && niets.opmerkingen[0].startsWith("Geen vertoningen"), JSON.stringify(niets.opmerkingen));

  const onbekend = trechter({ totalen: tot(30, 900), tellers: null }, null);
  check("onbekende tellers zijn geen nullen", onbekend.stappen[0].waarde === null && onbekend.stappen[1].waarde === null && onbekend.overgangen[0].waarde === null);
  check("onbekende tellers: de conversies en de CPA staan er wel", onbekend.stappen[2].waarde === 30 && onbekend.stappen[2].kosten.waarde === 30);
  check("onbekende tellers: dat wordt gezegd", onbekend.opmerkingen.some((o) => o.includes("niet bekend")));

  const naWeergave = trechter({ totalen: tot(80, 800), tellers: { impressions: 10_000, clicks: 50 } }, null);
  check("meer conversies dan klikken: de ratio staat er (boven 100%) en wordt uitgelegd",
    naWeergave.overgangen[1].waarde === 1.6 && naWeergave.opmerkingen.some((o) => o.includes("meer conversies dan klikken")));

  const metPaar = trechter(stand, {
    nu: stand,
    toen: { totalen: tot(40, 2000), tellers: { impressions: 80_000, clicks: 2_000 } },
    heel: true, over: null,
  });
  check("met paar: de veranderingen per stap", metPaar.stappen[0].pct === 25 && metPaar.stappen[1].pct === 0 && metPaar.stappen[2].pct === 25,
    JSON.stringify(metPaar.stappen.map((s) => s.pct)));
  check("met paar: de vorige CTR erbij", metPaar.overgangen[0].vorig === 0.025, String(metPaar.overgangen[0].vorig));
  check("met paar: de CPA daalde 20%", metPaar.stappen[2].kosten.pct === -20, String(metPaar.stappen[2].kosten.pct));
  const toenGeenKlik = trechter(stand, { nu: stand, toen: { totalen: tot(0, 100), tellers: { impressions: 1000, clicks: 0 } }, heel: true, over: null });
  check("toen geen klikken: de verandering van de klikken is geen percentage", toenGeenKlik.stappen[1].pct === null && toenGeenKlik.overgangen[1].vorig === null);
  const deel = trechter(stand, { nu: stand, toen: stand, heel: false, over: "maart 2026 t/m oktober 2026 tegen maart 2025 t/m oktober 2025" });
  check("een paar over een deel zegt over welk deel", deel.vergelijking === "deel" && deel.over!.startsWith("maart 2026"));

  const b = balkBreedtes([100_000, 2_000, 50]);
  check("de balken nemen af en de breedste is 100", b[0] === 100 && b[0] > b[1] && b[1] > b[2] && b[2] > 0, JSON.stringify(b));
  check("een stap zonder getal of nul heeft geen balk", JSON.stringify(balkBreedtes([null, 0, 10])) === "[0,0,100]", JSON.stringify(balkBreedtes([null, 0, 10])));
  check("allemaal nul: geen balken", balkBreedtes([0, 0, 0]).every((x) => x === 0));
}

console.log("De paren per maand");
{
  // Google loopt twee jaar, Meta pas sinds maart 2026.
  const google: BronReeks = { naam: "google", maanden: new Map([
    ["2025-01", tot(10, 500)], ["2025-02", tot(10, 500)], ["2026-01", tot(12, 500)], ["2026-02", tot(14, 500)],
  ]) };
  const meta: BronReeks = { naam: "meta", maanden: new Map([["2026-03", tot(5, 200)]]) };
  const tellers = {
    google: tellersPerMaand([
      { month: "2025-01", impressions: 1000, clicks: 100 }, { month: "2025-02", impressions: 1000, clicks: 100 },
      { month: "2026-01", impressions: 1500, clicks: 120 }, { month: "2026-02", impressions: 1500, clicks: 130 },
    ]),
  };
  const paren = kanaalParenUitMaanden({
    perKanaal: { google, meta }, tellers, kanalen: ["google", "meta"],
    periode: { start: "2026-01", end: "2026-02" }, vergelijking: { start: "2025-01", end: "2025-02" },
  });
  const g = paren.find((p) => p.kanaal === "google")!;
  check("Google: gepaard over de hele periode", g.paar?.heel === true && g.paar.nu.totalen.conversions === 26 && g.paar.toen.totalen.conversions === 20);
  check("Google: de tellers over dezelfde maanden", g.paar?.nu.tellers?.clicks === 250 && g.paar.toen.tellers?.clicks === 200, JSON.stringify(g.paar));
  const m = paren.find((p) => p.kanaal === "meta")!;
  check("Meta liep toen nog niet: geen paar, met de reden", m.paar === null && !!m.uitleg && m.uitleg.includes("Meta"), String(m.uitleg));
  const zonder = kanaalParenUitMaanden({ perKanaal: { google }, tellers, kanalen: ["google"], periode: { start: "2026-01", end: "2026-02" }, vergelijking: null });
  check("zonder vergelijking: geen paar en geen uitleg", zonder[0].paar === null && zonder[0].uitleg === null);
  check("tellersPerMaand: een reeks zonder tellers is onbekend, geen nul", tellersPerMaand([{ month: "2026-01" }]) === null);
  check("tellersOver: een maand zonder rij telt als nul", tellersOver(tellers.google, ["2026-01", "2026-05"])?.impressions === 1500);
}

console.log("De paren per dag");
{
  // Meta-dagrijen: twee edities van een actie van drie dagen, een jaar uit elkaar.
  const dag = (date: string, impressions: number, link_clicks: number, spend: number, conversions: number) =>
    ({ date, impressions, link_clicks, clicks_all: link_clicks * 3, spend, conversions, leads: 0, conversion_value: 0 });
  const rijen = [
    dag("2025-11-21", 1000, 20, 100, 2), dag("2025-11-22", 1000, 20, 100, 2), dag("2025-11-23", 1000, 20, 100, 2),
    dag("2026-11-20", 2000, 30, 120, 3), dag("2026-11-21", 2000, 30, 120, 3), dag("2026-11-22", 2000, 30, 120, 3),
  ];
  const v = telDagVergelijking({ start: "2026-11-20", eind: "2026-11-22" }, { start: "2025-11-21", eind: "2025-11-23" },
    { dagkanalen: { meta: rijen }, convConfig: resolveChannelConversionConfig(null) });
  const h = v.huidig.perKanaal.find((x) => x.kanaal === "meta");
  check("de telling per dag draagt de tellers, met link_clicks als klikken", h?.tellers?.impressions === 6000 && h.tellers.clicks === 90, JSON.stringify(h?.tellers));
  const paren = kanaalParenUitDagen(v, ["meta"]);
  check("per dag: het paar over de hele periode, met de tellers", paren[0].paar?.heel === true && paren[0].paar.toen.tellers?.clicks === 60, JSON.stringify(paren[0]));
  const tr = trechter({ totalen: h!.totalen, tellers: h!.tellers }, paren[0].paar);
  check("de trechter per dag: klikken +50%, conversies +50%", tr.stappen[1].pct === 50 && tr.stappen[2].pct === 50, JSON.stringify(tr.stappen.map((s) => s.pct)));
}

console.log("Bijdrage per kanaal");
{
  const kaart = (kanaal: KaartCijfers["kanaal"], conversions: number, adSpend: number, ak: number, ac: number): KaartCijfers =>
    ({ kanaal, conversions, adSpend, revenue: 0, cpa: conversions > 0 ? adSpend / conversions : null, aandeelKosten: ak, aandeelConversies: ac });
  const cijfers = [kaart("google", 80, 4000, 50, 80), kaart("linkedin", 10, 3000, 38, 10), kaart("meta", 10, 1000, 12, 10)];
  const rijen = bijdragePerKanaal(cijfers, null);
  check("de aandelen zijn die van de kaarten", rijen[1].aandeelKosten === 38 && rijen[1].aandeelConversies === 10);
  check("een kanaal dat duur is voor wat het levert valt op", rijen[1].kenmerk === "duur");
  check("een kanaal dat meer levert dan het kost ook, in woorden", rijen[0].kenmerk === "voordelig");
  check(`onder ${BIJDRAGE_VERSCHIL_VANAF} punten verschil geen kenmerk`, rijen[2].kenmerk === null);
  check("zonder vergelijking geen CPA-verandering", rijen.every((r) => r.cpaPaar === null));
  const een = bijdragePerKanaal([kaart("google", 80, 4000, 100, 100)], null);
  check("één kanaal: geen kenmerk", een[0].kenmerk === null);
  const geenConv = bijdragePerKanaal([kaart("google", 0, 100, 100, 0)].map((c) => ({ ...c, aandeelConversies: null })), null);
  check("geen conversies: geen CPA en geen kenmerk", geenConv[0].cpa === null && geenConv[0].kenmerk === null);

  const metPaar = bijdragePerKanaal(cijfers, [
    { kanaal: "google", paar: { nu: { totalen: tot(80, 4000), tellers: null }, toen: { totalen: tot(50, 4000), tellers: null }, heel: true, over: null }, uitleg: null },
    { kanaal: "linkedin", paar: null, uitleg: "LinkedIn liep toen nog niet." },
    { kanaal: "meta", paar: { nu: { totalen: tot(0, 1000), tellers: null }, toen: { totalen: tot(10, 1000), tellers: null }, heel: true, over: null }, uitleg: null },
  ]);
  check("met paar: de CPA-verandering over het paar", metPaar[0].cpaPaar?.pct === -37.5 && metPaar[0].cpaPaar.toen === 80, JSON.stringify(metPaar[0].cpaPaar));
  check("zonder paar: de reden", metPaar[1].cpaPaar === null && metPaar[1].uitleg === "LinkedIn liep toen nog niet.");
  check("nu geen conversies: geen percentage", metPaar[2].cpaPaar?.nu === null && metPaar[2].cpaPaar.pct === null);
}

console.log("Wat nu");
{
  const item = (id: string, soort: LogboekItem["soort"], kanaal: LogboekItem["kanaal"], tijd: string, chip: string | null): LogboekItem =>
    ({ id, soort, kanaal, tijd, titel: id, chip, toon: "neutraal", detail: [], beoordeelbaar: soort === "voorstel" });
  const items: LogboekItem[] = [
    item("voorstel-meta-laag", "voorstel", "meta", "2026-11-10T10:00:00Z", "ICE 4"),
    item("voorstel-google-hoog", "voorstel", "google", "2026-11-01T10:00:00Z", "ICE 8,5"),
    item("voorstel-meta-hoog", "voorstel", "meta", "2026-11-02T10:00:00Z", "ICE 7"),
    item("todo-open", "todo", null, "2026-11-05T10:00:00Z", "open"),
    item("todo-af", "todo", null, "2026-11-12T10:00:00Z", "afgevinkt"),
    item("sync", "sync", "google", "2026-11-12T10:00:00Z", null),
  ];
  check("leeg logboek: niets", watNuItems([], "blended").length === 0);
  check("alleen syncs: niets", watNuItems([items[5]], "blended").length === 0);
  const alle = watNuItems(items, "blended");
  check(`hooguit ${WAT_NU_MAX}`, alle.length === WAT_NU_MAX);
  check("de open to-do eerst, dan de voorstellen op ICE", alle.map((i) => i.id).join(",") === "todo-open,voorstel-google-hoog,voorstel-meta-hoog", alle.map((i) => i.id).join(","));
  check("een afgevinkte to-do staat er niet", !alle.some((i) => i.id === "todo-af"));
  const meta = watNuItems(items, "meta");
  check("op Meta: Meta en wat de hele klant raakt, niet Google", meta.map((i) => i.id).join(",") === "todo-open,voorstel-meta-hoog,voorstel-meta-laag", meta.map((i) => i.id).join(","));
  check("op Microsoft: alleen wat de hele klant raakt", watNuItems(items, "microsoft").map((i) => i.id).join(",") === "todo-open");
}

console.log("De blokken gerenderd");
{
  const stand: KanaalStand = { totalen: tot(50, 2000), tellers: { impressions: 100_000, clicks: 2_000 } };
  const html = renderToStaticMarkup(createElement(KanaalTrechter, {
    kanaal: "meta", trechter: trechter(stand, null), uitleg: null, venster: { over: "januari 2026 t/m oktober 2026", tegen: null },
  }));
  check("de trechter heeft een tabel als tekstalternatief, in een sr-only blok (een absolute tabel duwde de pagina zijwaarts)", html.includes('<div class="sr-only"><table>') && html.includes("<caption>Trechter van Meta"), html.slice(0, 300));
  check("de tabel noemt elke stap en de CTR", ["Vertoningen", "Klikken", "Conversies", "CTR", "Conversieratio"].every((w) => html.includes(`<th scope="row">${w}</th>`)));
  check("de balken zelf zijn verborgen voor een schermlezer", /aria-hidden="true"[^>]*><div data-trechterstap="vertoningen"/.test(html), html);
  check("het venster staat erbij", html.includes("januari 2026 t/m oktober 2026") && html.includes("zonder vergelijking"));

  // De verandering van het aantal en die van de kosten staan elk bij hun eigen getal, ook in de tabel.
  const paar = {
    nu: { totalen: tot(50, 2000), tellers: { impressions: 100_000, clicks: 2_000 } },
    toen: { totalen: tot(40, 1500), tellers: { impressions: 80_000, clicks: 2_000 } },
    heel: true, over: null,
  };
  const metPaar = renderToStaticMarkup(createElement(KanaalTrechter, {
    kanaal: "meta", trechter: trechter(stand, paar), uitleg: "Google: geteld per hele week.", venster: { over: "x", tegen: "y" },
  }));
  // Kosten per klik: 1,00 tegen 0,75 = +33%; het aantal klikken bleef gelijk.
  check("de kostenverandering staat achter de kosten", metPaar.replace(/\u00A0/g, " ").includes("€ 1,00 per klik, +33%"), metPaar);
  check("de verandering van het aantal staat apart", metPaar.includes("aantal +25%") && !/\+25% ·/.test(metPaar), metPaar);
  check("de tabel heeft een kolom voor de kostenverandering", metPaar.includes("Verandering kosten") && metPaar.includes("<td>+33%</td>"), metPaar);
  check("de uitleg van het kanaal staat er ook bij een vergelijking", metPaar.includes("Google: geteld per hele week."), metPaar);

  const kaart = (kanaal: KaartCijfers["kanaal"], ak: number, ac: number): KaartCijfers =>
    ({ kanaal, conversions: ac, adSpend: ak * 100, revenue: 0, cpa: ac > 0 ? (ak * 100) / ac : null, aandeelKosten: ak, aandeelConversies: ac });
  const bijdrage = renderToStaticMarkup(createElement(BijdragePerKanaal, {
    rijen: bijdragePerKanaal([kaart("google", 40, 75), kaart("linkedin", 60, 25)], null),
    venster: { over: "2026", tegen: null },
  }));
  check("duur voor wat het levert staat er in woorden, niet alleen in kleur", bijdrage.includes("kost meer dan het levert"));
  check("geen rode alarmkleur in de bijdrage", !/text-red|bg-red|border-red/.test(bijdrage));
  const status = renderToStaticMarkup(createElement(StatusRegel, { tekst: "Conversies +12% tegen vorig jaar." }));
  check("de statusregel draagt zijn tekst", status.includes("Conversies +12% tegen vorig jaar.") && status.includes("data-statusregel"));
}

console.log("De schakelaar");
{
  // De nieuwe blokken hangen alleen aan de nieuwe weergave: de bovenkant (statusregel, bijdrage,
  // trechter) rendert client-dashboard alleen in de tak `nieuweWeergave ?`, en "Wat nu" alleen achter
  // `nieuweWeergave &&`. Uit de brontekst gelezen: het klantdashboard is te groot om hier te mounten.
  const bron = readFileSync(join(process.cwd(), "components/dashboard/client-dashboard.tsx"), "utf8");
  const nieuweTak = bron.indexOf("{nieuweWeergave ? (");
  const oudeTak = bron.indexOf("// ── De vertrouwde weergave");
  const bovenkant = bron.indexOf("<OverzichtBovenkant");
  check("de bovenkant staat in de tak van de nieuwe weergave", nieuweTak > 0 && bovenkant > nieuweTak && bovenkant < oudeTak);
  check("de bovenkant staat er één keer", bron.split("<OverzichtBovenkant").length === 2);
  const watNu = [...bron.matchAll(/<OverzichtWatNu/g)];
  check("Wat nu staat er één keer", watNu.length === 1);
  const ervoor = bron.slice(Math.max(0, watNu[0].index! - 80), watNu[0].index!);
  check("Wat nu staat achter nieuweWeergave &&", /\{nieuweWeergave && \(\s*$/.test(ervoor), ervoor);
  const vertrouwd = bron.slice(oudeTak, bron.indexOf("{clientData.loading && <PaginaLaadvlak"));
  check("de vertrouwde tak kent geen statusregel, bijdrage of trechter",
    !/StatusRegel|BijdragePerKanaal|KanaalTrechter|OverzichtWatNu/.test(vertrouwd));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
