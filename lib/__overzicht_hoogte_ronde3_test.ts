// De hoogte van het Overzicht in de nieuwe weergave, derde ronde: de bovenkant (kerncijfertegels,
// kanaalkaarten) en de wereldkaart compacter op een telefoon, niets weg.
// Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_hoogte_ronde3_test.ts
//
// WAT DEZE TEST VASTHOUDT (zie docs/overzicht-inklappen-elementen.md, "Ronde 3")
//
// - De tegels: elk kerncijfer en elke verandering staat in de uitvoer, BUITEN elk verborgen deel; de
//   vorige waarde ("was", en "deel ... was ..." als het percentage over een deel gaat) ook. Het
//   verloopje staat in dezelfde regel als de verandering, niet op een eigen regel.
// - De uitleg over welke kanalen in het percentage meetellen: één korte zin open, de volle zin IN de
//   pagina achter "Waarom?" (aria-expanded="false", hidden), letterlijk dezelfde zin als in de band.
// - De vijfde tegel staat op een telefoon niet alleen: de periode is de zesde cel van het raster.
// - De wereldkaart met de lijst ernaast: de top 3 landen met getal en verandering open, de projectie
//   op een telefoon achter "Toon de kaart" (aria-expanded, 44 px); vanaf lg zoals voorheen, iets
//   smaller (640 in plaats van 760 px).
// - DE SCHAKELAAR UIT: Kerncijfer zonder `strak`, de band (PeriodSummary zonder `vorm`) en
//   GeoMapCard zonder `naast` renderen byte voor byte als in de basis (dd6f72a). De vingerafdrukken
//   hieronder zijn met precies deze fixtures in de basis gerenderd (de vijf gewijzigde bestanden
//   tijdelijk op dd6f72a teruggezet); de nieuwe boom gaf dezelfde. De klok staat vast (opDag).
//
// Alles met react-dom/server: geen browser, geen netwerk.

import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Kerncijfer } from "../components/ui/kerncijfer";
import { PeriodSummary, ongepaardKern } from "../components/dashboard/period-summary";
import { GeoMapCard } from "../components/dashboard/geo-map-card";
import { GeoRanglijstInKaart } from "../components/dashboard/geo-ranglijst-card";
import { Kanaalkaarten, type Kanaalkaart } from "../components/dashboard/kanaalkaarten";
import { PeriodProvider } from "./period/period-context";
import { opDag } from "./reporting-date";
import { alsBronReeks, type BronPaar } from "./period/apply-period";
import { bouwHistorischeData, samenvoegen } from "./period/kanaal-maanden";
import { monthsIn } from "./period/period-range";

let geslaagd = 0, gefaald = 0;
function check(label: string, voorwaarde: boolean, detail = ""): void {
  if (voorwaarde) { geslaagd += 1; return; }
  gefaald += 1;
  console.error(`  FAIL: ${label}${detail ? `\n        ${detail}` : ""}`);
}
const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const vinger = (s: string) => createHash("sha256").update(s).digest("hex");

/** De knop van een uitklapdeel en het deel zelf, op id (dezelfde lezing als de rondes ervoor). */
function uitklap(html: string, id: string): { knop: string; open: boolean; inhoud: string | null; verborgen: boolean } | null {
  const k = new RegExp(`<button type="button" aria-expanded="(true|false)" aria-controls="uitklap-${id}"[^>]*>((?:(?!</button>)[\\s\\S])*)</button>`).exec(html);
  if (!k) return null;
  const start = html.indexOf(`<div id="uitklap-${id}"`);
  const kop = start >= 0 ? html.slice(start, html.indexOf(">", start) + 1) : "";
  return { knop: tekst(k[2]).trim(), open: k[1] === "true", inhoud: start >= 0 ? html.slice(start) : null, verborgen: /\shidden=""/.test(kop) };
}

// ── Gegevens (dezelfde als de vingerafdrukken van de basis) ─────────────────────────────────────
const maand = (van: string, tot: string, f: (i: number) => { conversions: number; revenue: number; adSpend: number }) =>
  monthsIn({ start: van, end: tot }).map((k, i) => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), ...f(i) }));
const g = bouwHistorischeData("t", maand("2024-09", "2026-10", (i) => ({ conversions: 100 + i * 3, revenue: 9000 + i * 110, adSpend: 4000 + i * 37 })) as never, 2026);
const m = bouwHistorischeData("t", maand("2026-03", "2026-10", (i) => ({ conversions: 40 + i * 7, revenue: 2100 + i * 90, adSpend: 1500 + i * 211 })) as never, 2026);
const samen = samenvoegen("t", [g, m], 2026);
const bronnen = [alsBronReeks("google", g), alsBronReeks("meta", m)];

const landen = [["NL", 420], ["DE", 260], ["BE", 140], ["FR", 60], ["GB", 30]] as const;
const ranked = landen.map(([code, v]) => ({ c: { code, impressions: v * 100, clicks: v * 4, conversions: v, cost: v * 30 }, v }));
const NAMEN: Record<string, string> = { NL: "Nederland", DE: "Duitsland", BE: "België", FR: "Frankrijk", GB: "Verenigd Koninkrijk" };
const geoBasis = {
  metricKey: "conversions", setMetricKey: () => {}, metric: { label: "Conversies", fmt: (v: number) => String(v) },
  focus: null, setFocus: () => {}, countries: ranked.map((r) => r.c), states: [], laden: false, canDrillUs: false,
  labelOf: (c: string) => NAMEN[c] ?? c,
  geoWord: "land", ranked, values: Object.fromEntries(ranked.map((r) => [r.c.code, r.v])),
  totaal: { impressions: 91000, clicks: 3640, conversions: 910, cost: 27300 },
  eenLandOfMinder: false, dagVenster: null, verandering: null,
};
const geoState = geoBasis as never;
// Met een vergelijking: per land de verandering, zoals de nieuwe weergave die per dag kent.
const geoMetVerandering = { ...geoBasis, verandering: new Map([["NL", { pct: 0.124, reden: null }], ["DE", { pct: -0.08, reden: null }], ["BE", { pct: 0.03, reden: null }], ["FR", { pct: 0.01, reden: null }], ["GB", { pct: -0.02, reden: null }]]) } as never;

const r = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const p = (el: ReturnType<typeof createElement>, scope: string) => r(createElement(PeriodProvider, { scope, children: el }));

// ── 1. Schakelaar uit: byte voor byte de basis ───────────────────────────────────────────────────
console.log("Schakelaar uit: Kerncijfer, de band en de wereldkaart zoals in de basis (dd6f72a)");
{
  const uit = opDag("2026-11-14", () => ({
    kerncijferRegel: r(createElement(Kerncijfer, { label: "Conversies", waarde: "1.360", reeks: [1, 2, 3, null, 5], delta: { pct: 15.2, hogerIsBeter: true, was: "1.180" } })),
    kerncijferPil: r(createElement(Kerncijfer, { label: "CPA", waarde: "€ 57", reeks: [1, 2, 3], reeksBasis: "bereik", deltaVorm: "pil", delta: { pct: 14, hogerIsBeter: false, was: "€ 96", nu: "€ 109" } })),
    kerncijferLeeg: r(createElement(Kerncijfer, { label: "Omzet", waarde: "€ 1", formaat: "compact", delta: { pct: null, leegTekst: "nieuw in deze periode", was: "€ 0" } })),
    band: p(createElement(PeriodSummary, { data: samen, bronnen }), "uit-band"),
    bandCompact: p(createElement(PeriodSummary, { data: samen, bronnen, compact: true }), "uit-band-compact"),
    geoKaart: p(createElement(GeoMapCard, { state: geoState, channel: "meta", verdieping: createElement(GeoRanglijstInKaart, { state: geoState }) }), "uit-geo"),
  }));
  const BASIS: Record<keyof typeof uit, string> = {
    kerncijferRegel: "bc71ffd2d5194cc9b182cedd59f7e289a86f5a19822f3164ece3f13a835309dd",
    kerncijferPil: "0d6856633cd5a3676a4f32fd21270e2e36ac072c25b6ad878445f1d80e825410",
    kerncijferLeeg: "c8703cb0c8df9d353bd1f0f8bea763dd95a2163e0afa9347b2674b4dd185491a",
    band: "734f8a2c75936595271f5fa1ef8b451bb35910fb81e396e0f09263f15132f1a5",
    bandCompact: "e610857bf19f9eba79c4fd4b409d845e9d8b52ed399efbfd09929c4ac4b84163",
    geoKaart: "9eb6a89ce8d64c9998fe5318a7645d7a56a249f41aae44028382e78d1e809f96",
  };
  for (const k of Object.keys(BASIS) as (keyof typeof uit)[]) {
    check(`${k}: byte voor byte de basis`, vinger(uit[k]) === BASIS[k], `${vinger(uit[k])} (${uit[k].length} tekens)`);
  }
  check("de band draagt de uitleg over Meta (anders toetst de vingerafdruk de uitleg niet)", /staat wel in de totalen, maar niet in het percentage/.test(uit.band));
  check("de vertrouwde kaart heeft geen kaartknop en geen projectievak", !/data-geo-kaartknop|geo-kaart-projectie|max-w-\[640px\]/.test(uit.geoKaart));
}

// ── 2. Kerncijfer strak ─────────────────────────────────────────────────────────────────────────
console.log("Kerncijfer strak: verloop naast de verandering, de vorige waarde kort eronder");
{
  const strak = (delta: Record<string, unknown>, reeks: (number | null)[] | undefined = [1, 2, 3]) =>
    r(createElement(Kerncijfer, { label: "CPA", waarde: "€ 57", reeks, reeksBasis: "bereik", deltaVorm: "pil", delta: delta as never, strak: true }));
  const deel = strak({ pct: 14, hogerIsBeter: false, was: "€ 96", nu: "€ 109" });
  check("label en getal, het getal met het label als vorig element", /<p class="[^"]*uppercase[^"]*">CPA<\/p><p class="mt-1\.5 [^"]*">€ 57<\/p>/.test(deel), deel.slice(0, 300));
  check("de verandering en het verloop in één regel", /<div class="mt-1\.5 flex flex-wrap items-center gap-x-2 gap-y-1"><span class="flex flex-wrap[^"]*"><span class="inline-flex[^"]*rounded-full[^>]*>[\s\S]*?\+14%[\s\S]*?<\/span><span class="ml-auto flex shrink-0"><svg/.test(deel), deel);
  check("het verloop klein (48 px breed)", /<svg[^>]*width="48"/.test(deel));
  check("de vorige waarde met het deel staat er, op een telefoon zonder 'vergelijkbaar '",
    /<p data-wasregel="true" class="[^"]*" title="vergelijkbaar deel € 109, was € 96"><span class="max-sm:hidden">vergelijkbaar <\/span>deel € 109, was € 96<\/p>/.test(deel), deel);
  check("en de vorige waarde staat er maar één keer (niet ook in de pil)", (tekst(deel).match(/was € 96/g) ?? []).length === 1, tekst(deel));
  const heel = strak({ pct: 4, hogerIsBeter: true, was: "1.180" });
  check("zonder deel: alleen 'was'", /data-wasregel[^>]*>was 1\.180<\/p>/.test(heel) && !/vergelijkbaar/.test(heel));
  const leeg = strak({ pct: null, leegTekst: "geen vergelijking mogelijk", was: "€ 80" });
  check("zonder percentage: de tekst en de vorige waarde", /geen vergelijking mogelijk/.test(tekst(leeg)) && /was € 80/.test(tekst(leeg)));
  const zonder = r(createElement(Kerncijfer, { label: "CPA", waarde: "€ 57", strak: true }));
  check("zonder delta en verloop: alleen label en getal", tekst(zonder) === "CPA € 57", tekst(zonder));
}

// ── 3. De tegels ────────────────────────────────────────────────────────────────────────────────
console.log("Kerncijfertegels: elk cijfer en elke verandering open, de uitleg achter 'Waarom?'");
{
  const tegels = opDag("2026-11-14", () => p(createElement(PeriodSummary, { data: samen, bronnen, vorm: "tegels" }), "tegels-r3"));
  const band = opDag("2026-11-14", () => p(createElement(PeriodSummary, { data: samen, bronnen }), "band-r3"));
  const voet = tegels.indexOf("data-tegelvoet");
  const raster = tegels.slice(0, voet);
  check("geen verborgen deel tussen de tegels", voet > 0 && !/hidden=""/.test(raster) && !/max-lg:hidden|lg:hidden"|class="hidden/.test(raster));
  const waarden = [...raster.matchAll(/<p class="mt-1\.5 [^"]*">([^<]*)<\/p>/g)].map((x) => x[1].replace(/\u00A0/g, " "));
  check("vijf kerncijfers", waarden.join("|") === "2.418|€ 153.060|€ 74.566|2,05×|€ 31", waarden.join("|"));
  const pct = [...raster.matchAll(/rounded-full px-2 py-px font-semibold[^"]*"><svg[\s\S]*?<\/svg><span>([^<]+)<\/span>/g)].map((x) => x[1]);
  check("vijf veranderingen, elk bij zijn tegel", pct.join("|") === "+29%|+13%|+10%|+2,8%|-15%", pct.join("|"));
  for (const w of ["deel 1.902, was 1.470", "deel € 133.740, was € 117.900", "deel € 56.658, was € 51.330", "deel 2,36×, was 2,30×", "deel € 30, was € 35"]) {
    check(`de vorige waarde staat bij zijn tegel: ${w}`, tekst(raster).includes(w));
  }
  check("vijf verloopjes, in de regel van de verandering", (raster.match(/<span class="ml-auto flex shrink-0"><svg/g) ?? []).length === 5);
  check("de periode is de zesde cel van het raster (naast CPA op een telefoon), vanaf sm over de volle breedte",
    /<div data-tegelvoet="true" class="[^"]*sm:col-span-3[^"]*lg:col-span-5[^"]*">/.test(tegels) && /data-tegelvoet[\s\S]*volgt periode[\s\S]*vergeleken met november 2024/.test(tegels));
  const kern = ongepaardKern([{ naam: "google", ongepaardHuidig: 0, ongepaardVorig: 0, gepaard: 12 }, { naam: "meta", ongepaardHuidig: 8, ongepaardVorig: 0, gepaard: 0 }] as unknown as BronPaar[]);
  check("de kern in één zin", kern === "Meta telt nog niet mee in het percentage.", String(kern));
  check("de kern staat open, buiten de uitklap", /<div data-percentage-uitleg="true" [^>]*><span>Meta telt nog niet mee in het percentage\.<\/span><button/.test(tegels), tegels.slice(tegels.indexOf("data-percentage-uitleg"), tegels.indexOf("data-percentage-uitleg") + 300));
  const u = uitklap(tegels, "kerncijfers-percentage-waarom");
  const zin = "Meta (sinds maart 2026) staat wel in de totalen, maar niet in het percentage: in november 2024 t/m oktober 2025 liep het nog niet.";
  check("'Waarom?' is een knop met aria-expanded=false, een zichtbaar label en 44 px", !!u && !u.open && u.knop === "Waarom?" && /<button[^>]*aria-controls="uitklap-kerncijfers-percentage-waarom"[^>]*class="[^"]*min-h-11/.test(tegels), JSON.stringify(u?.knop));
  check("de volle zin staat in de boom, achter de knop (hidden)", !!u && u.verborgen && !!u.inhoud && tekst(u.inhoud).startsWith(zin), u?.inhoud?.slice(0, 200));
  check("en het is letterlijk de zin van de band", band.includes(zin));
  check("de pijl draait niet bij 'minder beweging'", /aria-controls="uitklap-kerncijfers-percentage-waarom"[^>]*><svg[^>]*motion-reduce:transition-none/.test(tegels));
  // Meer kanalen: het aantal, en "deels" als ze wel deels meetellen.
  const twee = ongepaardKern([{ naam: "meta", ongepaardHuidig: 3, ongepaardVorig: 0, gepaard: 5 }, { naam: "linkedin", ongepaardHuidig: 0, ongepaardVorig: 2, gepaard: 4 }] as unknown as BronPaar[]);
  check("twee kanalen die deels meetellen", twee === "2 kanalen tellen maar deels mee in het percentage.", String(twee));
  const gemengd = ongepaardKern([{ naam: "meta", ongepaardHuidig: 3, ongepaardVorig: 0, gepaard: 0 }, { naam: "linkedin", ongepaardHuidig: 1, ongepaardVorig: 0, gepaard: 4 }, { naam: "microsoft", ongepaardHuidig: 2, ongepaardVorig: 0, gepaard: 0 }] as unknown as BronPaar[]);
  check("drie kanalen, gemengd", gemengd === "3 kanalen tellen niet of maar deels mee in het percentage.", String(gemengd));
  check("alles gepaard: geen kern", ongepaardKern([{ naam: "google", ongepaardHuidig: 0, ongepaardVorig: 0, gepaard: 12 }] as unknown as BronPaar[]) === null);
  check("één bron zonder kanaalnaam, vergelijking op de laadgrens: niet geladen, niet 'nog geen'",
    ongepaardKern([{ naam: "totaal", ongepaardHuidig: 12, ongepaardVorig: 0, gepaard: 0, start: "2023-11", geladenVanaf: "2023-11" }] as unknown as BronPaar[]) === "De vergelijkingsperiode is niet geladen.");
  check("één bron zonder kanaalnaam, echt nog geen vergelijking",
    ongepaardKern([{ naam: "totaal", ongepaardHuidig: 12, ongepaardVorig: 0, gepaard: 0, start: "2026-03", geladenVanaf: "2023-11" }] as unknown as BronPaar[]) === "Er is nog geen vergelijkingsperiode om het percentage tegen af te zetten.");
  check("één bron zonder kanaalnaam (een kanaaltab)", ongepaardKern([{ naam: "totaal", ongepaardHuidig: 4, ongepaardVorig: 0, gepaard: 8 }] as unknown as BronPaar[]) === "Het percentage gaat over een deel van de maanden.");
}

// ── 4. De wereldkaart met de lijst ernaast ─────────────────────────────────────────────────────
console.log("Wereldkaart: de lijst de hoofdvorm op een telefoon, de projectie achter 'Toon de kaart'");
{
  const kaart = opDag("2026-11-14", () => p(createElement(GeoMapCard, {
    state: geoMetVerandering, channel: "blended", naast: createElement(GeoRanglijstInKaart, { state: geoMetVerandering, naast: true }),
  }), "geo-r3"));
  const knop = /<button type="button" aria-expanded="(true|false)" aria-controls="geo-kaart-projectie" data-geo-kaartknop="true" class="([^"]*)">([\s\S]*?)<\/button>/.exec(kaart);
  check("een knop met aria-expanded=false en een label dat zegt wat erachter zit", !!knop && knop[1] === "false" && tekst(knop[3]) === "Toon de kaart (5 landen)", knop ? tekst(knop[3]) : kaart.slice(0, 300));
  check("tikvlak 44 px, focusring, alleen onder lg", !!knop && /min-h-11/.test(knop[2]) && /focus-visible:ring-2/.test(knop[2]) && /\blg:hidden\b/.test(knop[2]));
  check("de projectie staat in de boom, onder lg verborgen, vanaf lg open", /<div id="geo-kaart-projectie" data-geo-projectie="dicht" class="px-3 py-3 lg:block max-lg:hidden">/.test(kaart));
  check("de lijst staat op een telefoon boven de projectie (order)", /class="min-w-0 max-lg:order-1 /.test(kaart) && /max-lg:order-2/.test(kaart));
  check("op een breed scherm iets smaller: 640 in plaats van 760 px", /max-w-\[640px\]/.test(kaart) && !/max-w-\[760px\]/.test(kaart));
  // De top 3: naam, getal en verandering, niet verborgen.
  const regels = [...kaart.matchAll(/<li class="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g)].map((x) => ({ klasse: x[1], tekst: tekst(x[2]) }));
  const top = regels.slice(0, 3);
  check("de top 3 landen met getal en verandering, open op elke breedte",
    top.length === 3 && top.every((x) => !/hidden/.test(x.klasse))
      && /^1 Nederland 420 \+12,4%/.test(top[0].tekst) && /^2 Duitsland 260 -8(,0)?%/.test(top[1].tekst) && /^3 België 140 \+3(,0)?%/.test(top[2].tekst),
    JSON.stringify(top));
  check("land 4 en 5 staan in de boom, onder lg achter de knop", regels.length === 5 && regels.slice(3).every((x) => /max-lg:hidden/.test(x.klasse)));
  check("en die knop noemt het aantal", /Toon 2 landen meer/.test(tekst(kaart)));
}

// ── 5. Kanaalkaarten ────────────────────────────────────────────────────────────────────────────
console.log("Kanaalkaarten: de veegstrook, de regel cijfers past op een telefoon");
{
  const kaarten: Kanaalkaart[] = (["google", "meta"] as const).map((kanaal, i) => ({
    kanaal, health: { soort: "laden" }, stand: { tekst: "data t/m 31 okt", alarm: false },
    cijfers: { kanaal, conversions: 900 - i * 400, adSpend: 40000 - i * 20000, aandeelConversies: 69 - i * 38, aandeelKosten: 67 - i * 34, cpa: 44 } as never,
  }));
  const html = p(createElement(Kanaalkaarten, { kaarten, gekozen: "blended", onKies: () => {} }), "kaarten-r3");
  check("alle kaarten in de boom, met hun beschrijving", (html.match(/id="kanaalkaart-/g) ?? []).length === 2);
  check("snap binnen de eigen strook, zonder de pagina mee te slepen", /snap-x snap-mandatory/.test(html) && /overscroll-x-contain/.test(html) && /overflow-x-auto/.test(html));
  check("op een telefoon '67% kosten', vanaf sm '67% van de kosten'", /67% <span class="max-sm:hidden">van de <\/span>kosten/.test(html));
  check("de beschrijving zegt het voluit", /Kosten: € 40\.000, 67 procent van alle kanalen/.test(tekst(html)));
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);
