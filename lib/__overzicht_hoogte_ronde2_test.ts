// De hoogte van het Overzicht in de nieuwe weergave, tweede ronde: compacter op een telefoon,
// niets weg. Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_hoogte_ronde2_test.ts
//
// WAT DEZE TEST VASTHOUDT (zie docs/overzicht-inklappen-elementen.md, "Ronde 2")
//
// - De trechter van een kanaal: per stap het getal en de verandering open; de kosten per stap staan
//   op een telefoon achter een knop (aria-expanded, label, 44 px), maar IN de pagina, en OPEN als een
//   stap duurder werd dan de grens. Vanaf sm staan de kosten zoals voorheen bij elk getal.
// - Na de klik op een kanaal: de opmerkingen open; welke stappen niet in de keten staan achter een
//   knop met het aantal, behalve als de keten leeg is (dan is dat het verhaal).
// - Na de klik op Alle kanalen: op een telefoon een tabel (stap tegen kanaal) met dezelfde getallen,
//   veranderingen en het label "per maand geteld"; de kaartjes per stap vanaf sm; beide in de DOM.
// - Bijdrage per kanaal: het korte en het volle label staan er allebei, elk op zijn breedte.
// - Detail op aanvraag: CollapsiblePanel `compact` is een knop met aria-expanded en 44 px, en zonder
//   de prop is de kop byte voor byte die van de basis (de vertrouwde weergave gebruikt hem zo).
// - Pacing samengevat: de kleine ring naast de tekst; zonder `samenvatten` de vertrouwde ringcel.
//
// Alles met react-dom/server: geen browser, geen netwerk.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsiblePanel } from "../components/ui/disclosure";
import { KanaalTrechter, BijdragePerKanaal, kostenWijkenAf, KOSTEN_STIJGING_AFWIJKEND_VANAF } from "../components/dashboard/overzicht-trechter";
import { KanaalNaDeKlik, NaDeKlikPerKanaal } from "../components/dashboard/overzicht-na-de-klik";
import { RINGCEL, RING_SAMENGEVAT } from "../components/dashboard/channel-pacing";
import type { Trechter, BijdrageRij } from "./overzicht/trechter";
import { ketenNaDeKlik, type Keten, type KanaalStappen, type NaDeKlikUitkomst } from "./overzicht/conversiestappen";
import { CPA_MOVE_MATERIAL } from "./analysis/kpi-relations";

let geslaagd = 0, gefaald = 0;
function check(label: string, voorwaarde: boolean, detail = ""): void {
  if (voorwaarde) { geslaagd += 1; return; }
  gefaald += 1;
  console.error(`  FAIL: ${label}${detail ? `\n        ${detail}` : ""}`);
}
const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

/** De knop van een uitklapdeel en het deel zelf, op id (dezelfde lezing als __overzicht_hoogte_test). */
function uitklap(html: string, id: string): { knop: string; open: boolean; inhoud: string | null; verborgen: boolean } | null {
  const k = new RegExp(`<button type="button" aria-expanded="(true|false)" aria-controls="uitklap-${id}"[^>]*>((?:(?!</button>)[\\s\\S])*)</button>`).exec(html);
  if (!k) return null;
  const start = html.indexOf(`<div id="uitklap-${id}"`);
  const kop = start >= 0 ? html.slice(start, html.indexOf(">", start) + 1) : "";
  return { knop: tekst(k[2]).trim(), open: k[1] === "true", inhoud: start >= 0 ? html.slice(start) : null, verborgen: /\shidden=""/.test(kop) };
}

// ── De trechter van een kanaal ─────────────────────────────────────────────────────────────────
console.log("Trechter per kanaal: getal en verandering open, de kosten per stap achter een knop");
{
  const maak = (klikKostenPct: number | null): Trechter => ({
    stappen: [
      { sleutel: "vertoningen", label: "Vertoningen", waarde: 100_000, pct: 5, kosten: { label: "per 1.000 vertoningen", waarde: 20, pct: 2 } },
      { sleutel: "klikken", label: "Klikken", waarde: 2_000, pct: -3, kosten: { label: "per klik", waarde: 1, pct: klikKostenPct } },
      { sleutel: "conversies", label: "Conversies", waarde: 50, pct: 12, kosten: { label: "per conversie", waarde: 40, pct: -8 } },
    ],
    overgangen: [{ label: "CTR", waarde: 0.02, vorig: 0.021 }, { label: "Conversieratio", waarde: 0.025, vorig: null }],
    opmerkingen: [], vergelijking: "heel", over: null, nietGelopen: null,
  } as unknown as Trechter);
  const venster = { over: "jan 2026 - okt 2026", tegen: "jan 2025 - okt 2025" };
  const html = render(createElement(KanaalTrechter, { kanaal: "meta", trechter: maak(4), uitleg: null, venster }));
  const deel = uitklap(html, "trechter-kosten-meta");
  const voorKnop = tekst(html.slice(0, html.indexOf('aria-controls="uitklap-trechter-kosten-meta"')));
  check("de getallen en hun verandering staan open, vóór de knop", /100\.000/.test(voorKnop) && /2\.000/.test(voorKnop) && /aantal \+5%/.test(voorKnop) && /aantal \+12%/.test(voorKnop), voorKnop.slice(0, 300));
  check("de doorstroom (CTR) staat open", /CTR/.test(voorKnop));
  check("de kosten per stap staan dicht achter aria-expanded=false, met een label", deel !== null && !deel.open && deel.verborgen && deel.knop === "Toon de kosten per stap", JSON.stringify(deel?.knop));
  check("en staan IN de pagina, alle drie, met hun verandering", !!deel?.inhoud && /per 1\.000 vertoningen, \+2%/.test(tekst(deel.inhoud)) && /per klik, \+4%/.test(tekst(deel.inhoud)) && /per conversie, -8%/.test(tekst(deel.inhoud)), tekst(deel?.inhoud ?? "").slice(0, 300));
  check("het knopblok staat alleen op een telefoon (sm:hidden); vanaf sm de kosten bij elk getal", /<div class="-mx-4 mt-1 sm:hidden" data-trechter-kosten/.test(html) && /class="hidden text-micro tabular-nums text-muted-foreground sm:block">[^<]*per klik/.test(html));
  check("de knop: 44 px en een focusring", /aria-controls="uitklap-trechter-kosten-meta"[^>]*class="[^"]*min-h-11[^"]*focus-visible:ring-2/.test(html));
  check("de balken blijven versiering (aria-hidden) en de tabel voor een schermlezer blijft", /aria-hidden="true"[^>]*><div data-trechterstap="vertoningen"/.test(html) && html.includes('<div class="sr-only"><table>'));
  check("op een telefoon een dunne balk, vanaf sm de brede", /h-2 overflow-hidden rounded-md bg-muted\/50 sm:col-span-1 sm:row-start-auto sm:h-6/.test(html));

  const duur = render(createElement(KanaalTrechter, { kanaal: "meta", trechter: maak(KOSTEN_STIJGING_AFWIJKEND_VANAF + 5), uitleg: null, venster }));
  const open = uitklap(duur, "trechter-kosten-meta");
  check("een stap die veel duurder werd is een afwijking: de kosten staan OPEN", open?.open === true && open.verborgen === false && /data-afwijkend="ja"/.test(duur));
  check("kostenWijkenAf: vanaf de grens wel, eronder en zonder vergelijking niet",
    kostenWijkenAf(maak(KOSTEN_STIJGING_AFWIJKEND_VANAF)) && !kostenWijkenAf(maak(KOSTEN_STIJGING_AFWIJKEND_VANAF - 1)) && !kostenWijkenAf(maak(null)));
  check("de grens is die van de analyses (CPA_MOVE_MATERIAL), in procenten", KOSTEN_STIJGING_AFWIJKEND_VANAF === CPA_MOVE_MATERIAL * 100);
  check("net onder de grens blijft dicht, de grens zelf is open",
    !kostenWijkenAf(maak(KOSTEN_STIJGING_AFWIJKEND_VANAF - 0.01)) && kostenWijkenAf(maak(KOSTEN_STIJGING_AFWIJKEND_VANAF)));
  // Kosten per klik NU niet te berekenen (geen klikken meer), terwijl dat toen wel kon.
  const wegGevallen = maak(null);
  wegGevallen.stappen[1].kosten = { label: "per klik", waarde: null, pct: null, vorig: 0.9 };
  const nuNiet = render(createElement(KanaalTrechter, { kanaal: "meta", trechter: wegGevallen, uitleg: null, venster }));
  check("kosten nu niet te berekenen, toen wel: afwijking, de kosten staan OPEN",
    kostenWijkenAf(wegGevallen) && uitklap(nuNiet, "trechter-kosten-meta")?.open === true && /data-afwijkend="ja"/.test(nuNiet));
  const ookToenNiet = maak(null);
  ookToenNiet.stappen[1].kosten = { label: "per klik", waarde: null, pct: null, vorig: null };
  check("nu en toen niet te berekenen: geen afwijking", !kostenWijkenAf(ookToenNiet));
}

// ── Na de klik op een kanaal ───────────────────────────────────────────────────────────────────
console.log("Na de klik per kanaal: opmerkingen open, de stappen buiten de keten achter een knop");
{
  const keten = (leeg: boolean): Keten => ({
    kanaal: "meta",
    rijen: leeg ? [] : [
      { naam: "Klikken", waarde: 2000, naarVolgende: 0.1, uitval: 1800, verandering: { absoluut: 100, pct: 5.3 } },
      { naam: "Winkelwagen", waarde: 200, naarVolgende: null, uitval: null, verandering: { absoluut: -10, pct: -4.8 } },
    ],
    weg: ["Product bekeken: geen data in deze periode"],
    wegAfwijkend: [],
    opmerkingen: ["Meta telt pas vanaf 3 feb 2026."],
    leeg, fijnheid: "dag", noot: null, geenVergelijking: null,
  });
  const venster = { over: "jan 2026 - okt 2026", tegen: null };
  const html = render(createElement(KanaalNaDeKlik, { keten: keten(false), venster }));
  const deel = uitklap(html, "na-de-klik-weg-meta");
  const voor = tekst(html.slice(0, html.indexOf('aria-controls="uitklap-na-de-klik-weg-meta"')));
  check("getal en verandering op één regel (geen w-full meer op de verandering)", /200/.test(voor) && /-10 \(-5%\)/.test(voor) && !/w-full text-right/.test(html), voor.slice(0, 300));
  check("de opmerking staat OPEN, vóór de knop", voor.includes("Meta telt pas vanaf 3 feb 2026."));
  check("de stappen buiten de keten staan dicht, met het aantal in het label, in de pagina",
    deel !== null && !deel.open && deel.verborgen && deel.knop === "Welke stappen niet in de keten staan (1)" && !!deel.inhoud && deel.inhoud.includes("Product bekeken"), JSON.stringify(deel?.knop));
  const leeg = render(createElement(KanaalNaDeKlik, { keten: keten(true), venster }));
  check("een lege keten: de lijst staat OPEN, zonder knop", !/uitklap-na-de-klik-weg/.test(leeg) && leeg.includes("Product bekeken") && leeg.includes("Niet in de keten"));
  check("zonder afwijking geen data-afwijkend", !/data-afwijkend/.test(html));

  // Een stap die in de vergelijkingsperiode WEL data had en nu niet: dat is een afwijking (een
  // meting die stopte). De keten wordt korter; de reden moet open staan, met de waarde van toen.
  const per = { start: "2026-01-01", eind: "2026-10-31" } as KanaalStappen["periode"];
  const nu: KanaalStappen = { kanaal: "meta", periode: per, klikken: 2000, fijnheid: "dag", bronStart: "2024-01-01", maanden: null, noot: null,
    stappen: [{ naam: "Winkelwagen", waarde: 200, reden: null }, { naam: "Aankoop", waarde: null, reden: "Meta heeft hiervoor geen data in deze periode." }] } as KanaalStappen;
  const toen: KanaalStappen = { ...nu, periode: { start: "2025-01-01", eind: "2025-10-31" } as KanaalStappen["periode"],
    stappen: [{ naam: "Winkelwagen", waarde: 180, reden: null }, { naam: "Aankoop", waarde: 45, reden: null }] };
  const k = ketenNaDeKlik(nu, toen);
  check("ketenNaDeKlik: Aankoop had toen 45 en nu geen data, dus wegAfwijkend", k.wegAfwijkend.length === 1 && k.wegAfwijkend[0].naam === "Aankoop" && k.wegAfwijkend[0].toen === 45, JSON.stringify(k.wegAfwijkend));
  const af = render(createElement(KanaalNaDeKlik, { keten: k, venster: { over: "x", tegen: "y" } }));
  const afDeel = uitklap(af, "na-de-klik-weg-meta");
  check("die afwijking staat OPEN: aria-expanded=true, niet hidden, data-afwijkend=ja",
    afDeel?.open === true && afDeel.verborgen === false && /data-afwijkend="ja"/.test(af), JSON.stringify(afDeel && { open: afDeel.open, verborgen: afDeel.verborgen }));
  check("met de waarde van toen bij de stap", /In de vergelijkingsperiode nog 45/.test(tekst(af)) && /data-weg-afwijkend="ja"/.test(af));
  const zonderToen = ketenNaDeKlik(nu, { ...toen, stappen: [{ naam: "Winkelwagen", waarde: 180, reden: null }, { naam: "Aankoop", waarde: null, reden: "x" }] });
  check("toen ook geen data: geen afwijking, de lijst dicht", zonderToen.wegAfwijkend.length === 0
    && uitklap(render(createElement(KanaalNaDeKlik, { keten: zonderToen, venster: { over: "x", tegen: "y" } })), "na-de-klik-weg-meta")?.open === false);
  check("zonder vergelijkingsperiode: geen afwijking", ketenNaDeKlik(nu, null).wegAfwijkend.length === 0);
}

// ── Na de klik op Alle kanalen ────────────────────────────────────────────────────────────────
console.log("Na de klik op Alle kanalen: een tabel op de telefoon, de kaartjes vanaf sm");
{
  const uitkomst = {
    stappen: [
      { naam: "Winkelwagen", perKanaal: [
        { kanaal: "google", waarde: 120, verandering: { absoluut: 10, pct: 9.1 }, fijnheid: "maand" },
        { kanaal: "meta", waarde: 40, verandering: null, fijnheid: "dag" },
      ] },
      { naam: "Aankoop", perKanaal: [{ kanaal: "meta", waarde: 12, verandering: { absoluut: -2, pct: -14.3 }, fijnheid: "dag" }] },
    ],
    kanalen: ["google", "meta"],
    noten: [{ kanaal: "google", tekst: "Google Ads: per maand geteld." }],
  } as unknown as NaDeKlikUitkomst;
  const html = render(createElement(NaDeKlikPerKanaal, { uitkomst, venster: { over: "jan 2026 - okt 2026", tegen: "jan 2025 - okt 2025" } }));
  const tabelAt = html.indexOf("data-nadeklik-telefoon");
  const tabel = html.slice(tabelAt, html.indexOf("</table>", tabelAt));
  check("de telefoontabel staat er, alleen onder sm, en is versiering (aria-hidden)", /<div class="sm:hidden" aria-hidden="true" data-nadeklik-telefoon/.test(html));
  check("met elke stap, elk getal en elke verandering", /Winkelwagen/.test(tabel) && /Aankoop/.test(tabel) && />120</.test(tabel) && />40</.test(tabel) && />12</.test(tabel) && /\+10 \(\+9%\)/.test(tabel) && /-2 \(-14%\)/.test(tabel), tekst(tabel));
  check("een kanaal zonder deze stap staat er als 'geen', niet als nul", /Aankoop[\s\S]*>geen</.test(tabel));
  check("per maand geteld: een * bij de kop en de legenda eronder", /\*/.test(tabel) && /\* per maand geteld/.test(tekst(html.slice(tabelAt))));
  check("de kaartjes per stap vanaf sm staan er nog, met dezelfde getallen", /class="hidden gap-2 sm:grid sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true"/.test(html) && /\(per maand geteld\)/.test(html));
  check("de noot staat open en de vaste zin achter 'Waarom niet opgeteld?'", html.includes("data-nadeklik-noten") && uitklap(html, "na-de-klik-waarom")?.open === false);
  check("de tabel voor een schermlezer blijft", html.includes('<div class="sr-only"><table>'));
  check("data-nadeklikstap staat één keer per stap in de DOM (de telefoontabel heeft een eigen merkteken)",
    (html.match(/data-nadeklikstap=/g) || []).length === 2 && (html.match(/data-nadeklikstap-telefoon=/g) || []).length === 2);
  const legenda = html.slice(html.indexOf("data-nadeklik-legenda"));
  check("de legenda koppelt elk logo aan de kanaalnaam", /G<\/span>Google Ads/.test(legenda) && /M<\/span>Meta/.test(legenda), tekst(legenda).slice(0, 200));
}

// ── Bijdrage per kanaal ────────────────────────────────────────────────────────────────────────
console.log("Bijdrage per kanaal: compacter op een telefoon, dezelfde inhoud");
{
  const rij = (kanaal: "google" | "meta", k: number, c: number, kenmerk: BijdrageRij["kenmerk"]): BijdrageRij => ({
    kanaal, adSpend: k * 1000, conversions: c * 10, aandeelKosten: k, aandeelConversies: c, cpa: 50, kenmerk, cpaPaar: null, over: null, uitleg: null,
  });
  const html = render(createElement(BijdragePerKanaal, { rijen: [rij("google", 70, 55, "duur"), rij("meta", 30, 45, "voordelig")], venster: { over: "jan 2026 - okt 2026", tegen: null } }));
  check("het korte label op de telefoon en het volle vanaf sm, allebei in de DOM",
    /<span class="sm:hidden">kosten<\/span><span class="hidden sm:inline">van de kosten<\/span>/.test(html) && /<span class="sm:hidden">conversies<\/span><span class="hidden sm:inline">van de conversies<\/span>/.test(html));
  check("de aandelen en het kenmerk staan open", /70%/.test(html) && /55%/.test(html) && /kost meer dan het levert/.test(html) && /levert meer dan het kost/.test(html));
  check("op een telefoon de balken naast elkaar, vanaf sm onder elkaar", /class="mt-1 grid grid-cols-2 gap-x-3 sm:mt-2 sm:grid-cols-1 sm:gap-y-1"/.test(html));
}

// ── Detail op aanvraag: CollapsiblePanel compact ───────────────────────────────────────────────
console.log("CollapsiblePanel compact: dezelfde knop, een kop die niet in de hoogte groeit");
{
  const paneel = (compact?: boolean) => render(createElement(CollapsiblePanel, {
    id: "proef", title: "Maandprestaties", subtitle: "kerncijfers over 28 dagen", meta: createElement("span", null, "laatste 28 dagen"), defaultOpen: false, compact,
    children: createElement("p", null, "inhoud"),
  }));
  const c = paneel(true);
  check("compact: een knop met aria-expanded=false, 44 px en een focusring", /<button type="button" aria-expanded="false" class="flex min-h-11[^"]*focus-visible:ring-2/.test(c));
  check("compact: titel, ondertitel en vensterlabel staan er alle drie", /Maandprestaties/.test(c) && /kerncijfers over 28 dagen/.test(c) && /laatste 28 dagen/.test(c));
  check("compact: de pijl draait niet bij 'minder beweging'", /motion-reduce:transition-none/.test(c));
  // De kop van de basis (e135bac), letterlijk: de vertrouwde weergave gebruikt hem zonder compact.
  const basis = '<div data-paneel="dicht" class="bg-card rounded-xl border border-border shadow-sm overflow-hidden"><button type="button" aria-expanded="false" class="w-full px-5 py-3 flex items-center gap-2 text-left hover:bg-gray-50/70 transition-colors"><h3 class="text-title font-semibold text-brand-gray">Maandprestaties</h3><span class="text-meta text-muted-foreground">kerncijfers over 28 dagen</span><span class="ml-auto flex items-center gap-2"><span>laatste 28 dagen</span>';
  check("zonder compact: byte voor byte de kop van de basis", paneel().startsWith(basis) && paneel() === paneel(false), paneel().slice(0, 400));
}

// ── Pacing samengevat ──────────────────────────────────────────────────────────────────────────
console.log("Pacing samengevat: de kleine ring naast de tekst");
{
  check("samengevat: ring naast de tekst, ook op een telefoon", RINGCEL.samengevat === "flex min-w-0 items-center gap-2.5 text-left" && RING_SAMENGEVAT.maat < 88);
  check("de vertrouwde ringcellen zijn niet veranderd",
    RINGCEL.vertrouwd === "flex flex-wrap items-center justify-center gap-3" && RINGCEL.stapelSmal === "flex min-w-0 flex-col items-center justify-center gap-3 text-center @lg:flex-row @lg:text-left");
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);
