// De hoogte van het Overzicht in de nieuwe weergave: samenvatten zonder iets weg te halen.
// Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_hoogte_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Het Overzicht was in de nieuwe weergave op een telefoon acht schermen lang, en "Gezondheid en
// pacing" alleen al twee tot drie. De eigenaar stelde één harde regel: geen enkel inzicht mag
// verdwijnen; het mag verhuizen of achter een klik. Wat hier wordt vastgehouden:
//
// - DE SAMENVATTING: per blok staan het oordeel en het belangrijkste getal open (de health-score met
//   "gezond" of "zwak", de prognose per metriek met zijn oordeel tegen het doel).
// - HET DETAIL STAAT ER NOG: achter een echte knop met aria-expanded="false" en aria-controls naar
//   een deel dat IN de pagina staat (hidden), niet weggelaten. Een merkteken of een cijfer dat een
//   controle zoekt, blijft dus in de boom.
// - WAT AFWIJKT, STAAT OPEN: een rode score opent de onderbouwing, een week onder verwachting de
//   strook; een kritiek signaal staat in de samenvatting zelf.
// - DE SCHAKELAAR UIT: de vertrouwde weergave rendert zoals hij renderde (zonder de nieuwe prop is
//   de uitvoer gelijk, en er staat geen enkel uitklapdeel van deze ronde in).
//
// Alles met react-dom/server: geen browser, geen netwerk. De klok staat vast (opDag): de beursweken
// en de maandpacing rekenen met "vandaag", en een toets die met de datum van oordeel wisselt, toetst
// op de ene dag de open-tak en op de andere de dichte. Elk "open bij een afwijking" wordt hier met
// twee fixtures getoetst: een die afwijkt (open, niet hidden) en een die dat niet doet (dicht).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeForecast } from "./forecast";
import { formatNumber } from "./forecast-format";
import type { ClientHistoricalData, MonthlyRecord } from "./types";
import type { HealthScore } from "./health-score";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene } from "./health-score";
import { PeriodProvider } from "./period/period-context";
import { Uitklap } from "../components/ui/disclosure";
import { HealthBadgeView, HealthSamenvatting, healthOordeel } from "../components/dashboard/health-badge";
import { ChannelHealthBadge } from "../components/dashboard/channel-health-badge";
import { KanaalDataContext } from "../components/dashboard/channel-data-provider";
import { PacingJaaroverzicht } from "../components/dashboard/pacing-jaaroverzicht";
import { FairWeeksView } from "../components/dashboard/fair-weeks-overview";
import { KanaalOverzichtNieuw } from "../components/dashboard/kanaal-overzicht-nieuw";
import { PacingMonitorView } from "../components/dashboard/pacing-monitor";
import { ChannelPacing } from "../components/dashboard/channel-pacing";
import { NaDeKlikPerKanaal } from "../components/dashboard/overzicht-na-de-klik";
import { BijdragePerKanaal } from "../components/dashboard/overzicht-trechter";
import { CampaignTypeSplit } from "../components/dashboard/campaign-type-split";
import { VerdelingRegel } from "../components/dashboard/verdeling-regel";
import { weekOnderVerwachting } from "../components/dashboard/fair-weeks-overview";
import { MeerKnopPerBreedte, uitklapOpslagSleutel } from "../components/ui/disclosure";
import { NIET_OPTELLEN, type NaDeKlikUitkomst } from "./overzicht/conversiestappen";
import type { BijdrageRij } from "./overzicht/trechter";
import type { KanaalMaandRij } from "./cross-channel/kanaal-maandrijen";
import type { FairWeek } from "./fair/fair-weeks";
import { opDag } from "./reporting-date";
import type { UpcomingEdition } from "./fair/fair-weeks";

let geslaagd = 0, gefaald = 0;
function check(label: string, voorwaarde: boolean, detail = ""): void {
  if (voorwaarde) { geslaagd += 1; return; }
  gefaald += 1;
  console.error(`  FAIL: ${label}${detail ? `\n        ${detail}` : ""}`);
}

const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const waarschuw = console.warn;
console.warn = (...a: unknown[]) => { if (!String(a[0]).includes("of chart should be greater than 0")) waarschuw(...a); };
const metPeriode = (kind: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(PeriodProvider, { scope: "hoogte", children: kind })).replace(/<!-- -->/g, "");

/** De knop van een uitklapdeel en het deel zelf, op id. */
function uitklap(html: string, id: string): { knop: string; open: boolean; inhoud: string | null; verborgen: boolean } | null {
  const k = new RegExp(`<button type="button" aria-expanded="(true|false)" aria-controls="uitklap-${id}"[^>]*>((?:(?!</button>)[\\s\\S])*)</button>`).exec(html);
  if (!k) return null;
  const start = html.indexOf(`<div id="uitklap-${id}"`);
  const kop = start >= 0 ? html.slice(start, html.indexOf(">", start) + 1) : "";
  return { knop: tekst(k[2]).trim(), open: k[1] === "true", inhoud: start >= 0 ? html.slice(start) : null, verborgen: /\shidden=""/.test(kop) };
}

// ── Gegevens ────────────────────────────────────────────────────────────────────────────────────
type Rij = [conversies: number, kosten: number, omzet: number];
const naarMaanden = (rijen: Rij[]): MonthlyRecord[] =>
  rijen.map(([conversions, adSpend, revenue], i) => ({ month: i + 1, conversions, adSpend, revenue, weeks: [] }));
const J2025: Rij[] = [[88, 11100, 17010], [92, 11050, 17440], [103, 11150, 19300], [113, 11100, 21010],
  [127, 11050, 23640], [143, 11150, 26670], [138, 11100, 26060], [134, 11050, 25630],
  [117, 11150, 23130], [105, 11100, 20830], [93, 11050, 18490], [87, 11150, 17210]];
const J2026: Rij[] = [[90, 12000, 17190], [243, 16700, 17110], [244, 16800, 36030], [337, 19500, 47530],
  [355, 19700, 50430], [361, 19550, 52170], [418, 25950, 62930], [370, 23650, 56930]];
const maakData = (doel: ClientHistoricalData["targetCurrentYear"]): ClientHistoricalData => ({
  clientId: "demo-greentech",
  currentYear: 2026,
  targetCurrentYear: doel,
  historicalYears: { 2025: naarMaanden(J2025) },
  currentYearData: [...naarMaanden(J2026), null, null, null, null],
});
const data = maakData({ conversions: 2600, revenue: 282062, adSpend: 117000 });
const forecast = computeForecast(data);
const dataAchter = maakData({ conversions: 9000, revenue: 282062, adSpend: 117000 });
const forecastAchter = computeForecast(dataAchter);

const factor = (name: string, score: number, assessed = true) => ({ name, score, maxScore: 20, assessed, description: `uitleg bij ${name}` });
const health = (total: number, kritiekTitel: string | null): HealthScore => ({
  total, grade: total >= 70 ? "B" : total >= 50 ? "C" : "E", color: total >= 70 ? "text-green-600" : total >= 50 ? "text-amber-600" : "text-red-600",
  assessedCount: 5,
  factors: [factor("Doelstelling", 14), factor("Efficiency", 16), factor("Budget", 18), factor("Trend", 9), factor("Hygiëne", 15)],
  anomalies: [
    ...(kritiekTitel ? [{ severity: "critical", title: kritiekTitel, description: "kritiek, met uitleg" }] : []),
    { severity: "warning", title: "Een waarschuwing", description: "minder erg" },
  ],
} as unknown as HealthScore);

// ── De knop zelf ──────────────────────────────────────────────────────────────────────────────
console.log("Uitklap: het detail staat in de pagina, achter een echte knop");
{
  const dicht = renderToStaticMarkup(createElement(Uitklap, { id: "proef", label: "Toon de tabel per metriek", labelOpen: "Verberg de tabel", children: createElement("span", { "data-cijfer": "proef" }, "1.234") }));
  const d = uitklap(dicht, "proef");
  check("dicht: een knop van het type button met aria-expanded=false", d !== null && d.open === false, dicht);
  check("dicht: het label zegt wat erachter zit", d?.knop === "Toon de tabel per metriek", d?.knop);
  check("dicht: aria-controls wijst naar een deel dat er staat", /aria-controls="uitklap-proef"/.test(dicht) && /<div id="uitklap-proef"/.test(dicht));
  check("dicht: het detail staat IN de pagina, verborgen (een merkteken blijft in de boom)", d?.verborgen === true && /data-cijfer="proef"[^>]*>1\.234/.test(dicht));
  check("het tikvlak is minstens 44 px", /<button[^>]*class="[^"]*\bmin-h-11\b/.test(dicht));
  check("de pijl draait niet bij 'minder beweging'", /motion-reduce:transition-none/.test(dicht));
  check("de knop is met het toetsenbord te zien (focusring)", /focus-visible:ring-2/.test(dicht));
  const afwijkend = renderToStaticMarkup(createElement(Uitklap, { id: "proef", label: "Toon", labelOpen: "Verberg", afwijkend: true, children: "x" }));
  const a = uitklap(afwijkend, "proef");
  check("afwijkend: open, en niet verborgen", a?.open === true && a.verborgen === false && /data-afwijkend="ja"/.test(afwijkend), afwijkend);
  check("afwijkend: het label zegt wat de knop nu doet", a?.knop === "Verberg");
  const regel = renderToStaticMarkup(createElement(Uitklap, { id: "w", vorm: "regel", label: "Waarom?", children: "omdat" }));
  check("een 'waarom' is een tekstknop, ook 44 px hoog", /inline-flex min-h-11/.test(regel) && !/border-t/.test(regel.slice(0, regel.indexOf(">"))));
  // De keuze bij een gewone stand wordt bewaard; bij een afwijking niet. Anders gold één keer
  // dichtklappen bij één rode score voor elke klant en elke latere afwijking, ook in een volgende sessie.
  check("een gewone stand bewaart de keuze onder het id", uitklapOpslagSleutel("health-google", false) === "health-google");
  check("bij een afwijking wordt niets bewaard", uitklapOpslagSleutel("health-google", true) === null);
}

console.log("Toon meer per breedte: korter op een telefoon");
{
  const knop = (totaal: number, uitgeklapt = false) => renderToStaticMarkup(createElement(MeerKnopPerBreedte, { totaal, smal: 3, breed: 6, uitgeklapt, onToggle: () => {}, eenheid: "landen" }));
  check("tien regels: per breedte het juiste aantal, met aria-expanded en 44 px", /aria-expanded="false"/.test(knop(10)) && /min-h-11/.test(knop(10))
    && /<span class="lg:hidden">Toon 7 landen meer<\/span>/.test(knop(10)) && /<span class="hidden lg:inline">Toon 4 landen meer<\/span>/.test(knop(10)), tekst(knop(10)));
  check("vijf regels: alleen op een telefoon een knop", /^<button[^>]*class="lg:hidden /.test(knop(5)) && !/lg:inline/.test(knop(5)));
  check("drie regels: geen knop", knop(3) === "");
  check("open: 'Toon minder' en aria-expanded=true", /aria-expanded="true"/.test(knop(10, true)) && /Toon minder/.test(knop(10, true)));
  check("de pijl draait niet bij 'minder beweging'", /motion-reduce:transition-none/.test(knop(10)));
}

// ── Account Health ────────────────────────────────────────────────────────────────────────────
console.log("Account Health samengevat");
{
  const gezond = renderToStaticMarkup(createElement(HealthSamenvatting, { id: "health-proef", health: health(78, "Conversies vielen weg") }));
  const t = tekst(gezond);
  const deel = uitklap(gezond, "health-proef");
  check("de samenvatting toont het getal en het oordeel", /data-health-score[^>]*>78</.test(gezond) && /data-health-oordeel[^>]*>gezond</.test(gezond), t.slice(0, 300));
  check("en de zwakste factor met zijn score", /zwakste: Trend 9\/20/.test(t), t.slice(0, 300));
  check("een kritiek signaal staat in de samenvatting zelf, vóór de knop", gezond.indexOf("Conversies vielen weg") > 0 && gezond.indexOf("Conversies vielen weg") < gezond.indexOf("aria-expanded"));
  check("de onderbouwing staat dicht achter aria-expanded=false, met een label", deel !== null && !deel.open && deel.verborgen && /Toon onderbouwing/.test(deel.knop), JSON.stringify(deel?.knop));
  check("en staat in de pagina: de vijf factoren met hun uitleg en de waarschuwing", !!deel?.inhoud && /Waaruit de score bestaat/.test(deel.inhoud) && /uitleg bij Hygiëne/.test(deel.inhoud) && /Een waarschuwing/.test(deel.inhoud));
  check("de onderbouwing herhaalt de boog en de kop niet", !!deel?.inhoud && !/w-20 h-20/.test(deel.inhoud));

  const rood = renderToStaticMarkup(createElement(HealthSamenvatting, { id: "health-proef", health: health(42, null) }));
  const r = uitklap(rood, "health-proef");
  check("een rode score is een afwijking: de onderbouwing staat open", r?.open === true && r.verborgen === false && /data-oordeel="rood"/.test(rood));
  check("met het oordeel 'zwak' in de samenvatting", /data-health-oordeel[^>]*>zwak</.test(rood));
  check("het oordeel volgt de drempels van de kleur (70 en 50)",
    healthOordeel(health(70, null)).tekst === "gezond" && healthOordeel(health(69, null)).tekst === "vraagt aandacht" && healthOordeel(health(49, null)).rood);

  // De vertrouwde kaart, zonder de nieuwe prop: de boog, de kop en de kaartrand staan er zoals altijd.
  const vertrouwd = renderToStaticMarkup(createElement(HealthBadgeView, { health: health(78, null) }));
  check("schakelaar uit: HealthBadgeView heeft zijn boog, kop en kaartrand, en geen uitklapdeel",
    /w-20 h-20/.test(vertrouwd) && />Account Health</.test(vertrouwd) && /@container bg-card rounded-xl border border-border p-5 shadow-sm/.test(vertrouwd) && !/data-uitklap/.test(vertrouwd));
  check("schakelaar uit: dezelfde uitvoer als met alsOnderbouwing=false",
    vertrouwd === renderToStaticMarkup(createElement(HealthBadgeView, { health: health(78, null), alsOnderbouwing: false })));

  const kanaalData = { rijen: [], maanden: [], convVan: () => 0, convLabel: "Conversies",
    forecast: { data, forecast, health: zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)) }, fout: null };
  const metKanaal = (samenvatten?: boolean) => renderToStaticMarkup(createElement(KanaalDataContext.Provider, {
    value: kanaalData as never, children: createElement(ChannelHealthBadge, { clientId: "x", channel: "meta", samenvatten }),
  }));
  check("ChannelHealthBadge zonder de prop is de vertrouwde kaart", metKanaal() === metKanaal(false) && !/data-uitklap/.test(metKanaal()) && /w-20 h-20/.test(metKanaal()));
  check("ChannelHealthBadge samengevat: eigen sleutel per kanaal", /aria-controls="uitklap-health-meta"/.test(metKanaal(true)));
}

// ── Pacing & jaaroverzicht ────────────────────────────────────────────────────────────────────
console.log("Pacing & jaaroverzicht samengevat");
{
  const toon = (f: typeof forecast, d: ClientHistoricalData) => metPeriode(createElement(PacingJaaroverzicht, {
    data: d, forecast: f, metric: "conversions", onMetricChange: () => {},
  }));
  const html = toon(forecast, data);
  const lijst = html.slice(html.indexOf("data-pacing-samenvatting"), html.indexOf("</ul>", html.indexOf("data-pacing-samenvatting")));
  const conv = forecast.conversions.kpi;
  check("de samenvatting noemt per metriek de prognose", /Conversies/.test(tekst(lijst)) && tekst(lijst).includes(formatNumber(conv.adjustedAnnual)), tekst(lijst));
  check("met het oordeel tegen het doel, niet alleen in kleur", /data-oordeel="(on)?gunstig"/.test(lijst) && /sr-only"> (on)?gunstig/.test(lijst) && /vs doel/.test(tekst(lijst)));
  const deel = uitklap(html, "pacing-tabel");
  check("de tabel staat dicht achter aria-expanded=false, met een label dat zegt wat erachter zit",
    deel !== null && !deel.open && deel.verborgen && /gerealiseerd/.test(deel.knop) && /jaardoel/.test(deel.knop), JSON.stringify(deel?.knop));
  check("de tabel en de voetregel staan in de pagina", !!deel?.inhoud && /<table/.test(deel.inhoud) && /Kosten hebben geen doel/.test(deel.inhoud) && /een bovengrens/.test(deel.inhoud));
  check("de samenvatting staat vóór de knop", html.indexOf("data-pacing-samenvatting") < html.indexOf('aria-controls="uitklap-pacing-tabel"'));
  const achter = toon(forecastAchter, dataAchter);
  const lijstAchter = achter.slice(achter.indexOf("data-pacing-samenvatting"), achter.indexOf("</ul>", achter.indexOf("data-pacing-samenvatting")));
  check("een metriek die achterloopt staat in de samenvatting als ongunstig", /data-pacing-metriek="conversions"[\s\S]*?data-oordeel="ongunstig"/.test(lijstAchter), tekst(lijstAchter));
  check("het budgetadvies blijft open, vóór de knop", achter.indexOf("Budget aanbeveling") >= 0 && achter.indexOf("Budget aanbeveling") < achter.indexOf("aria-expanded"));
}

// ── De beursweken ─────────────────────────────────────────────────────────────────────────────
console.log("De beursweken, compact");
{
  const edition = { eventName: "GreenTech", label: "GreenTech 2026", fairDate: "2026-06-10", cadence: "annual", afgeleid: false } as unknown as UpcomingEdition;
  const toon = (d: ClientHistoricalData, compact: boolean) => opDag("2026-11-14", () =>
    metPeriode(createElement(FairWeeksView, { data: d, forecast: computeForecast(d), edition, compact })));
  // Op schema: het doel van 2.600 ligt onder de prognose, deze week staat boven verwachting.
  const opSchema = toon(data, true);
  // Achter: een doel van 9.000, dus deze week ver onder verwachting.
  const achter = toon(dataAchter, true);
  const vol = toon(data, false);
  check("de fixtures vallen binnen de weken rond de beurs", opSchema !== "" && achter !== "");
  const dicht = uitklap(opSchema, "beurs-weken");
  const open = uitklap(achter, "beurs-weken");
  check("compact: 'deze week' staat open, de strook achter een knop met een label",
    dicht !== null && /Toon de weken rond de beurs \(\d+\)/.test(dicht.knop) && /Deze week/.test(tekst(opSchema.slice(0, opSchema.indexOf("uitklap-beurs-weken")))), JSON.stringify(dicht?.knop));
  check("op schema: de strook staat dicht en verborgen, maar in de pagina", dicht?.open === false && dicht.verborgen === true && !/data-afwijkend/.test(opSchema));
  check("deze week onder verwachting: de strook staat OPEN en niet verborgen", open?.open === true && open.verborgen === false && /data-afwijkend="ja"/.test(achter), JSON.stringify(open && { open: open.open, verborgen: open.verborgen }));
  const kolommen = (h: string) => (h.match(/min-w-\[52px\]/g) ?? []).length;
  check("de strook heeft evenveel weken als de vertrouwde", kolommen(opSchema) === kolommen(vol) && kolommen(vol) > 0, `${kolommen(opSchema)} tegen ${kolommen(vol)}`);
  check("vertrouwd: geen uitklapdeel", !/data-uitklap/.test(vol));

  // Het oordeel zelf, per tak.
  const week = (w: Partial<FairWeek>) => ({ weekStart: "2026-11-09", realized: null, forecast: null, expected: 100, ...w }) as unknown as FairWeek;
  check("onder verwachting is ongunstig, erboven niet", weekOnderVerwachting(week({ realized: 80 }), false) && !weekOnderVerwachting(week({ realized: 120 }), false));
  check("een lopende week telt met de prognose", weekOnderVerwachting(week({ forecast: 50 }), false));
  check("bij CPA (lager is beter) is erboven ongunstig", weekOnderVerwachting(week({ realized: 120 }), true) && !weekOnderVerwachting(week({ realized: 80 }), true));
  check("kosten zonder conversies (geenNoemer) is bij CPA ongunstig", weekOnderVerwachting(week({ geenNoemer: true } as Partial<FairWeek>), true));
  check("zonder verwachting of zonder week is er geen oordeel", !weekOnderVerwachting(week({ realized: 10, expected: 0 }), false) && !weekOnderVerwachting(undefined, false));
}

// ── Een kanaaltabblad en Alle kanalen ─────────────────────────────────────────────────────────
console.log("De tabbladen: aan samengevat, uit ongewijzigd");
{
  const kanaalData = { rijen: [], maanden: [], convVan: () => 0, convLabel: "Conversies",
    forecast: { data, forecast, health: zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)) }, fout: null };
  const kop = createElement("div", null, "KOP");
  const html = metPeriode(createElement(KanaalDataContext.Provider, {
    value: kanaalData as never,
    children: createElement(KanaalOverzichtNieuw, { clientId: "demo-greentech", kanaal: "meta", geo: null, kop } as never),
  }));
  check("kanaal, nieuw: Account Health samengevat", /data-samenvatting="health"/.test(html) && /aria-controls="uitklap-health-meta"/.test(html));
  check("kanaal, nieuw: Pacing & jaaroverzicht met de samenvatting en de tabel achter een knop", /data-pacing-samenvatting/.test(html) && /aria-controls="uitklap-pacing-tabel-kanaal"/.test(html));

  // SCHAKELAAR UIT. MetaView en CrossChannelView renderen hier zonder hun eigen provider alleen de
  // laadstaat, dus een vergelijking van die twee zou niets zeggen over de gewijzigde blokken. Wat
  // de schakelaar uit wel toetst: (1) per gewijzigd onderdeel geeft het zonder de nieuwe prop met
  // ECHTE data dezelfde uitvoer als met `false` en geen uitklapdeel (zie de secties hierboven en
  // hieronder), en (2) de vertrouwde takken van de tabbladen geven de nieuwe props niet mee.
  const lees = (f: string) => readFileSync(join(__dirname, "..", "components", "dashboard", f), "utf8");
  const google = lees("google-view.tsx");
  const vertrouwd = google.slice(google.indexOf("\n  return (\n    <>", google.indexOf("if (nieuw && !geoClone)")));
  check("Google, vertrouwd: HealthBadge, PacingMonitor en CampaignTypeSplit zonder samenvatten", /<HealthBadge clientId=\{clientId\} \/>/.test(vertrouwd) && /<PacingMonitor clientId=\{clientId\} countryFilter=\{countryFilter\} edition=\{edition\} \/>/.test(vertrouwd) && !/samenvatten|compact\b/.test(vertrouwd));
  const naNieuw = (f: string, merk: string) => { const b = lees(f); const i = b.indexOf(merk); return i < 0 ? null : b.slice(b.indexOf("\n  return (", i + merk.length)); };
  const metaVertrouwd = naNieuw("meta-view.tsx", "if (nieuw) {");
  check("Meta, vertrouwd: BreakdownDonuts zonder samenvatten", metaVertrouwd !== null && /<BreakdownDonuts /.test(metaVertrouwd) && !/samenvatten/.test(metaVertrouwd));
  const linkedin = lees("linkedin-view.tsx");
  check("LinkedIn: alleen de verdeling van de nieuwe weergave is samengevat", (linkedin.match(/samenvatten/g) ?? []).length === 1 && /verdeling=\{<BreakdownDonuts [^>]*samenvatten \/>\}/.test(linkedin));
  const cross = lees("cross-channel-view.tsx");
  // De vertrouwde return staat op twee spaties inspringing, die van de nieuwe weergave op vier.
  const crossVertrouwd = cross.slice(cross.indexOf("\n  return (", cross.indexOf("if (nieuw) {")));
  check("Alle kanalen, vertrouwd: geen samenvatten en geen compacte beurs", crossVertrouwd.length > 1000 && !/samenvatten|compact\b/.test(crossVertrouwd));
}

// ── Pacing (Google): PacingMonitorView ─────────────────────────────────────────────────────────
console.log("Pacing samengevat: de ringen open, het tempo erachter, rood open");
{
  const pm = (d: ClientHistoricalData, samenvatten?: boolean) => renderToStaticMarkup(createElement(PacingMonitorView, { data: d, samenvatten }));
  const voorKnop = (h: string) => tekst(h.slice(0, h.indexOf('aria-controls="uitklap-pacing-google-tempo"')));
  // Op schema: 2.600 doel, de prognose ligt erboven.
  const opSchema = pm(data, true);
  const deel = uitklap(opSchema, "pacing-google-tempo");
  check("op schema: de ringen met hun oordeel en hun percentage staan open", /Op schema/.test(voorKnop(opSchema)) && /\d+%/.test(voorKnop(opSchema)), voorKnop(opSchema).slice(0, 300));
  check("op schema: het tempo staat dicht, met een label dat zegt wat erachter zit", deel !== null && !deel.open && deel.verborgen && /tempo per dag/.test(deel.knop) && /jaar uitkomt/.test(deel.knop), JSON.stringify(deel?.knop));
  check("en staat in de pagina: tempo per dag, wat er nodig is en op dit tempo", !!deel?.inhoud && /Tempo conversies/.test(tekst(deel.inhoud)) && /nodig:/i.test(tekst(deel.inhoud)) && /op dit tempo/i.test(tekst(deel.inhoud)), tekst(deel?.inhoud ?? "").slice(0, 300));
  check("op schema: geen afwijking gemarkeerd", !/data-afwijkend/.test(opSchema));
  // Sterk achter: een doel van 9.000 conversies, ruim onder 70% van de verwachting.
  const achter = pm(dataAchter, true);
  const a = uitklap(achter, "pacing-google-tempo");
  check("sterk achter: het oordeel staat in de samenvatting", /Sterk achter/.test(voorKnop(achter)), voorKnop(achter).slice(0, 300));
  check("sterk achter is rood: het tempo staat OPEN en niet verborgen", a?.open === true && a.verborgen === false && /data-afwijkend="ja"/.test(achter), JSON.stringify(a && { open: a.open, verborgen: a.verborgen }));
  // Schakelaar uit: zonder de prop dezelfde uitvoer, en geen enkel uitklapdeel.
  check("schakelaar uit: zonder de prop dezelfde uitvoer, zonder uitklapdeel, de grote ringcijfers", pm(data) === pm(data, false) && !/data-uitklap/.test(pm(data)) && /text-figure/.test(pm(data)));
  check("schakelaar uit: tempo en ringen in één raster, zoals altijd", /grid flex-1 grid-cols-2 items-stretch gap-4 @6xl:grid-cols-3/.test(pm(data)));
  // De seizoensduiding verschijnt alleen bij een afwijking, en staat dan OPEN, vóór de knop.
  for (const h of [opSchema, achter]) {
    if (/data-pacing-duiding/.test(h)) check("de seizoensduiding staat open, vóór de knop", h.indexOf("data-pacing-duiding") < h.indexOf('aria-controls="uitklap-pacing-google-tempo"'));
  }
  const bron = readFileSync(join(__dirname, "..", "components", "dashboard", "pacing-monitor.tsx"), "utf8");
  check("de duiding staat in de bron buiten het uitklapdeel", /\{duiding && <div data-pacing-duiding>\{duiding\}<\/div>\}\s*<div className="-mx-5 -mb-5 mt-4">/.test(bron));
}

// ── Pacing (kanaal): ChannelPacing ──────────────────────────────────────────────────────────────
console.log("Pacing per kanaal samengevat");
{
  // Oktober elke dag 100 euro en 2 conversies, november tot de 13e hetzelfde: in de pas.
  const dagen = (maand: string, tot: number, spend: number, conv: number) =>
    Array.from({ length: tot }, (_, i) => ({ date: `${maand}-${String(i + 1).padStart(2, "0")}`, spend, conversions: conv }));
  const rijen = [...dagen("2026-10", 31, 100, 2), ...dagen("2026-11", 13, 100, 2)];
  const cp = (samenvatten?: boolean) => opDag("2026-11-14", () => renderToStaticMarkup(createElement(KanaalDataContext.Provider, {
    value: { rijen, maanden: [], convVan: (r: { conversions: number }) => r.conversions, convLabel: "Leads", forecast: null, fout: null } as never,
    children: createElement(ChannelPacing, { stapelSmal: true, samenvatten }),
  })));
  const html = cp(true);
  const deel = uitklap(html, "pacing-kanaal-tempo");
  const voor = tekst(html.slice(0, html.indexOf('aria-controls="uitklap-pacing-kanaal-tempo"')));
  check("de ringen met hun oordeel en hun percentage staan open", /In de pas|Loopt (voor|achter)/.test(voor) && /\d+%/.test(voor), voor.slice(0, 300));
  check("het tempo staat dicht achter aria-expanded=false, met een label", deel !== null && !deel.open && deel.verborgen && /tempo per dag/.test(deel.knop) && /eindstand van de maand/.test(deel.knop), JSON.stringify(deel?.knop));
  check("en staat in de pagina: de eindstand en de voetregel 'Rechte lijn'", !!deel?.inhoud && /eind van de maand/.test(deel.inhoud) && /Rechte lijn/.test(deel.inhoud));
  check("schakelaar uit: zonder de prop dezelfde uitvoer, zonder uitklapdeel, met de voetregel open", cp() === cp(false) && !/data-uitklap/.test(cp()) && /Rechte lijn/.test(cp()));
}

// ── Na de klik ──────────────────────────────────────────────────────────────────────────────────
console.log("Na de klik: de noten open, de vaste uitleg achter een 'waarom'");
{
  const venster = { over: "jan 2026 - okt 2026", tegen: "jan 2025 - okt 2025" };
  const uitkomst = {
    stappen: [{ naam: "Winkelwagen", perKanaal: [
      { kanaal: "google", waarde: 120, verandering: { absoluut: 10, pct: 9.1 }, fijnheid: "dag" },
      { kanaal: "meta", waarde: 40, verandering: null, fijnheid: "maand" },
    ] }],
    kanalen: ["google", "meta"],
    noten: [{ kanaal: "meta", tekst: "Meta: de dagcijfers zijn niet geladen." }],
  } as unknown as NaDeKlikUitkomst;
  const html = renderToStaticMarkup(createElement(NaDeKlikPerKanaal, { uitkomst, venster }));
  const deel = uitklap(html, "na-de-klik-waarom");
  const knopAt = html.indexOf('aria-controls="uitklap-na-de-klik-waarom"');
  check("het voorbehoud in drie woorden staat in de kop", /per kanaal, niet opgeteld/.test(tekst(html)));
  check("de getallen staan open", /120/.test(tekst(html.slice(0, knopAt))));
  check("de noten per kanaal staan OPEN, vóór de knop en buiten het uitklapdeel",
    /data-nadeklik-noten/.test(html) && html.indexOf("Meta: de dagcijfers zijn niet geladen.") < knopAt && !(deel?.inhoud ?? "").slice(0, (deel?.inhoud ?? "").indexOf("</div>")).includes("dagcijfers"));
  check("de vaste zin staat dicht achter 'Waarom niet opgeteld?', in de pagina",
    deel !== null && !deel.open && deel.verborgen && deel.knop === "Waarom niet opgeteld?" && !!deel.inhoud && deel.inhoud.includes(NIET_OPTELLEN.slice(0, 40)), JSON.stringify(deel?.knop));
}

// ── Bijdrage per kanaal ─────────────────────────────────────────────────────────────────────────
console.log("Bijdrage per kanaal: de uitleg achter een 'waarom', in de pagina");
{
  const rij = (kanaal: "google" | "meta", k: number, c: number, kenmerk: BijdrageRij["kenmerk"]): BijdrageRij => ({
    kanaal, adSpend: k * 1000, conversions: c * 10, aandeelKosten: k, aandeelConversies: c, cpa: 50, kenmerk, cpaPaar: null, over: null, uitleg: null,
  });
  const html = renderToStaticMarkup(createElement(BijdragePerKanaal, { rijen: [rij("google", 70, 55, "duur"), rij("meta", 30, 45, "voordelig")], venster: { over: "jan 2026 - okt 2026", tegen: null } }));
  const deel = uitklap(html, "bijdrage-waarom");
  check("per kanaal staan het kenmerk en de aandelen open, vóór de knop", /data-kenmerk="duur"/.test(html) && /data-kenmerk="voordelig"/.test(html) && html.indexOf('data-bijdrage="meta"') < html.indexOf("aria-controls"));
  check("de uitleg staat dicht achter een label dat zegt wat erachter zit, in de pagina",
    deel !== null && !deel.open && deel.verborgen && /Waarom deze kenmerken/.test(deel.knop) && /tellen elk op tot 100/.test(deel.inhoud ?? ""), JSON.stringify(deel?.knop));
}

// ── De verdeling: de ring als één regel ─────────────────────────────────────────────────────────
console.log("Spend per kanaal en Verdeling: de verdeling als regel, de ringen erachter");
{
  const maand = (m: number, channel: KanaalMaandRij["channel"], spend: number, conversions: number): KanaalMaandRij =>
    ({ month: `2026-${String(m).padStart(2, "0")}-01`, channel, impressions: 0, clicks: 0, spend, conversions, conversion_value: 0 });
  const rijen: KanaalMaandRij[] = [];
  for (let m = 1; m <= 10; m++) rijen.push(maand(m, "google_ads", 7000, 50), maand(m, "meta_ads", 2000, 20), maand(m, "microsoft_ads", 1000, 5));
  const cts = (samenvatten?: boolean) => opDag("2026-11-14", () =>
    metPeriode(createElement(CampaignTypeSplit, { clientId: "demo-greentech", toon: ["kanaal"], kanaalRijen: rijen, samenvatten })));
  const html = cts(true);
  const r0 = html.indexOf("data-verdeling-regel");
  const regel = r0 < 0 ? "" : html.slice(r0, html.indexOf("</p>", r0));
  const pcts = [...tekst(regel).matchAll(/(\d+(?:,\d+)?)%/g)].map((m) => Number(m[1].replace(",", ".")));
  check("de regel noemt elk kanaal met zijn aandeel in de kosten", /Google/.test(tekst(regel)) && /Meta/.test(tekst(regel)) && /Microsoft/.test(tekst(regel)) && /van de kosten/.test(tekst(regel)), tekst(regel));
  check("de aandelen tellen op tot ongeveer 100", pcts.length === 3 && Math.abs(pcts.reduce((x, y) => x + y, 0) - 100) < 0.5, pcts.join(" + "));
  // Dezelfde aandelen als de legenda van de ring, die in het uitklapdeel staat.
  const deel = uitklap(html, "verdeling-ringen-kanaal");
  const legenda = [...(deel?.inhoud ?? "").matchAll(/<span class="ml-auto tabular-nums text-muted-foreground">([^<]+)<\/span>/g)].map((m) => m[1]);
  const inRegel = [...regel.matchAll(/<span class="tabular-nums">([^<]+)<\/span>/g)].map((m) => m[1]);
  check("de regel en de legenda geven dezelfde aandelen", legenda.length === 3 && legenda.join("|") === inRegel.join("|"), `${legenda.join("|")} tegen ${inRegel.join("|")}`);
  check("de ringen staan dicht achter een label dat zegt wat erachter zit, in de pagina",
    deel !== null && !deel.open && deel.verborgen && /kosten en conversies per kanaal/.test(deel.knop) && /Kostenverdeling over kanalen/.test(deel.inhoud ?? ""), JSON.stringify(deel?.knop));
  check("één kop: 'Spend per kanaal' staat er één keer", (html.match(/>Spend per kanaal</g) ?? []).length === 1);
  check("schakelaar uit: zonder de prop dezelfde uitvoer, zonder uitklapdeel en zonder regel, de ringen open",
    cts() === cts(false) && !/data-uitklap/.test(cts()) && /Kostenverdeling over kanalen/.test(cts()) && !/data-verdeling-regel/.test(cts()));
  const veel = renderToStaticMarkup(createElement(VerdelingRegel, { delen: Array.from({ length: 6 }, (_, i) => ({ sleutel: `s${i}`, label: `S${i}`, aandeel: "1%", kleur: "#000" })), waarvan: "van de spend" }));
  check("meer dan vier delen: de grootste drie en 'en N andere'", (veel.match(/data-verdeling-deel=/g) ?? []).length === 3 && /en 3 andere/.test(tekst(veel)));
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);
