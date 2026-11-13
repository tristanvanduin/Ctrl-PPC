// De bovenkant van het Overzicht in de nieuwe weergave (bouwplan fase 3).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_bovenkant_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Fase 3 zet drie blokken onder elkaar die over dezelfde periode gaan: de kanaalkaarten, de
// kerncijfertegels en de hoofdgrafiek. De fout die daarbij op de loer ligt is dezelfde die fase 2
// heeft opgeruimd: drie blokken, drie optellingen, en dan staan er op één scherm totalen die een
// paar conversies verschillen. En alles staat achter een schakelaar: wie hem niet aanzet, moet het
// Overzicht zien zoals het was. Deze test houdt vast:
//
// - DE SCHAKELAAR: standaard uit; de adresbalk (?weergave=) gaat voor de bewaarde keuze; uit geeft
//   de vertrouwde boom (kanaaltabs en band), aan de nieuwe (OverzichtBovenkant), en in beide staan
//   dezelfde onderdelen van de kop. Niets verdwijnt.
// - DE KAARTEN: de aandelen in kosten en conversies tellen op tot precies 100, een klik kiest het
//   kanaal en nog een klik op dezelfde kaart is terug naar alle kanalen.
// - DE GRAFIEK: de som per maand is het totaal van de band over dezelfde periode, voor alle
//   kanalen samen en voor elk kanaal apart.
// - DE TEGELS: dezelfde cijfers en dezelfde uitlegregels als de band, één tegel met nadruk, de
//   verandering als pil.
// - DE OPBOUW: hooguit 600 ms bij het eerste bezoek en 400 ms bij een wissel, en uit bij "minder
//   beweging".
//
// De rekenkant wordt echt uitgevoerd en de onderdelen worden echt gerenderd (react-dom/server).
// Het klantdashboard zelf is te groot om te mounten; daar leest de test de bron.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { kiesWeergave, weergaveUitUrl, weergaveCookie, WEERGAVE_PARAM, WEERGAVE_SLEUTEL } from "./weergave";
import { useWeergave } from "./use-weergave";
import {
  volgendeKanaalkeuze, heleProcenten, kaartCijfers, kanaalTotalen, grafiekMaanden, nadrukIndex, kaartStand,
  NADRUK_VANAF_PCT,
} from "./overzicht/bovenkant";
import { DUUR, OPBOUW_MAX, opbouwVertraging } from "./beweging";
import { alsBronReeks, slicePeriod, type BronReeks } from "./period/apply-period";
import { bouwHistorischeData, samenvoegen, type MaandTotaal } from "./period/kanaal-maanden";
import { monthsIn, type PeriodRange } from "./period/period-range";
import { PeriodProvider } from "./period/period-context";
import { ALLE_KANALEN, KANAAL_NAAM, kanaalkeuzeUitUrl, type Kanaal, type Kanaalkeuze } from "./kanalen/beschikbaar";
import type { ClientHistoricalData } from "./types";
import type { HealthScore } from "./health-score";
import { Kanaalkaarten, type Kanaalkaart } from "../components/dashboard/kanaalkaarten";
import { PeriodSummary } from "../components/dashboard/period-summary";
import { Kerncijfer } from "../components/ui/kerncijfer";
import { WeergaveSchakelaar } from "../components/dashboard/weergave-schakelaar";
import { BrandHeaderBar } from "../components/branding/brand-header-bar";
import { OverzichtBovenkant } from "../components/dashboard/overzicht-bovenkant";
import { OverzichtHoofdgrafiek } from "../components/dashboard/overzicht-hoofdgrafiek";
import type { ChannelPeriodData } from "./use-channel-period-data";
import { addDays, today } from "./reporting-date";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const wortel = join(import.meta.dirname, "..");
const lees = (pad: string) => readFileSync(join(wortel, pad), "utf8");
const zonderCommentaar = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const som = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);

// ── Vaste data: vier kanalen over twee jaar, met gaten en een laat begonnen kanaal ─────────────
// Google loopt de hele tijd; Meta begint in maart 2026 en heeft halve conversies (Meta telt in
// breuken); LinkedIn pauzeert in juni 2026; Microsoft heeft alleen in 2026 data, zonder omzet.
function reeks(van: string, tot: string, maak: (i: number, sleutel: string) => Omit<MaandTotaal, "year" | "month"> | null): MaandTotaal[] {
  return monthsIn({ start: van, end: tot }).flatMap((k, i) => {
    const m = maak(i, k);
    return m ? [{ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), ...m }] : [];
  });
}
const JAAR = 2026;
const DATA: Record<Kanaal, ClientHistoricalData> = {
  google: bouwHistorischeData("t", reeks("2024-09", "2026-08", (i) => ({ conversions: 100 + i * 3, revenue: 9000 + i * 110, adSpend: 4000 + i * 37 })), JAAR),
  meta: bouwHistorischeData("t", reeks("2026-03", "2026-08", (i) => ({ conversions: 40.5 + i * 7.25, revenue: 2100 + i * 90, adSpend: 1500 + i * 211 })), JAAR),
  linkedin: bouwHistorischeData("t", reeks("2025-11", "2026-08", (i, k) => (k === "2026-06" ? null : { conversions: 12 + i, revenue: 0, adSpend: 1900 + i * 13 })), JAAR),
  microsoft: bouwHistorischeData("t", reeks("2026-01", "2026-08", (i) => ({ conversions: 5 + (i % 3), revenue: 0, adSpend: 300 + i * 11 })), JAAR),
};
const PER_KANAAL: Record<Kanaal, BronReeks> = {
  google: alsBronReeks("google", DATA.google),
  meta: alsBronReeks("meta", DATA.meta),
  linkedin: alsBronReeks("linkedin", DATA.linkedin),
  microsoft: alsBronReeks("microsoft", DATA.microsoft),
};
const SAMEN = samenvoegen("t", ALLE_KANALEN.map((k) => DATA[k]), JAAR);
const PERIODES: PeriodRange[] = [
  { start: "2026-06", end: "2026-08" },   // drie maanden, met de LinkedIn-pauze erin
  { start: "2026-03", end: "2026-08" },   // zes maanden, vanaf het begin van Meta
  { start: "2025-09", end: "2026-08" },   // twaalf maanden, over de jaargrens
  { start: "2024-09", end: "2025-02" },   // alleen Google
  { start: "2023-01", end: "2023-03" },   // vóór alle data
];
const bijna = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// ── 1. De schakelaar ───────────────────────────────────────────────────────────────────────────
console.log("De schakelaar: standaard uit, de adresbalk gaat voor");
{
  check("zonder iets: de vertrouwde weergave", kiesWeergave({ url: null, bewaard: null }) === "oud");
  check("een bewaarde keuze 'nieuw' zet hem aan", kiesWeergave({ url: null, bewaard: "nieuw" }) === "nieuw");
  check("een bewaarde keuze 'oud' houdt hem uit", kiesWeergave({ url: null, bewaard: "oud" }) === "oud");
  check("?weergave=nieuw zet hem aan zonder bewaarde keuze (de meting)", kiesWeergave({ url: "nieuw", bewaard: null }) === "nieuw");
  check("?weergave=nieuw gaat voor een bewaarde 'oud'", kiesWeergave({ url: "nieuw", bewaard: "oud" }) === "nieuw");
  check("?weergave=oud gaat voor een bewaarde 'nieuw'", kiesWeergave({ url: "oud", bewaard: "nieuw" }) === "oud");
  check("onzin in de adresbalk telt niet", kiesWeergave({ url: "NIEUW", bewaard: null }) === "oud" && kiesWeergave({ url: "1", bewaard: "nieuw" }) === "nieuw");
  check("onzin in de opslag telt niet", kiesWeergave({ url: null, bewaard: "true" }) === "oud" && kiesWeergave({ url: null, bewaard: "" }) === "oud");
  check("weergaveUitUrl kent alleen 'nieuw' en 'oud'", weergaveUitUrl("nieuw") === "nieuw" && weergaveUitUrl("oud") === "oud"
    && weergaveUitUrl(null) === null && weergaveUitUrl(undefined) === null && weergaveUitUrl("blended") === null);
  check("de parameter en de sleutel hebben een vaste naam", WEERGAVE_PARAM === "weergave" && WEERGAVE_SLEUTEL === "overzicht-weergave");

  // De hook, zoals de server hem rendert (geen localStorage): de adresbalk, dan de cookie, dan "oud".
  const Toon = ({ url, cookie = null }: { url: string | null; cookie?: string | null }) => createElement("i", null, useWeergave(url, cookie)[0]);
  const server = (url: string | null, cookie: string | null = null) => tekst(renderToStaticMarkup(createElement(Toon, { url, cookie })));
  check("de hook rendert zonder opslag de adresbalk", server("nieuw") === "nieuw");
  check("en zonder adresbalk de vertrouwde weergave", server(null) === "oud");
  check("met de cookie rendert de server meteen de gekozen weergave (geen sprong bij het laden)", server(null, "nieuw") === "nieuw" && server(null, "oud") === "oud");
  check("de adresbalk gaat ook op de server voor de cookie", server("oud", "nieuw") === "oud" && server("nieuw", "oud") === "nieuw");
  check("een onbekende cookie telt niet", server(null, "1") === "oud");
  check("de cookie draagt dezelfde naam als de opslag en geldt voor de hele site", weergaveCookie("nieuw") === `${WEERGAVE_SLEUTEL}=nieuw; path=/; max-age=31536000; samesite=lax`);
  const pagina = zonderCommentaar(lees("app/(app)/client/[clientId]/page.tsx"));
  check("de serverpagina leest de cookie en geeft hem door", /koekjes\.get\(WEERGAVE_SLEUTEL\)\?\.value \?\? null/.test(pagina) && /bewaardeWeergave=\{bewaardeWeergave\}/.test(pagina));
  const hook = zonderCommentaar(lees("lib/use-weergave.ts"));
  check("localStorage is de bron, de cookie de kopie", /window\.localStorage\.setItem\(WEERGAVE_SLEUTEL, w\)/.test(hook) && /schrijfCookie\(w\)/.test(hook));
  check("de schakelaar haalt ?weergave= uit het adres, als vervanging", /schrijfAdresbalk\(\(p\) => p\.delete\(WEERGAVE_PARAM\), "replace"\)/.test(hook));
  check("de regels zijn zuiver: lib/weergave.ts kent React en de browser niet", !/from "react"|window\.|document\.|"use client"/.test(zonderCommentaar(lees("lib/weergave.ts"))));

  // De knop zelf: een schakelaar met een vaste naam, in beide standen.
  const uit = renderToStaticMarkup(createElement(WeergaveSchakelaar, { weergave: "oud", onKies: () => {} }));
  const aan = renderToStaticMarkup(createElement(WeergaveSchakelaar, { weergave: "nieuw", onKies: () => {} }));
  check("de schakelaar is een switch die uit staat", /role="switch"/.test(uit) && /aria-checked="false"/.test(uit), uit.slice(0, 160));
  check("en aan staat in de nieuwe weergave", /aria-checked="true"/.test(aan));
  check("hij heet in beide standen 'Nieuwe weergave'", tekst(uit) === "Nieuwe weergave" && tekst(aan) === "Nieuwe weergave", `${tekst(uit)} / ${tekst(aan)}`);
}

console.log("De schakelaar in het klantdashboard: uit is de vertrouwde boom, aan de nieuwe");
{
  const dash = zonderCommentaar(lees("components/dashboard/client-dashboard.tsx"));
  check("de weergave komt uit de adresbalk, de cookie van de server en de opslag", /const \[weergave, zetWeergave\] = useWeergave\(searchParams\.get\(WEERGAVE_PARAM\), bewaardeWeergave\)/.test(dash)
    && /const nieuweWeergave = weergave === "nieuw"/.test(dash));
  const begin = dash.indexOf("{nieuweWeergave ? (");
  const midden = dash.indexOf(") : (", begin);
  const eind = dash.indexOf("</>\n      )}", midden);
  check("de kop kiest tussen twee takken", begin > 0 && midden > begin && eind > midden, `${begin} / ${midden} / ${eind}`);
  const nieuw = dash.slice(begin, midden);
  const oud = dash.slice(midden, eind);
  check("AAN: de nieuwe bovenkant, zonder de kanaaltabs en de band", /<OverzichtBovenkant\b/.test(nieuw) && !/<ChannelTabs\b/.test(nieuw) && !/<PeriodSummary\b/.test(nieuw));
  check("AAN: de compacte merkregel", /<BrandHeaderBar compact /.test(nieuw));
  check("UIT: de kanaaltabs en de band, zonder de nieuwe bovenkant", /<ChannelTabs\b/.test(oud) && /<PeriodSummary\b/.test(oud) && !/<OverzichtBovenkant\b/.test(oud));
  check("UIT: de hero zoals hij was", /<BrandHeaderBar geoClone=\{geoClone\} fallbackName=\{client\.name\} edition=\{upcomingEdition\} \/>/.test(oud) && !/compact/.test(oud));
  // Zolang hij laadt, staan er de cijfers die de server al uit het zaad rekende, in dezelfde vorm
  // (band-uit-zaad.tsx; het gedrag zelf staat in lib/overzicht/__band_uit_zaad_test.ts).
  check("UIT: de band krijgt geen andere vorm mee", /<PeriodSummary data=\{bandKlaar \? periodSummary\.data : null\} bronnen=\{periodSummary\.bronnen\} laden=\{!bandKlaar\}\s+zolangLaden=\{bandZaad && <BandUitZaad zaad=\{bandZaad\} \/>\} \/>/.test(oud));
  // Niets verdwijnt: elk onderdeel van de kop staat in beide takken.
  for (const deel of ["{periodeKiezer}", "{schakelaar}", "{bronrij}", "{geenDataMelding}", "{tabnav}", "{codeRood}"]) {
    check(`${deel} staat in beide weergaven`, nieuw.includes(deel) && oud.includes(deel));
  }
  check("de volgorde van de vertrouwde weergave is die van vroeger",
    ["<BrandHeaderBar ", "{periodeKiezer}", "{bronrij}", "{geenDataMelding}", "{tabnav}", "{codeRood}", "<ChannelTabs ", "<PeriodSummary "]
      .map((d) => oud.indexOf(d)).every((p, i, a) => p >= 0 && (i === 0 || p > a[i - 1])));
  check("de nieuwe bovenkant staat alleen op het Overzicht en niet naast een fout",
    /\{activeTab === "dashboard" && !clientData\.error && \(\s*<OverzichtBovenkant\b/.test(nieuw));
  check("een klik op een kaart gaat via dezelfde kanaalkeuze als de tabs (?kanaal=)", /onKies=\{setChannel\}/.test(nieuw) && /onChange=\{setChannel\}/.test(oud));
  check("de schakelaar staat op het Overzicht, en in de nieuwe weergave overal", /const schakelaar = \(activeTab === "dashboard" \|\| nieuweWeergave\) && \(/.test(dash));
  // De nieuwe bovenkant haalt niets op: geen fetch, geen dbSelect, geen eigen route.
  const boven = zonderCommentaar(lees("components/dashboard/overzicht-bovenkant.tsx"));
  check("de nieuwe bovenkant doet geen verzoek (een wissel kost er geen)", !/\bfetch\(|dbSelect\(|useBlendedClientData\(|useClientData\(/.test(boven));
  check("hij leest de health uit dezelfde toewijzing als de ranking", /kanaalScores\(lijst, google\.health,/.test(boven));
  check("en toont de band als tegels", /<PeriodSummary [^>]*vorm="tegels"/.test(boven));
}

// ── 2. De kaarten ──────────────────────────────────────────────────────────────────────────────
console.log("Kanaalkaarten: de aandelen tellen op tot 100");
{
  check("drie gelijke delen: 34 + 33 + 33", JSON.stringify(heleProcenten([1, 1, 1])) === "[34,33,33]", JSON.stringify(heleProcenten([1, 1, 1])));
  check("12,5 / 12,5 / 75: 13 + 12 + 75, niet 101", JSON.stringify(heleProcenten([1, 1, 6])) === "[13,12,75]", JSON.stringify(heleProcenten([1, 1, 6])));
  check("één deel: 100", JSON.stringify(heleProcenten([42])) === "[100]");
  check("een kanaal zonder kosten krijgt 0, de rest telt op tot 100", JSON.stringify(heleProcenten([0, 3, 1])) === "[0,75,25]");
  check("niets te verdelen: geen aandelen (geen 0%)", heleProcenten([0, 0]) === null && heleProcenten([]) === null);
  check("een ongeldige waarde: geen aandelen", heleProcenten([1, Number.NaN]) === null && heleProcenten([1, -1]) === null);
  // Veel willekeurige verdelingen (vaste zaad): altijd precies 100, nooit negatief, nooit meer dan één punt naast exact.
  let zaad = 12345;
  const volgende = () => { zaad = (zaad * 1103515245 + 12345) % 2147483648; return zaad / 2147483648; };
  let fout = "";
  for (let n = 0; n < 2000 && !fout; n += 1) {
    const waarden = Array.from({ length: 2 + Math.floor(volgende() * 3) }, () => (volgende() < 0.15 ? 0 : Math.round(volgende() * 100000) / 100));
    const p = heleProcenten(waarden);
    const totaal = som(waarden);
    if (totaal <= 0) { if (p !== null) fout = `nul-totaal gaf ${JSON.stringify(p)}`; continue; }
    if (!p || som(p) !== 100) fout = `${JSON.stringify(waarden)} -> ${JSON.stringify(p)}`;
    else if (p.some((v, i) => v < 0 || Math.abs(v - (waarden[i] / totaal) * 100) >= 1)) fout = `afwijking: ${JSON.stringify(waarden)} -> ${JSON.stringify(p)}`;
  }
  check("2000 willekeurige verdelingen: altijd precies 100, elk deel binnen één punt van exact", fout === "", fout);

  for (const periode of PERIODES.slice(0, 3)) {
    const kaarten = kaartCijfers(PER_KANAAL, ALLE_KANALEN, periode);
    check(`${periode.start}..${periode.end}: vier kaarten in de vaste volgorde`, !!kaarten && kaarten.map((k) => k.kanaal).join() === ALLE_KANALEN.join());
    if (!kaarten) continue;
    check(`${periode.start}..${periode.end}: aandeel in de kosten telt op tot 100`, som(kaarten.map((k) => k.aandeelKosten ?? 0)) === 100, JSON.stringify(kaarten.map((k) => k.aandeelKosten)));
    check(`${periode.start}..${periode.end}: aandeel in de conversies telt op tot 100`, som(kaarten.map((k) => k.aandeelConversies ?? 0)) === 100, JSON.stringify(kaarten.map((k) => k.aandeelConversies)));
    // De kaarten samen zijn de band: dezelfde reeksen, dezelfde periode.
    const band = slicePeriod(SAMEN, periode).totals;
    check(`${periode.start}..${periode.end}: de conversies van de kaarten samen zijn die van de band`, bijna(som(kaarten.map((k) => k.conversions)), band.conversions), `${som(kaarten.map((k) => k.conversions))} / ${band.conversions}`);
    check(`${periode.start}..${periode.end}: de kosten ook`, bijna(som(kaarten.map((k) => k.adSpend)), band.adSpend));
    check(`${periode.start}..${periode.end}: de CPA is kosten gedeeld door conversies`, kaarten.every((k) => (k.conversions > 0 ? bijna(k.cpa ?? -1, k.adSpend / k.conversions) : k.cpa === null)));
  }
  const alleenGoogle = kaartCijfers(PER_KANAAL, ALLE_KANALEN, PERIODES[3]);
  check("een periode waarin alleen Google liep: Google 100, de rest 0", JSON.stringify(alleenGoogle?.map((k) => k.aandeelKosten)) === "[100,0,0,0]" && JSON.stringify(alleenGoogle?.map((k) => k.aandeelConversies)) === "[100,0,0,0]");
  check("zonder conversies geen CPA (geen bedrag dat een prijs suggereert)", alleenGoogle?.[1].cpa === null);
  const leeg = kaartCijfers(PER_KANAAL, ALLE_KANALEN, PERIODES[4]);
  check("een periode zonder data: geen aandelen, wel nullen", !!leeg && leeg.every((k) => k.aandeelKosten === null && k.aandeelConversies === null && k.conversions === 0));
  const twee = kaartCijfers(PER_KANAAL, ["meta", "google"], PERIODES[1]);
  check("twee kanalen: de aandelen gaan over die twee", !!twee && twee.length === 2 && twee[0].kanaal === "google" && som(twee.map((k) => k.aandeelKosten ?? 0)) === 100);
  check("zolang een kanaal nog laadt: geen cijfers (geen aandelen over minder kanalen)", kaartCijfers({ google: PER_KANAAL.google }, ["google", "meta"], PERIODES[1]) === null);
  check("de aandelen hangen niet af van het gekozen kanaal (de functie kent het niet)", kaartCijfers.length === 3);
  check("kanaalTotalen zonder reeks is nul", JSON.stringify(kanaalTotalen(undefined, PERIODES[0])) === JSON.stringify({ conversions: 0, revenue: 0, adSpend: 0 }));
}

console.log("Kanaalkaarten: een klik kiest, nog een klik is terug");
{
  check("vanaf alle kanalen: een klik kiest het kanaal", volgendeKanaalkeuze("blended", "meta") === "meta");
  check("nog een klik op dezelfde kaart: terug naar alle kanalen", volgendeKanaalkeuze("meta", "meta") === "blended");
  check("een klik op een andere kaart: dat kanaal", volgendeKanaalkeuze("meta", "google") === "google");
  check("twee klikken op dezelfde kaart komen altijd terug waar je begon, vanaf alle kanalen",
    ALLE_KANALEN.every((k) => volgendeKanaalkeuze(volgendeKanaalkeuze("blended", k), k) === "blended"));
  // De keuze gaat door dezelfde adresbalklezing als de tabs: wat een kaart kiest, toont de pagina.
  const keuzes: Kanaalkeuze[] = ["blended", ...ALLE_KANALEN];
  check("wat een kaart kiest is een geldige kanaalkeuze voor de adresbalk",
    keuzes.every((h) => ALLE_KANALEN.every((k) => { const n = volgendeKanaalkeuze(h, k); return kanaalkeuzeUitUrl(n === "blended" ? null : n, ALLE_KANALEN) === n; })));

  const health = (total: number): HealthScore => ({ total, grade: "B", color: "", assessedCount: 4, anomalies: [], factors: [
    { name: "Doelstelling", score: 15, maxScore: 20, description: "", assessed: true },
    { name: "Trend", score: 2, maxScore: 20, description: "", assessed: true },
    { name: "Hygiëne", score: 0, maxScore: 20, description: "", assessed: false },
  ] });
  const cijfers = kaartCijfers(PER_KANAAL, ALLE_KANALEN, PERIODES[1])!;
  const kaarten: Kanaalkaart[] = cijfers.map((c, i) => ({
    kanaal: c.kanaal, cijfers: c,
    health: i === 0 ? { soort: "score", health: health(93) } : i === 1 ? { soort: "score", health: health(55) } : i === 2 ? { soort: "laden" } : { soort: "geen", reden: "niet beoordeeld: geen dagcijfers" },
    stand: i === 3 ? { tekst: "stil sinds 1 mei 2026", alarm: true } : { tekst: "data t/m 26 aug 2026", alarm: false },
  }));
  const html = (gekozen: Kanaalkeuze, lijst = kaarten) => renderToStaticMarkup(createElement(Kanaalkaarten, { kaarten: lijst, gekozen, onKies: () => {} }));
  const knoppen = (h: string) => [...h.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  const alle = html("blended");
  check("vier kaarten zijn vier knoppen", knoppen(alle).length === 4, String(knoppen(alle).length));
  check("elke kaart is een echte knop met de kanaalnaam", ALLE_KANALEN.every((k) => knoppen(alle).some((b) => b.includes('type="button"') && b.includes(`aria-label="${KANAAL_NAAM[k]}"`))));
  check("op alle kanalen is geen kaart ingedrukt", knoppen(alle).every((b) => b.includes('aria-pressed="false"')));
  const meta = html("meta");
  check("op Meta is alleen de Meta-kaart ingedrukt", knoppen(meta).filter((b) => b.includes('aria-pressed="true"')).length === 1
    && knoppen(meta).some((b) => b.includes('aria-label="Meta"') && b.includes('aria-pressed="true"')));
  check("elke knop heeft een zichtbare focusring", knoppen(alle).every((b) => /focus-visible:outline-2/.test(b)));
  check("de beschrijving van een kaart noemt de aandelen en de health", /Health 93 van 100\./.test(tekst(alle)) && /procent van alle kanalen/.test(tekst(alle)));
  // Het venster: de kaarten volgen de periode en zeggen dat, voor de meting (data-venster) en voor
  // een schermlezer; en geen kaart schrijft een los "N conversies" dat als paginatotaal leest.
  check("de rij kaarten draagt het vensterlabel van de periode", /<span class="sr-only"><span data-venster="periode"/.test(alle));
  check("elke kaart noemt de periode in zijn uitleg", (alle.match(/Cijfers over [^"]*\d{4}\./g) ?? []).length === 4);
  check("een kaart schrijft zijn kanaalcijfer niet als paginatotaal ('N conversies')", !/\d\s+conversies\b/i.test(tekst(alle)), tekst(alle).slice(0, 300));
  check("een kanaal zonder score zegt waarom, een ladend kanaal dat het berekend wordt", /Health niet beoordeeld: geen dagcijfers\./.test(tekst(alle)) && /Health wordt berekend\./.test(tekst(alle)));
  check("de datastand staat op de kaart, en een stilstaand kanaal in rood", /data t\/m 26 aug 2026/.test(tekst(alle)) && /text-red-700[^"]*"[^>]*>stil sinds 1 mei 2026/.test(alle));
  check("de aandelen op de kaarten tellen op tot 100", som([...alle.matchAll(/(\d+)% van de kosten/g)].map((m) => Number(m[1]))) === 100, JSON.stringify([...alle.matchAll(/(\d+)% van de kosten/g)].map((m) => m[1])));
  check("een gekozen kaart zegt hoe je teruggaat", /nog een klik toont alle kanalen/.test(tekst(meta)) && !/nog een klik toont alle kanalen/.test(tekst(alle)));
  check("op een telefoon schuift de rij, de pagina niet", /overflow-x-auto/.test(alle) && /sm:grid/.test(alle));
  check("met één kanaal staat er geen filter (een kiezer met één knop is geen keuze)", html("google", kaarten.slice(0, 1)) === "" && html("blended", []) === "");
  const ladend = html("blended", kaarten.map((k) => ({ ...k, cijfers: null })));
  check("zonder cijfers staan de kaarten er al, zonder getal", knoppen(ladend).length === 4 && /Cijfers worden geladen\./.test(tekst(ladend)) && !/% van de kosten/.test(ladend));
}

console.log("Kanaalkaarten: de datastand");
{
  const nu = "2026-11-11";
  check("recente data: 'data t/m', geen alarm", JSON.stringify(kaartStand({ dataTot: "2026-11-10", vandaag: nu })) === JSON.stringify({ tekst: "data t/m 10 nov 2026", alarm: false }));
  check("15 dagen oud: stil, in rood", kaartStand({ dataTot: "2026-10-27", vandaag: nu })?.alarm === true && kaartStand({ dataTot: "2026-10-27", vandaag: nu })?.tekst === "stil sinds 27 okt 2026");
  check("14 dagen oud: nog niet stil, zelfde grens als de dagstand", kaartStand({ dataTot: "2026-10-28", vandaag: nu })?.alarm === false);
  check("een dag minder: nog geen alarm", kaartStand({ dataTot: "2026-10-29", vandaag: nu })?.alarm === false);
  check("achter terwijl de sync draait (gepauzeerd): geen alarm, wel de dag", JSON.stringify(kaartStand({ dataTot: "2026-05-12", vandaag: nu, achterMaarSyncDraait: true })) === JSON.stringify({ tekst: "geen data na 12 mei 2026", alarm: false }));
  check("de demo is nooit rood en heet demodata", JSON.stringify(kaartStand({ dataTot: "2026-08-26", vandaag: nu, demo: true })) === JSON.stringify({ tekst: "demodata t/m 26 aug 2026", alarm: false }));
  check("geen dag: 'geen data'", kaartStand({ dataTot: null, vandaag: nu })?.tekst === "geen data" && kaartStand({ dataTot: "onzin", vandaag: nu })?.tekst === "geen data");
  check("nog niet bekend: de kaart zegt niets", kaartStand({ dataTot: null, vandaag: nu, bekend: false }) === null);
}

// ── 3. De grafiek ──────────────────────────────────────────────────────────────────────────────
console.log("Hoofdgrafiek: de som per maand is de band over dezelfde periode");
{
  for (const periode of PERIODES) {
    const naam = `${periode.start}..${periode.end}`;
    const rijen = grafiekMaanden(PER_KANAAL, ALLE_KANALEN, periode);
    const band = slicePeriod(SAMEN, periode).totals;
    check(`${naam}: elke maand van de periode staat erin, ook een lege`, rijen.map((r) => r.maand).join() === monthsIn(periode).join());
    check(`${naam}: som conversies == band`, bijna(som(rijen.map((r) => r.conversions)), band.conversions), `${som(rijen.map((r) => r.conversions))} / ${band.conversions}`);
    check(`${naam}: som kosten == band`, bijna(som(rijen.map((r) => r.adSpend)), band.adSpend));
    check(`${naam}: som omzet == band`, bijna(som(rijen.map((r) => r.revenue)), band.revenue));
    check(`${naam}: per maand is het totaal de stapel van de kanalen`, rijen.every((r) => bijna(r.conversions, som(ALLE_KANALEN.map((k) => r.perKanaal[k]?.conversions ?? 0)))));
    check(`${naam}: de CPA per maand is kosten gedeeld door conversies, of niets`, rijen.every((r) => (r.conversions > 0 ? bijna(r.cpa ?? -1, r.adSpend / r.conversions) : r.cpa === null)));
    // Op een gekozen kanaal: dat kanaal, en zijn band.
    for (const kanaal of ALLE_KANALEN) {
      const eigen = grafiekMaanden(PER_KANAAL, [kanaal], periode);
      const eigenBand = slicePeriod(DATA[kanaal], periode).totals;
      check(`${naam} op ${kanaal}: som conversies == de band van dat kanaal`, bijna(som(eigen.map((r) => r.conversions)), eigenBand.conversions) && bijna(som(eigen.map((r) => r.adSpend)), eigenBand.adSpend));
      check(`${naam} op ${kanaal}: alleen dat kanaal in de stapel`, eigen.every((r) => Object.keys(r.perKanaal).join() === kanaal));
    }
    // En de grafiek, de kaarten en de band zeggen hetzelfde.
    const kaarten = kaartCijfers(PER_KANAAL, ALLE_KANALEN, periode)!;
    check(`${naam}: grafiek == kaarten`, bijna(som(rijen.map((r) => r.conversions)), som(kaarten.map((k) => k.conversions))));
  }
  const drie = grafiekMaanden(PER_KANAAL, ALLE_KANALEN, PERIODES[0]);
  check("de LinkedIn-pauze in juni staat als nul in de stapel, niet als gat in de reeks", drie[0].maand === "2026-06" && drie[0].perKanaal.linkedin?.conversions === 0 && drie[0].leeg === false);
  check("een maand zonder enig kanaal is leeg en heeft geen CPA", grafiekMaanden(PER_KANAAL, ALLE_KANALEN, PERIODES[4]).every((r) => r.leeg && r.cpa === null && r.conversions === 0));
  check("de volgorde in de stapel is de vaste kanaalvolgorde, wat de aanroeper ook geeft",
    Object.keys(grafiekMaanden(PER_KANAAL, ["microsoft", "google", "meta"], PERIODES[0])[0].perKanaal).join() === "google,meta,microsoft");
  // De hook geeft de kaarten en de grafiek dezelfde reeksen als de band op "Alle kanalen".
  const hook = zonderCommentaar(lees("lib/use-channel-period-data.ts"));
  check("de band op Alle kanalen paart op dezelfde objecten als perKanaal", /bronnen: \[perKanaal\.google!, perKanaal\.meta!, perKanaal\.linkedin!, perKanaal\.microsoft!\]/.test(hook));
  check("en de hook geeft perKanaal terug", /return useMemo\(\(\) => \(\{ \.\.\.keuze, perKanaal, laatsteDag, geladenVanaf, klaar \}\), \[keuze, perKanaal, laatsteDag, geladenVanaf, klaar\]\);/.test(hook));
  const grafiek = zonderCommentaar(lees("components/dashboard/overzicht-hoofdgrafiek.tsx"));
  check("de grafiek stapelt de kanalen en zet de CPA op een eigen as", /stackId="kanalen"/.test(grafiek) && /<AsY id="cpa" rechts /.test(grafiek) && /yAxisId="cpa"/.test(grafiek));
  check("hij gebruikt de gedeelde chrome en de vaste kanaalkleuren", /Raster, AsX, AsY, Tip, Legenda/.test(grafiek) && /fill=\{KANAAL_KLEUR\[k\]\}/.test(grafiek) && /CHART_LINE_SECONDARY/.test(grafiek));
  check("de tooltip toont per maand de kanalen, het totaal en de CPA", /naam: "Totaal"/.test(grafiek) && /naam: CPA/.test(grafiek) && /verberg=\{\[CPA\]\}/.test(grafiek));
  check("de beweging komt uit het token (300 ms bij een wissel, niets bij de eerste render)", /useGrafiekBeweging\(\)/.test(grafiek) && !/animationDuration=/.test(grafiek));
  check("de grafiek draagt een vensterlabel en een tabel voor schermlezers", /<Vensterlabel soort="periode" \/>/.test(grafiek) && /<div className="sr-only"><table>/.test(grafiek));
}

// ── 4. De tegels ───────────────────────────────────────────────────────────────────────────────
console.log("Kerncijfertegels: dezelfde inhoud als de band, één nadruk, de delta als pil");
{
  check("de grootste verandering krijgt de nadruk", nadrukIndex([3, -12, 8, null, 11]) === 1);
  check("onder de drempel krijgt niets nadruk", nadrukIndex([1, -4.9, 0, null, undefined]) === -1 && NADRUK_VANAF_PCT === 5);
  check("precies de drempel telt", nadrukIndex([5, 2]) === 0);
  check("bij een gelijke verandering wint de eerste (de nadruk springt niet)", nadrukIndex([10, -10, 10]) === 0);
  check("zonder vergelijking geen nadruk", nadrukIndex([null, null, undefined]) === -1 && nadrukIndex([]) === -1);
  check("een oneindige waarde telt niet", nadrukIndex([Number.POSITIVE_INFINITY, 6]) === 1);

  const bronnen = ALLE_KANALEN.map((k) => PER_KANAAL[k]);
  const toon = (vorm: "band" | "tegels") => renderToStaticMarkup(createElement(PeriodProvider, {
    scope: `tegels-${vorm}`, children: createElement(PeriodSummary, { data: SAMEN, bronnen, vorm }),
  }));
  const band = toon("band");
  const tegels = toon("tegels");
  // Dezelfde vijf labels en dezelfde vijf waarden.
  const waarden = (html: string) => [...html.matchAll(/<p class="mt-1\.5 [^"]*">([^<]*)<\/p>/g)].map((m) => m[1]);
  check("vijf cijfers in beide vormen", waarden(band).length === 5 && waarden(tegels).length === 5, `${waarden(band).length} / ${waarden(tegels).length}`);
  check("dezelfde vijf waarden", waarden(band).join("|") === waarden(tegels).join("|"), `${waarden(band).join("|")} / ${waarden(tegels).join("|")}`);
  for (const label of ["Conversies", "Omzet", "Advertentiekosten", "ROAS", "CPA"]) {
    check(`het label ${label} staat in beide`, band.includes(`>${label}</p>`) && tegels.includes(`>${label}</p>`));
  }
  // Elke uitlegregel en waarschuwing van de band staat ook onder de tegels.
  const regels = (html: string) => [...html.matchAll(/<p class="[^"]*text-micro[^"]*text-(?:muted-foreground|amber-800)[^"]*">(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/p>/g)].map((m) => m[1]);
  check("de band heeft uitlegregels (anders toetst dit niets)", regels(band).length > 0, band.slice(0, 200));
  check("elke uitlegregel van de band staat ook bij de tegels", regels(band).every((r) => tegels.includes(r)), regels(band).filter((r) => !tegels.includes(r)).join(" || "));
  check("de periode en de vergelijking staan er voluit, in de voetregel", /vergeleken met /.test(tekst(tegels)) && /volgt periode/.test(tekst(tegels)));
  check("de tegels dragen het vensterlabel van de periode", /data-venster="periode"/.test(tegels));
  check("hooguit één tegel heeft nadruk", (tegels.match(/data-nadruk="true"/g) ?? []).length <= 1);
  check("de band heeft geen pil, de tegels wel", !/rounded-full px-2 py-px font-semibold/.test(band) && /rounded-full px-2 py-px font-semibold/.test(tegels));
  check("de band zelf is niet veranderd van vorm", /class="rounded-xl border border-border bg-card px-6 py-5 shadow-sm"/.test(band) && /gap-x-8 gap-y-6/.test(band));

  // De pil: dezelfde regels als de regel (drempel, oordeel, tekst voor schermlezers), andere verpakking.
  const kern = (delta: Record<string, unknown>, deltaVorm?: "regel" | "pil") => renderToStaticMarkup(createElement(Kerncijfer, { label: "Conversies", waarde: "1.360", delta: delta as never, deltaVorm }));
  const pil = kern({ pct: 15.2, hogerIsBeter: true, was: "1.180" }, "pil");
  check("een gunstige stijging: groen vlak, +15%, 'was' en 'gunstig'", /bg-green-50 text-green-700/.test(pil) && /\+15%/.test(pil) && /was 1\.180/.test(tekst(pil)) && /gunstig/.test(tekst(pil)), tekst(pil));
  const duurder = kern({ pct: 22, hogerIsBeter: false }, "pil");
  check("hogere kosten: rood vlak en 'ongunstig'", /bg-red-50 text-red-700/.test(duurder) && /ongunstig/.test(tekst(duurder)));
  const vlak = kern({ pct: 0.3, hogerIsBeter: true }, "pil");
  check("onder een half procent: neutraal vlak, geen oordeel in kleur", /bg-muted text-muted-foreground/.test(vlak) && /vrijwel gelijk/.test(tekst(vlak)));
  check("zonder percentage dezelfde tekst als altijd", tekst(kern({ pct: null, leegTekst: "nieuw in deze periode" }, "pil")).includes("nieuw in deze periode"));
  check("de gewone regel is niet veranderd", kern({ pct: 15.2, hogerIsBeter: true }) === kern({ pct: 15.2, hogerIsBeter: true }, "regel") && !/rounded-full/.test(kern({ pct: 15.2 })));
  check("de pil staat op 12 px en de kleuren halen 4,5:1 (de 700-tint op het 50-vlak)", /text-body/.test(pil) && !/text-green-600|text-red-600/.test(pil));
}

// ── 4b. De hele bovenkant, gerenderd ───────────────────────────────────────────────────────────
console.log("De bovenkant als geheel: kaarten, tegels en grafiek op dezelfde cijfers");
{
  const band = (kanaal: Kanaalkeuze): ChannelPeriodData => ({
    data: kanaal === "blended" ? SAMEN : DATA[kanaal],
    bronnen: kanaal === "blended" ? ALLE_KANALEN.map((k) => PER_KANAAL[k]) : [alsBronReeks("totaal", DATA[kanaal])],
    perKanaal: PER_KANAAL,
    laatsteDag: { meta: "2026-08-26", linkedin: "2026-08-26", microsoft: "2026-08-26" },
    geladenVanaf: { meta: "2000-01", linkedin: "2000-01", microsoft: "2000-01" },
    klaar: { meta: true, linkedin: true, microsoft: true },
  });
  const route = { perKanaalTab: null, dataStand: null, loading: false, error: null };
  // Zonder DOM heeft de container van de grafiek geen maat; recharts meldt dat bij elke render.
  // Dat is hier waar en geen fout, dus die ene melding blijft buiten de uitvoer van de test.
  const waarschuw = console.warn;
  console.warn = (...a: unknown[]) => { if (!String(a[0]).includes("of chart should be greater than 0")) waarschuw(...a); };
  const toon = (channel: Kanaalkeuze, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PeriodProvider, {
    scope: `boven-${channel}`,
    children: createElement(OverzichtBovenkant, {
      clientId: "t", channel, kanalen: ALLE_KANALEN, onKies: () => {}, googleData: DATA.google, route,
      band: band(channel), bandKlaar: true, demo: true, ...extra,
    } as never),
  }));
  const alle = toon("blended");
  check("drie blokken: de kaarten, de kerncijfers en de grafiek, in die volgorde",
    [/aria-label="Kanalen, klik om de pagina te filteren"/, /aria-label="Kerncijfers over /, /aria-label="Conversies per maand, /]
      .map((r) => alle.search(r)).every((p, i, a) => p >= 0 && (i === 0 || p > a[i - 1])), alle.slice(0, 200));
  check("vier kaarten, geen ingedrukt", (alle.match(/aria-pressed="false"/g) ?? []).length === 4 && !/aria-pressed="true"/.test(alle));
  // "font-medium text-red-700" is de klasse van een stand die aandacht vraagt (de pillen in de
  // tegels dragen text-red-700 op een eigen vlak; die tellen hier niet).
  const standen = [...alle.matchAll(/<span data-kaartstand="[^"]*" class="text-meta ([^"]*)">([^<]*)<\/span>/g)].map((m) => ({ klasse: m[1], tekst: m[2] }));
  check("elke kaart toont zijn datastand", standen.length === 4, JSON.stringify(standen));
  check("de demo noemt de stand demodata, zonder rood", standen.some((x) => /^demodata t\/m \d+ aug 2026$/.test(x.tekst))
    && standen.every((x) => !/text-red-700/.test(x.klasse)), JSON.stringify(standen));
  check("de grafiek draagt de tabel met elke maand van de periode", /<caption>Conversies per maand per kanaal/.test(alle) && (alle.match(/<th scope="row">/g) ?? []).length === 12);
  // De eerste tegel is het totaal van de kaarten en van de grafiek (de periode van de provider:
  // de laatste twaalf maanden op de kalender).
  const eersteTegel = /<p class="mt-1\.5 [^"]*">([^<]*)<\/p>/.exec(alle)?.[1] ?? "";
  const kaartSom = som([...alle.matchAll(/<span class="text-lg [^"]*">([\d.]+)<\/span>/g)].map((m) => Number(m[1].replace(/\./g, ""))));
  check("de kaarten samen zijn het conversiecijfer van de eerste tegel (op afronding per kaart na)",
    eersteTegel !== "" && Math.abs(kaartSom - Number(eersteTegel.replace(/\./g, ""))) <= 2, `${kaartSom} / ${eersteTegel}`);
  const meta = toon("meta");
  check("op Meta: de Meta-kaart ingedrukt, de grafiek van Meta", /aria-label="Meta"[^>]*aria-pressed="true"/.test(meta) && /Conversies per maand · Meta/.test(tekst(meta)));
  check("op Meta staan nog steeds alle vier de kaarten (het filter blijft het overzicht)", (meta.match(/aria-describedby="kanaalkaart-/g) ?? []).length === 4);
  check("op Meta telt de tabel alleen Meta", /<th scope="col">Meta<\/th>/.test(meta) && !/<th scope="col">Google Ads<\/th>/.test(meta));
  const laden = toon("blended", { bandKlaar: false });
  check("zolang de band niet klaar is: laadvlakken, geen cijfers", /cijfers worden geladen/.test(tekst(laden)) && /de grafiek wordt geladen/.test(tekst(laden)) && !/% van de kosten/.test(laden));
  const een = toon("google", { kanalen: ["google"], band: band("google") });
  check("een klant met één kanaal: geen kaarten, wel tegels en grafiek", !/Kanalen, klik om/.test(een) && /Kerncijfers over /.test(een) && /Conversies per maand · Google Ads/.test(tekst(een)));
  check("zonder opbouw-klasse op de server (de opbouw is van de browser, na de data)", !/class="opbouw"|\bopbouw\b"/.test(alle));
  // De grafiek los: een periode zonder data zegt dat, in plaats van een leeg vlak.
  const leeg = renderToStaticMarkup(createElement(PeriodProvider, { scope: "grafiek-leeg", children: createElement(OverzichtHoofdgrafiek, {
    maanden: grafiekMaanden(PER_KANAAL, ALLE_KANALEN, PERIODES[4]), kanalen: ALLE_KANALEN, gekozen: null,
  }) }));
  check("een periode zonder data: de grafiek zegt 'Geen data in ...'", /Geen data in /.test(tekst(leeg)));
  check("zonder reeksen en zonder laden rendert de grafiek niets", renderToStaticMarkup(createElement(PeriodProvider, { scope: "grafiek-niets", children: createElement(OverzichtHoofdgrafiek, { maanden: null, kanalen: [], gekozen: null }) })) === "");
  console.warn = waarschuw;
}

// ── 5. De merkregel ────────────────────────────────────────────────────────────────────────────
console.log("Merkregel: logo-tegel, merkstreep en de aftelling op één regel");
{
  const editie = (fairDate: string) => ({ eventId: "grn", eventName: "GreenTech North America", abbrev: "GRN", fairDate, label: "2026", afgeleid: false, cadence: null, previousFairDate: null, previousLabel: null });
  const VANDAAG = today();
  const compact = renderToStaticMarkup(createElement(BrandHeaderBar, { compact: true, fallbackName: "GreenTech", edition: editie(addDays(VANDAAG, 14)) as never }));
  const hero = renderToStaticMarkup(createElement(BrandHeaderBar, { fallbackName: "GreenTech", edition: editie(addDays(VANDAAG, 14)) as never }));
  check("de naam is de kop van de pagina, in beide vormen", /<h1[^>]*>GreenTech<\/h1>/.test(compact) && /<h1[^>]*>GreenTech<\/h1>/.test(hero));
  check("dezelfde aftelling als de hero, in één zin", tekst(compact).includes("2 weken tot GreenTech North America 2026") && tekst(hero).includes("2 weken"), tekst(compact));
  check("de merkstreep is het verloop van de hero", (compact.match(/linear-gradient\(/g) ?? []).length >= 2);
  check("de tegel is 32 px, de hero-tegel 48", /h-8 w-8/.test(compact) && /h-12 w-12/.test(hero));
  check("de compacte regel heeft geen hero-vlak", !/rounded-xl border border-border/.test(compact) && !/px-5 py-4/.test(compact));
  check("in de beursweek zegt hij Beursweek", tekst(renderToStaticMarkup(createElement(BrandHeaderBar, { compact: true, fallbackName: "GreenTech", edition: editie(VANDAAG) as never }))).includes("Beursweek GreenTech North America 2026"));
  check("in de nasleep geen aftelling", !/weken|Beursweek/.test(tekst(renderToStaticMarkup(createElement(BrandHeaderBar, { compact: true, fallbackName: "GreenTech", edition: editie(addDays(VANDAAG, -14)) as never })))));
  check("de gekozen beurs staat erbij", tekst(renderToStaticMarkup(createElement(BrandHeaderBar, { compact: true, fallbackName: "GreenTech", geoClone: "XYZ" }))).includes("Beurs: XYZ"));
  check("de hero is niet veranderd", /Alle beurzen en campagnes van dit account/.test(tekst(hero)) && /text-xl font-bold/.test(hero));
}

// ── 6. De opbouw ───────────────────────────────────────────────────────────────────────────────
console.log("Opbouw: hooguit 600 ms bij het eerste bezoek, 400 ms bij een wissel, niets bij minder beweging");
{
  check("de grenzen zijn 600 en 400 ms", OPBOUW_MAX.eerst === 600 && OPBOUW_MAX.wissel === 400);
  let teLaat = "";
  for (let aantal = 1; aantal <= 8; aantal += 1) {
    for (let i = 0; i < aantal + 2; i += 1) {
      for (const soort of ["eerst", "wissel"] as const) {
        const v = opbouwVertraging(i, aantal, soort);
        if (v < 0 || v + DUUR.lang > OPBOUW_MAX[soort]) teLaat = `${soort} blok ${i}/${aantal}: ${v} + ${DUUR.lang}`;
      }
    }
  }
  check("elk blok staat binnen de grens stil, hoeveel blokken er ook zijn", teLaat === "", teLaat);
  check("het eerste blok wacht niet", opbouwVertraging(0, 6) === 0 && opbouwVertraging(0, 1) === 0);
  check("de blokken komen na elkaar, het laatste precies op de grens", opbouwVertraging(5, 6) === OPBOUW_MAX.eerst - DUUR.lang
    && [0, 1, 2, 3, 4, 5].every((i) => i === 0 || opbouwVertraging(i, 6) > opbouwVertraging(i - 1, 6)));
  check("een wissel van data (het cijfer dat telt, de staaf die groeit) past in 400 ms", DUUR.lang <= OPBOUW_MAX.wissel);
  const css = lees("app/globals.css");
  check("de opbouw gebruikt de tokens, met dezelfde waarden als vangnet", /\.opbouw \{\s*animation: opbouw-in var\(--duur-lang, 300ms\) var\(--ease-aankomst, cubic-bezier\(0, 0, 0\.2, 1\)\) backwards;/.test(css)
    && /--duur-lang: 300ms;/.test(css) && /--ease-aankomst: cubic-bezier\(0, 0, 0\.2, 1\);/.test(css) && DUUR.lang === 300);
  check("minder beweging zet de opbouw uit (ook de vertraging)", /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.opbouw \{\s*animation: none !important;/.test(css));
  const beweging = zonderCommentaar(lees("lib/beweging.ts"));
  check("de hook speelt niet bij minder beweging", /speel: eerste && actief && !gespeeld && !minder/.test(beweging));
  check("één keer per sessie (sessionStorage)", /window\.sessionStorage\.getItem\(OPBOUW_SLEUTEL\) === null/.test(beweging) && /window\.sessionStorage\.setItem\(OPBOUW_SLEUTEL, "1"\)/.test(beweging));
  const boven = zonderCommentaar(lees("components/dashboard/overzicht-bovenkant.tsx"));
  // En niet als de tegels hun cijfers al uit het zaad van de server hadden (band-uit-zaad.tsx): die
  // stonden er dan al, en een opbouw zou ze laten verdwijnen en opnieuw binnenkomen.
  check("de opbouw begint pas als de cijfers er staan", /useEersteOpbouw\(inhoudKlaar && !zaadAangeboden\)/.test(boven) && /const inhoudKlaar = bandKlaar && band\.data !== null/.test(boven));
  check("de vertraging per blok komt uit opbouwVertraging", /opbouwVertraging\(i, aantal\)/.test(boven));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
