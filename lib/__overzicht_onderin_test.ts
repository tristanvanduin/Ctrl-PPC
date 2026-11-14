// De herschikking onderin het Overzicht in de nieuwe weergave (bouwplan fase 5).
// Draaien: tsx --tsconfig ./tsconfig.json lib/__overzicht_onderin_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Fase 5 maakt de pagina half zo lang door blokken samen te voegen en detail achter een knop te
// zetten. Dat is precies het soort werk waarbij een inzicht ongemerkt verdwijnt, een samengevoegd
// blok twee eindstanden voor één jaar houdt, of een "lade" een div met een klikhandler blijkt.
// Deze test houdt vast:
//
// - DE RIJEN van "Pacing & jaaroverzicht": dezelfde cijfers als de kaarten die het blok vervangt
//   (jaarKaartCijfers), Kosten erbij zonder doel en zonder oordeel, geen oordeel zonder doel, en
//   een vergelijking met vorig jaar alleen waar de pacing er een voor heeft.
// - DE KAART: gerealiseerd, doel, prognose en verschil staan er per metriek; het budgetadvies staat
//   IN de kaart en niet in de lade; de grafiek en het rechte tempo maal twaalf staan er dicht niet.
// - DE LADE: een echte knop met aria-expanded; dicht wordt de inhoud niet gemaakt (een functie als
//   kind wordt niet aangeroepen), open wijst aria-controls naar een id dat bestaat.
// - DE BEURS: compact is één regel "deze week" en de strook; de drie weekkaarten staan er dan niet,
//   en zonder `compact` staan ze er precies zoals altijd.
// - DE HOOFDGRAFIEK: de keuze Conversies of Kosten toont andere cijfers uit dezelfde maanden; een
//   kanaal dat nog niet liep is geen nul (een pauze wel), en de voetregel zegt wie later begint.
// - DE SCHAKELAAR: elk tabblad (Alle kanalen, Meta, LinkedIn, Microsoft) rendert met de schakelaar
//   uit wat het renderde, en met hem aan de nieuwe opbouw. Gerenderd, niet uit de brontekst gelezen.
// - NIETS WEG: wat in de nieuwe opbouw niet open staat, staat achter een knop met aria-expanded; de
//   kanaaltabel staat ook open op Campagnes; het voorbehoud "zonder Microsoft" staat er ook bij een
//   klant met één land.
//
// Alles gerenderd met react-dom/server en een vaste fixture; er wordt nergens op tijd gewacht.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { actieveMetrics, computeForecast, jaarKaartCijfers } from "./forecast";
import { formatCurrency, formatNumber } from "./forecast-format";
import type { ClientHistoricalData, MonthlyRecord } from "./types";
import { doelHerkomstZin, gemiddeldPerMaand, pacingJaarRijen, verschilTekst } from "./overzicht/pacing-jaar";
import { PeriodProvider } from "./period/period-context";
import { chromeIsNieuw } from "./weergave";
import { Lade } from "../components/ui/disclosure";
import { PacingJaaroverzicht } from "../components/dashboard/pacing-jaaroverzicht";
import { FairWeeksView } from "../components/dashboard/fair-weeks-overview";
import type { BlendedKanaalReeks } from "./api/blended-historical";
import { grafiekMaanden } from "./overzicht/bovenkant";
import { alsBronReeks } from "./period/apply-period";
import { bouwHistorischeData, type MaandTotaal } from "./period/kanaal-maanden";
import { monthsIn } from "./period/period-range";
import type { Kanaal } from "./kanalen/beschikbaar";
import { computeHealthScore, zonderKanaalSpecifiekeHygiene } from "./health-score";
import { METRICS, type GeoBreakdownState } from "./geo/use-geo-breakdown";
import { OverzichtHoofdgrafiek } from "../components/dashboard/overzicht-hoofdgrafiek";
import { KanaalDataContext } from "../components/dashboard/channel-data-provider";
import { KanaalOverzichtNieuw } from "../components/dashboard/kanaal-overzicht-nieuw";
import { MetaView } from "../components/dashboard/meta-view";
import { LinkedInView } from "../components/dashboard/linkedin-view";
import { MicrosoftView } from "../components/dashboard/microsoft-view";
import { CrossChannelView } from "../components/dashboard/cross-channel-view";
import { GeoMapCard } from "../components/dashboard/geo-map-card";
import type { UpcomingEdition } from "./fair/fair-weeks";

let geslaagd = 0, gefaald = 0;
function check(label: string, voorwaarde: boolean, detail = ""): void {
  if (voorwaarde) { geslaagd += 1; return; }
  gefaald += 1;
  console.error(`  FAIL: ${label}${detail ? `\n        ${detail}` : ""}`);
}

// ── De fixture: de demo t/m augustus 2026, dezelfde reeksen als __jaarkaart_weergave_test.ts ──
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
// Een doel dat ver buiten bereik ligt: dan loopt het conversiedoel achter en hoort het budgetadvies er te staan.
const dataAchter = maakData({ conversions: 9000, revenue: 282062, adSpend: 117000 });
const forecastAchter = computeForecast(dataAchter);

const maandReeks = (rijen: Rij[], jaar: number) => rijen.map(([conversions, adSpend, revenue], i) => ({
  month: `${jaar}-${String(i + 1).padStart(2, "0")}`, conversions, adSpend, revenue, clicks: 0, impressions: 0,
}));
const perKanaal = [{ kanaal: "google", vanaf: null, maanden: [...maandReeks(J2025, 2025), ...maandReeks(J2026, 2026)] }] as unknown as BlendedKanaalReeks[];
const dataStand = { laatsteVolleMaand: "2026-08", partieel: null };

const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
// Zonder DOM heeft de container van een grafiek geen maat; recharts meldt dat. Hier waar, geen fout.
const waarschuw = console.warn;
console.warn = (...a: unknown[]) => { if (!String(a[0]).includes("of chart should be greater than 0")) waarschuw(...a); };
const metPeriode = (kind: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(PeriodProvider, { scope: "onderin", children: kind })).replace(/<!-- -->/g, "");

console.log("De rijen van Pacing & jaaroverzicht");
{
  const rijen = pacingJaarRijen(forecast, { convRatio: 2.2, spendRatio: 1.73 });
  check("vier metrieken en Kosten, in de volgorde van de kaarten", rijen.map((r) => r.sleutel).join() === "conversions,revenue,roas,cpa,adSpend", rijen.map((r) => r.sleutel).join());
  for (const m of ["conversions", "revenue", "roas", "cpa"] as const) {
    const rij = rijen.find((r) => r.sleutel === m)!;
    const kaart = jaarKaartCijfers(forecast, m);
    check(`${m}: gerealiseerd, doel en prognose zijn die van de kaart die het blok vervangt`,
      rij.ytd === kaart.realized && rij.doel === kaart.annualTarget && rij.prognose === kaart.adjusted && rij.vsDoelPct === kaart.diffPct,
      JSON.stringify({ rij, kaart }));
  }
  const cpa = rijen.find((r) => r.sleutel === "cpa")!;
  check("CPA: boven het doel is ongunstig (lager is beter)", cpa.vsDoelPct !== null && cpa.vsDoelPct > 0 && cpa.gunstig === false, JSON.stringify(cpa));
  check("alleen conversies en kosten hebben een vergelijking met vorig jaar",
    rijen.map((r) => r.tegenVorigJaar).join() === "2.2,,,,1.73", rijen.map((r) => r.tegenVorigJaar).join());
  const kosten = rijen.find((r) => r.sleutel === "adSpend")!;
  check("Kosten: gerealiseerd en prognose uit de prognose, geen doel en geen oordeel",
    kosten.ytd === forecast.adSpend.kpi.ytdRealized && kosten.prognose === forecast.adSpend.kpi.adjustedAnnual
      && kosten.doel === null && kosten.vsDoelPct === null && kosten.gunstig === null && kosten.voortgangPct === null, JSON.stringify(kosten));
  check("een verhouding heeft geen voortgang naar een doel", rijen.find((r) => r.sleutel === "roas")!.voortgangPct === null && cpa.voortgangPct === null);

  const zonderPaar = pacingJaarRijen(forecast, null);
  check("zonder pacing: geen enkele vergelijking, de rest staat er", zonderPaar.length === 5 && zonderPaar.every((r) => r.tegenVorigJaar === null));

  // Een metriek zonder doel is voor deze klant niet actief (actieveMetrics): de kaarten toonden hem
  // dan niet, en de rij staat er dus ook niet. Kosten staat er altijd.
  const zonder = { ...forecast, conversions: { ...forecast.conversions, kpi: { ...forecast.conversions.kpi, annualTarget: 0 } } };
  const zonderDoel = pacingJaarRijen(zonder, null).map((r) => r.sleutel);
  check("dezelfde metrieken als de kaarten: wat de klant niet actief heeft, krijgt geen rij",
    zonderDoel.join() === [...actieveMetrics(zonder), "adSpend"].join() && zonderDoel.length < 5, zonderDoel.join());

  check("verschilTekst: +73%, −12%, 0% en null blijft null",
    verschilTekst(1.73) === "+73%" && verschilTekst(0.88) === "−12%" && verschilTekst(1) === "0%" && verschilTekst(null) === null);
  check("het gemiddelde over nul maanden is geen nul", gemiddeldPerMaand(100, 0) === null && gemiddeldPerMaand(2418, 8) === 302.25);
}

console.log("De kaart, gerenderd");
{
  const toon = (f: typeof forecast, d: ClientHistoricalData) => metPeriode(createElement(PacingJaaroverzicht, {
    data: d, forecast: f, perKanaal, dataStand, metric: "conversions", onMetricChange: () => {}, uitgesloten: null,
  }));
  const html = toon(forecast, data);
  const t = tekst(html);
  check("één kop met het jaar en een vensterlabel jaarblok", /Pacing &amp; jaaroverzicht 2026/.test(html) && /data-venster="jaar"/.test(html));
  const ytd = forecast.conversions.kpi.ytdRealized;
  check("de conversies t/m augustus staan er, met doel en prognose",
    t.includes(` ${formatNumber(ytd)} `) && t.includes(` ${formatNumber(2600)} `) && t.includes(` ${formatNumber(forecast.conversions.kpi.adjustedAnnual)} `), t.slice(0, 400));
  check("de kop van de kolom noemt de maand waar de cijfers t/m lopen", /t\/m aug/.test(t));
  // Intl zet een harde spatie achter het euroteken; `tekst` maakt daar een gewone van.
  check("de kosten staan erbij", t.includes(formatCurrency(forecast.adSpend.kpi.ytdRealized).replace(/\s/g, " ")), t.slice(0, 700));
  const conv2025 = J2025.slice(0, 8).reduce((s, r) => s + r[0], 0);
  const verwachtVerschil = verschilTekst(ytd / conv2025)!;
  check(`tegen vorig jaar: ${verwachtVerschil} bij de conversies`, t.includes(verwachtVerschil), t.slice(0, 600));
  check("het tempo per maand staat in de voetregel", t.includes(`Gemiddeld per maand: ${formatNumber(ytd / 8)} conversies`), t);
  check("het voorbehoud van de optelling staat erbij", /een bovengrens, geen exacte telling/.test(t));
  check("waar het doel vandaan komt, in plaats van 'geen jaardoel in het systeem'", /jaardoel/.test(t) && !/geen jaardoel in het systeem/.test(t));

  check("de lade is een knop, dicht", /<button[^>]*aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Verloop en prognose/.test(html));
  check("dicht: de grafiek en het rechte tempo maal twaalf zijn niet gerenderd",
    !/Performance 20/.test(t) && !/Recht doorgetrokken/.test(t) && !/gelijk-voor-gelijk/.test(t) && !/recharts/.test(html));
  check("één eindstand per jaar op het scherm: 'op dit tempo' staat er dicht niet", !/Op dit tempo/i.test(t));

  check("op schema: geen budgetadvies", !/Budget aanbeveling/.test(t));
  const achter = toon(forecastAchter, dataAchter);
  check("het doel loopt achter: het budgetadvies staat in de kaart, vóór de knop van de lade",
    forecastAchter.budgetRecommendation.behindTarget && achter.indexOf("Budget aanbeveling") >= 0 && achter.indexOf("Budget aanbeveling") < achter.indexOf("aria-expanded"));
  check("een oordeel is niet alleen kleur: 'gunstig' of 'ongunstig' voor schermlezers", /sr-only"> ?(on)?gunstig/.test(html));
  check("het sr-only woord zit in een cel met relative (de tabel schuift opzij op een telefoon)", /<td class="relative [^"]*"><span[^>]*data-oordeel="(on)?gunstig"[^>]*>[\s\S]{0,400}?<span class="sr-only">/.test(html));
  check("de tabel heeft een eigen schuifvak", /<div class="overflow-x-auto[^"]*"[^>]*><table/.test(html));
}

console.log("De lade");
{
  let gemaakt = 0;
  const inhoud = () => { gemaakt += 1; return "de inhoud"; };
  const dicht = renderToStaticMarkup(createElement(Lade, { id: "t", label: "Toon als tabel", labelOpen: "Verberg de tabel", children: inhoud }));
  check("dicht: een knop van het type button met aria-expanded=false", /<button type="button" aria-expanded="false"/.test(dicht) && /Toon als tabel/.test(dicht));
  check("dicht: de inhoud is niet gemaakt en staat niet in de boom", gemaakt === 0 && !/de inhoud/.test(dicht));
  check("dicht: geen aria-controls naar een id dat niet bestaat", !/aria-controls/.test(dicht));
  const open = renderToStaticMarkup(createElement(Lade, { id: "t", label: "Toon als tabel", labelOpen: "Verberg de tabel", defaultOpen: true, children: inhoud }));
  check("open: de inhoud is één keer gemaakt", gemaakt === 1 && /de inhoud/.test(open));
  check("open: aria-expanded=true, het label zegt wat de knop nu doet, en aria-controls wijst naar de inhoud",
    /aria-expanded="true"/.test(open) && /Verberg de tabel/.test(open) && /aria-controls="lade-t"/.test(open) && /id="lade-t"/.test(open));
  check("het tikdoel is minstens 44 px hoog", /min-h-11/.test(dicht));
  const bron = readFileSync(join(__dirname, "..", "components", "ui", "disclosure.tsx"), "utf8");
  const lade = bron.slice(bron.indexOf("export function Lade("));
  check("de stand wordt per gebruiker onthouden via dezelfde opslag als de andere panelen", /useRememberedOpen\(id, defaultOpen\)/.test(lade));
}

console.log("De beurs, compact");
{
  const edition = { eventName: "GreenTech", label: "GreenTech 2026", fairDate: "2026-06-10", cadence: "annual", afgeleid: false } as unknown as UpcomingEdition;
  const toon = (compact: boolean) => metPeriode(createElement(FairWeeksView, { data, forecast, edition, compact }));
  const vol = toon(false);
  const compact = toon(true);
  if (vol === "") {
    // Buiten het venster van de strook rendert het blok niets; dan valt er ook niets te vergelijken.
    check("de fixture valt binnen de weken rond de beurs", false, "FairWeeksView rendert niets");
  } else {
    const kolommen = (h: string) => (h.match(/min-w-\[52px\]/g) ?? []).length;
    check("vertrouwd: de drie weekkaarten staan er", /md:grid-cols-3/.test(vol));
    check("compact: geen weekkaarten, wel één knop 'Deze week'", !/md:grid-cols-3/.test(compact) && /<button type="button"[^>]*>(?:(?!<\/button>).)*Deze week/.test(compact));
    check("compact: de strook is dezelfde (zelfde aantal weken)", kolommen(compact) > 0 && kolommen(compact) === kolommen(vol), `${kolommen(compact)} tegen ${kolommen(vol)}`);
    check("compact: het vensterlabel blijft", /data-venster="jaar"/.test(compact));
  }
}

console.log("De hoofdgrafiek: Conversies of Kosten");
{
  // Google loopt de hele tijd, Meta begint in maart 2026, LinkedIn pauzeert in juni 2026.
  const reeks = (van: string, tot: string, maak: (i: number, sleutel: string) => { conversions: number; revenue: number; adSpend: number } | null): MaandTotaal[] =>
    monthsIn({ start: van, end: tot }).flatMap((k, i) => {
      const m = maak(i, k);
      return m ? [{ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), ...m }] : [];
    });
  const bron = (naam: string, rijen: MaandTotaal[]) => alsBronReeks(naam, bouwHistorischeData("t", rijen, 2026));
  const perKanaalGrafiek = {
    google: bron("google", reeks("2025-09", "2026-08", (i) => ({ conversions: 100 + i, revenue: 0, adSpend: 250000 + i * 1000 }))),
    meta: bron("meta", reeks("2026-03", "2026-08", (i) => ({ conversions: 40 + i, revenue: 0, adSpend: 1500 + i * 100 }))),
    linkedin: bron("linkedin", reeks("2025-11", "2026-08", (i, k) => (k === "2026-06" ? null : { conversions: 12 + i, revenue: 0, adSpend: 1900 + i }))),
  };
  const getoond: Kanaal[] = ["google", "meta", "linkedin"];
  const maanden = grafiekMaanden(perKanaalGrafiek, getoond, { start: "2026-01", end: "2026-08" });
  check("een kanaal dat nog niet liep staat als 'voor de start', een pauze niet",
    maanden[0].voorStart.join() === "meta" && maanden[1].voorStart.join() === "meta" && maanden[2].voorStart.length === 0
      && maanden.find((m) => m.maand === "2026-06")!.voorStart.length === 0, JSON.stringify(maanden.map((m) => m.voorStart)));
  check("de totalen tellen het niet-gestarte kanaal als niets: de som blijft die van de band",
    maanden[0].adSpend === (maanden[0].perKanaal.google?.adSpend ?? 0) + (maanden[0].perKanaal.linkedin?.adSpend ?? 0));

  const toon = (beginMaat?: "conversions" | "adSpend") => metPeriode(createElement(OverzichtHoofdgrafiek, { maanden, kanalen: getoond, gekozen: null, beginMaat }));
  const conv = toon();
  const kosten = toon("adSpend");
  check("standaard staat de keuze op Conversies", /Conversies per maand/.test(tekst(conv)) && /role="radio" aria-checked="true"[^>]*>Conversies/.test(conv) && /role="radio" aria-checked="false"[^>]*>Kosten/.test(conv));
  check("op Kosten: de kop, de gekozen knop en de kolomkop zeggen kosten", /Kosten per maand/.test(tekst(kosten)) && /role="radio" aria-checked="true"[^>]*>Kosten/.test(kosten) && />kosten<\/span>/.test(kosten));
  check("de keuze is een radiogroep met één knop in de tabvolgorde", /role="radiogroup"/.test(conv) && (conv.match(/role="radio"[^>]*tabindex="0"/g) ?? []).length === 1 && (conv.match(/role="radio"[^>]*tabindex="-1"/g) ?? []).length === 1);
  check("de keuzeknoppen zijn op een telefoon 44 px hoog", /role="radio"[^>]*class="min-h-11 [^"]*sm:min-h-7/.test(conv));
  // De cijfers in de tabel voor schermlezers: per maand per kanaal. Andere maat, andere cijfers.
  const cel = (html: string, maand: string) => new RegExp(`<th scope="row">${maand}</th>((?:<td>[^<]*</td>)+)`).exec(html)?.[1] ?? "";
  const label = (html: string, deel: string) => new RegExp(`<th scope="row">([^<]*${deel}[^<]*)</th>`, "i").exec(html)?.[1] ?? "";
  const aug = maanden.find((m) => m.maand === "2026-08")!;
  const augLabel = label(conv, "aug");
  check("de maandrij van augustus is gevonden", augLabel !== "" && cel(conv, augLabel) !== "", augLabel);
  check("Conversies toont aantallen, Kosten bedragen, uit dezelfde maand",
    cel(conv, augLabel).startsWith(`<td>${formatNumber(aug.perKanaal.google!.conversions)}</td>`)
      && cel(kosten, augLabel).replace(/\s/g, " ").startsWith(`<td>${formatCurrency(aug.perKanaal.google!.adSpend).replace(/\s/g, " ")}</td>`),
    `${cel(conv, augLabel)} / ${cel(kosten, augLabel)}`);
  check("de twee standen tonen verschillende cijfers", cel(conv, augLabel) !== cel(kosten, augLabel));
  const janLabel = label(kosten, "jan");
  check("januari: Meta liep nog niet, en dat staat er in plaats van een nul (in beide standen)",
    /<td>liep nog niet<\/td>/.test(cel(kosten, janLabel)) && /<td>liep nog niet<\/td>/.test(cel(conv, janLabel)) && !/<td>€\s0<\/td>/.test(cel(kosten, janLabel)), cel(kosten, janLabel));
  const junLabel = label(kosten, "jun");
  check("juni: de pauze van LinkedIn is wel een nul", !/liep nog niet/.test(cel(kosten, junLabel)) && /<td>€\s0<\/td>/.test(cel(kosten, junLabel)), cel(kosten, junLabel));
  check("de voetregel zegt welk kanaal later begint, en vanaf wanneer", /Meta begint in mrt/i.test(tekst(kosten)) && /niet gemeten, geen nul/.test(tekst(kosten)) && !/LinkedIn begint/.test(tekst(kosten)), tekst(kosten).slice(-400));
  check("het voorbehoud van de optelling staat onder de grafiek", /een bovengrens, geen exacte telling/.test(tekst(conv)));
  check("in de stand Kosten is de kolom voor het bedrag breder dan die voor een aantal",
    /grid-cols-\[minmax\(0,1fr\)_5\.75rem_4\.5rem\]/.test(kosten) && !/_4rem_4\.5rem\]/.test(kosten) && /_4rem_4\.5rem\]/.test(conv));
  const alleenMeta = metPeriode(createElement(OverzichtHoofdgrafiek, { maanden: grafiekMaanden(perKanaalGrafiek, ["meta"], { start: "2026-03", end: "2026-08" }), kanalen: ["meta"], gekozen: "meta" }));
  check("één kanaal dat de hele periode liep: geen voetregel", !/begint in/.test(tekst(alleenMeta)) && !/een bovengrens/.test(tekst(alleenMeta)));
}

console.log("Waar het jaardoel vandaan komt");
{
  const met = (conversions: unknown, revenue: unknown) => ({ ...forecast, doelHerkomst: { conversions, revenue } } as unknown as typeof forecast);
  const alle = ["conversions", "revenue", "roas", "cpa", "adSpend"] as const;
  const beide = doelHerkomstZin(met({ soort: "absoluut" }, { soort: "absoluut" }), alle);
  check("beide ingevoerd: één zin", beide === "Het jaardoel komt uit Instellingen.", beide);
  const geen = doelHerkomstZin(met(undefined, undefined), alle);
  check("geen van beide: één zin over de schatting", /^Geen jaardoel ingevoerd: de kolom toont een schatting \(vorig jaar \+10%\)\.$/.test(geen), geen);
  const gemengd = doelHerkomstZin(met({ soort: "absoluut" }, undefined), alle);
  check("conversiedoel ingevoerd, omzetdoel geschat: per doel benoemd", /^Het conversiedoel komt uit Instellingen; het omzetdoel is een schatting \(vorig jaar \+10%\)\.$/.test(gemengd), gemengd);
  const omgekeerd = doelHerkomstZin(met(undefined, { soort: "absoluut" }), alle);
  check("en omgekeerd", /^Het conversiedoel is een schatting \(vorig jaar \+10%\); het omzetdoel komt uit Instellingen\.$/.test(omgekeerd), omgekeerd);
  check("zonder omzetrij telt alleen het conversiedoel", doelHerkomstZin(met({ soort: "absoluut" }, undefined), ["conversions", "cpa", "adSpend"]) === "Het jaardoel komt uit Instellingen.");
  const kaart = metPeriode(createElement(PacingJaaroverzicht, {
    data, forecast: met({ soort: "absoluut" }, undefined), perKanaal, dataStand, metric: "conversions", onMetricChange: () => {}, uitgesloten: null,
  }));
  check("de kolomkop is neutraal: 'jaardoel', ook bij een geschat doel", /<th scope="col"[^>]*>jaardoel<\/th>/.test(kaart) && !/geschat jaardoel<\/th>/.test(kaart));
  check("de voetregel van de kaart noemt beide doelen", /Het conversiedoel komt uit Instellingen; het omzetdoel is een schatting/.test(tekst(kaart)));
}

console.log("Pacing & jaaroverzicht op een kanaaltabblad");
{
  const html = metPeriode(createElement(PacingJaaroverzicht, { data, forecast, metric: "conversions", onMetricChange: () => {}, kanaalNaam: "Meta" }));
  const t = tekst(html);
  check("de kop noemt het kanaal, niet 'alle kanalen samen'", /Meta · t\/m aug/.test(t) && !/alle kanalen samen/.test(t), t.slice(0, 200));
  check("geen kolom 'tegen vorig jaar' (die vergelijking bestaat alleen over alle kanalen samen)", !/tegen vorig jaar/.test(t) && (html.match(/<th scope="col"/g) ?? []).length === 6);
  check("geen voorbehoud van de optelling: één kanaal is geen som", !/som over de kanalen/.test(t));
  check("dezelfde cijfers als de kaarten die het vervangt", t.includes(` ${formatNumber(forecast.conversions.kpi.ytdRealized)} `) && t.includes(` ${formatNumber(forecast.conversions.kpi.adjustedAnnual)} `));
  check("de lade 'Verloop en prognose' staat er, dicht", /<button[^>]*aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Verloop en prognose/.test(html) && !/recharts/.test(html));
}

console.log("Een kanaaltabblad in de nieuwe weergave");
{
  const kanaalData = {
    rijen: [], maanden: [], convVan: () => 0, convLabel: "Conversies",
    forecast: { data, forecast, health: zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)) }, fout: null,
  };
  const kop = createElement("div", { "data-proef": "kop" }, "DE KOPKAART VAN HET TABBLAD");
  const toon = (extra: Record<string, unknown> = {}) => metPeriode(createElement(KanaalDataContext.Provider, {
    value: kanaalData as never,
    children: createElement(KanaalOverzichtNieuw, { clientId: "demo-greentech", kanaal: "microsoft", geo: null, kop, ...extra } as never),
  }));
  const html = toon();
  const t = tekst(html);
  check("Health, de pacing en Pacing & jaaroverzicht staan open", /Pacing &amp; jaaroverzicht 2026/.test(html) && /Microsoft Ads · t\/m aug/.test(t), t.slice(0, 500));
  check("de vier jaarkaarten en 'Prognose per maand' staan er niet meer los naast", !/Prognose per maand/.test(t) && !/Gerealiseerd YTD/.test(t));
  const knoppen = [...html.matchAll(/<button type="button" aria-expanded="(true|false)"[^>]*>((?:(?!<\/button>).)*)<\/button>/g)].map((m) => ({ open: m[1] === "true", naam: tekst(m[2]) }));
  const blok = (naam: string) => knoppen.find((k) => k.naam.includes(naam));
  for (const naam of ["Maandverloop als eigen grafiek", "Maandprestaties", "Over dit tabblad", "Verloop en prognose"]) {
    check(`'${naam}' is een knop met aria-expanded, dicht`, blok(naam)?.open === false, JSON.stringify(knoppen));
  }
  check("dicht is de kopkaart niet gerenderd", !/DE KOPKAART VAN HET TABBLAD/.test(html));
  check("Microsoft heeft geen wereldkaart en geen video: die blokken staan er niet", !/Waar komt het vandaan/.test(t) && !blok("Waar het budget landt"));
  const metVideo = metPeriode(createElement(KanaalDataContext.Provider, {
    value: kanaalData as never,
    children: createElement(KanaalOverzichtNieuw, { clientId: "demo-greentech", kanaal: "meta", geo: null, kop, video: true } as never),
  }));
  check("een kanaal met video krijgt het blok 'Waar het budget landt', dicht", /aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Waar het budget landt/.test(metVideo));
  const beurs = toon({ geoClone: "GTNA" });
  check("in de beursmodus staat de kopkaart open bovenaan (het voorbehoud 'per beurs')",
    beurs.indexOf("DE KOPKAART VAN HET TABBLAD") > 0 && beurs.indexOf("DE KOPKAART VAN HET TABBLAD") < beurs.indexOf("Gezondheid en pacing") && !/Over dit tabblad/.test(tekst(beurs)));
  const waarschuwing = toon({ waarschuwing: createElement("p", null, "DE KOPPELING IS VERLOPEN") });
  check("een probleem met de koppeling staat open bovenaan, niet achter een klik",
    waarschuwing.indexOf("DE KOPPELING IS VERLOPEN") > 0 && waarschuwing.indexOf("DE KOPPELING IS VERLOPEN") < waarschuwing.indexOf("Gezondheid en pacing"));
  check("een uitklapblok dat de periode volgt, zegt dat in zijn kop", /Maandverloop als eigen grafiek(?:(?!<\/button>).)*data-venster="periode"/.test(html));

  // De tabbladen zelf: met de schakelaar uit rendert elk tabblad wat het renderde, met hem aan de
  // nieuwe opbouw. Zonder data (de route is in een test niet te bereiken) zijn het de koppen en de
  // laadvlakken, en daar is het verschil al te zien.
  const weergaven: [string, (nieuw?: boolean) => ReturnType<typeof createElement>, RegExp][] = [
    ["Meta", (nieuw) => createElement(MetaView, { clientId: "demo-greentech", nieuw }), /Jaar, beurs en markten/],
    ["LinkedIn", (nieuw) => createElement(LinkedInView, { clientId: "demo-greentech", nieuw }), /Jaar, beurs en markten/],
    ["Microsoft", (nieuw) => createElement(MicrosoftView, { clientId: "demo-greentech", nieuw }), /Jaar en beurs/],
  ];
  for (const [naam, maak, oudeKop] of weergaven) {
    const zonder = metPeriode(maak());
    const uit = metPeriode(maak(false));
    const aan = metPeriode(maak(true));
    check(`${naam}: zonder de prop en met de schakelaar uit is het dezelfde uitvoer`, zonder === uit);
    check(`${naam}, uit: de vertrouwde koppen (de kopkaart bovenaan, het jaaroverzicht als eigen deel)`,
      oudeKop.test(tekst(uit)) && /Wat dit kanaal levert/.test(tekst(uit)) && /Jaaroverzicht/.test(tekst(uit)) && !/Detail op aanvraag/.test(tekst(uit)));
    check(`${naam}, aan: de nieuwe opbouw, met de kopkaart achter 'Over dit tabblad'`,
      !oudeKop.test(tekst(aan)) && /Detail op aanvraag/.test(tekst(aan)) && /Over dit tabblad/.test(tekst(aan)) && !/Wat dit kanaal levert/.test(tekst(aan)));
  }
}

console.log("Alle kanalen: de schakelaar, en de kanaaltabel op Campagnes");
{
  const kanalen: Kanaal[] = ["google", "meta", "microsoft"];
  const toon = (extra: Record<string, unknown> = {}) => metPeriode(createElement(CrossChannelView, { clientId: "demo-greentech", kanalen, ...extra }));
  const zonder = toon();
  const uit = toon({ nieuw: false });
  const aan = toon({ nieuw: true });
  check("zonder de prop en met de schakelaar uit is het dezelfde uitvoer", zonder === uit);
  check("uit: de vertrouwde secties, met de kanaaltabel open en de Microsoft-regel erboven",
    /Jaar, beurs en markten/.test(tekst(uit)) && /Cross-channel \(blended\)/.test(tekst(uit)) && /Microsoft Ads telt mee in de kerncijfers/.test(tekst(uit)) && /indicatief is/.test(tekst(uit)));
  check("aan: de kaart bovenaan, dan gezondheid en pacing, de kanaaltabel achter een knop die dicht is",
    /Gezondheid en pacing/.test(tekst(aan)) && tekst(aan).indexOf("Waar komt het vandaan") < tekst(aan).indexOf("Gezondheid en pacing") && !/Jaar, beurs en markten/.test(tekst(aan)) && !/Cross-channel \(blended\)/.test(tekst(aan))
      && /<button type="button" aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Toon als tabel/.test(aan) && !/indicatief is/.test(tekst(aan)));
  check("aan: de kop van de kanaaltabel draagt zijn venster en zegt waar hij open staat", /Kanaaltotalen en maanden per kanaal/.test(tekst(aan)) && /staat ook open op Campagnes/.test(tekst(aan)));
  const tabel = toon({ alleenTabel: true });
  check("op Campagnes: alleen de kanaaltabel, open, met zijn venster en zijn voorbehoud",
    /Kanaaltotalen/.test(tekst(tabel)) && /data-venster="periode"/.test(tabel) && /indicatief is/.test(tekst(tabel)) && !/Account Health/.test(tekst(tabel)) && !/Waar komt het vandaan/.test(tekst(tabel)));
  check("op Campagnes met één kanaal: niets (er valt niets te vergelijken)", metPeriode(createElement(CrossChannelView, { clientId: "demo-greentech", kanalen: ["google"], alleenTabel: true })) === "");
}

console.log("De wereldkaart in de nieuwe weergave");
{
  const land = (code: string, conversions: number | null) => ({ code, impressions: 1000, clicks: 100, cost: 500, conversions });
  const staat = (extra: Record<string, unknown>) => ({
    metricKey: "conversions", setMetricKey: () => {}, metric: METRICS.find((m) => m.key === "conversions")!, focus: null, setFocus: () => {},
    countries: [], states: [], laden: false, canDrillUs: false, labelOf: (c: string) => c, geoWord: "land", ranked: [], values: new Map(),
    totaal: { impressions: 0, clicks: 0, cost: 0, conversions: 0 }, eenLandOfMinder: false, ...extra,
  }) as unknown as GeoBreakdownState;
  const naast = createElement("div", { "data-proef": "naast" }, "DE RANGLIJST");
  const enkel = metPeriode(createElement(GeoMapCard, { state: staat({ countries: [land("NL", 12)], eenLandOfMinder: true }), channel: "blended", naast, vensterToevoeging: "zonder Microsoft" }));
  check("één land: de cijfers van dat land staan er", /Al het verkeer en alle conversies komen uit/.test(tekst(enkel)));
  check("één land: het voorbehoud 'zonder Microsoft' staat er ook, met het venster", /data-venster="vast"/.test(enkel) && /laatste 180 dagen · zonder Microsoft/.test(tekst(enkel)), tekst(enkel));
  const enkelOud = metPeriode(createElement(GeoMapCard, { state: staat({ countries: [land("NL", 12)], eenLandOfMinder: true }), channel: "blended" }));
  check("één land in de vertrouwde weergave: de kaart is wat hij was (geen label erbij)", !/data-venster/.test(enkelOud));
  const leeg = metPeriode(createElement(GeoMapCard, { state: staat({ countries: [land("NL", null), land("DE", null)] }), channel: "blended", naast }));
  check("geen rijen voor de gekozen metriek: de melding, zonder een lege kolom ernaast",
    /Geen land-data voor deze metric/.test(tekst(leeg)) && !/DE RANGLIJST/.test(leeg) && !/lg:grid-cols-\[minmax\(0,1fr\)_340px\]/.test(leeg), tekst(leeg));
}

console.log("De beursregel 'Deze week' opent een venster");
{
  const edition = { eventName: "GreenTech", label: "GreenTech 2026", fairDate: "2026-06-10", cadence: "annual", afgeleid: false } as unknown as UpcomingEdition;
  const compact = metPeriode(createElement(FairWeeksView, { data, forecast, edition, compact: true }));
  check("de knop zegt tegen een schermlezer dat hij een venster opent", /<button type="button" aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*Deze week/.test(compact));
  const bron = readFileSync(join(__dirname, "..", "components", "dashboard", "fair-weeks-overview.tsx"), "utf8");
  // Een week met kosten zonder conversies is met deze fixture niet te maken (de weken komen uit de
  // maandtotalen); dat de regel dan de reden en een streepje toont, staat hier op de bron vast.
  check("zonder waarde: de reden op de plek van 'gerealiseerd' en een streepje als getal",
    /geenData \? geenWaardeLabel\(huidige, metric\)\.toLowerCase\(\) : WEEK_SOORT_LABEL\[weekSoort\(huidige, today\(\)\)\]\.toLowerCase\(\)/.test(bron) && /\{geenData \? "—" : format\(waarde\)\}/.test(bron));
}

console.log("De bedrading: de schakelaar bereikt elk tabblad");
{
  const lees = (...pad: string[]) => readFileSync(join(__dirname, "..", ...pad), "utf8");
  const dashboard = lees("components", "dashboard", "client-dashboard.tsx");
  for (const naam of ["MetaView", "LinkedInView", "MicrosoftView", "CrossChannelView"]) {
    check(`het klantdashboard geeft de schakelaar door aan ${naam}`, new RegExp(`<${naam} [^\\n]*nieuw=\\{nieuweWeergave\\}`).test(dashboard));
  }
  check("en aan GoogleView", /<GoogleView[\s\S]{0,700}nieuw=\{nieuweWeergave\}/.test(dashboard));
  check("op Campagnes staat de kanaaltabel alleen in de nieuwe weergave", /channel === "blended" && nieuweWeergave && <CrossChannelView [^>]*alleenTabel \/>/.test(dashboard));
  // Account Health leest zijn scores uit twee providers die een test niet kan vullen; dat de radar
  // en de toelichting in de lade zitten en de rangschikking erboven staat, staat hier op de bron
  // vast. Dat een dichte lade zijn inhoud niet maakt, is hierboven op gedrag getoetst ("De lade").
  const health = lees("components", "dashboard", "kanaal-health-ranking.tsx");
  check("Health: de radar en de toelichting zitten in de lade, de rangschikking erboven",
    /<Lade id="health-onderbouwing"[^>]*>\s*<div[^>]*>\s*\{onderbouwing\}\s*\{toelichting\}/.test(health) && health.indexOf("<KanaalKop kanaal={kanaal} health={health} />") < health.indexOf('<Lade id="health-onderbouwing"'));
  // Google leest de provider van het klantdashboard en is hier niet los te renderen; de tak staat op de bron vast.
  const google = lees("components", "dashboard", "google-view.tsx");
  const takVanaf = google.indexOf("if (nieuw && !geoClone) {");
  // De tak sluit met zijn eigen `return`; de vertrouwde opbouw is de eerstvolgende `return (` op twee spaties.
  const vertrouwdVanaf = google.indexOf("\n  return (\n", takVanaf);
  const tak = google.slice(takVanaf, vertrouwdVanaf);
  const vertrouwd = google.slice(vertrouwdVanaf);
  check("Google: de nieuwe tak is gevonden en geldt niet in de beursmodus", takVanaf > 0 && vertrouwdVanaf > takVanaf && tak.length > 1000);
  for (const [naam, patroon] of [
    ["Pacing & jaaroverzicht in plaats van de vier kaarten en de grafiek", /<PacingJaaroverzichtGoogle /],
    ["de ranglijst naast de projectie en de tabel in de voet", /naast=\{<GeoRanglijstInKaart state=\{geo\} naast \/>\}[\s\S]*<GeoTabelLade state=\{geo\} \/>/],
    // Samengevat: score, oordeel en de twee ringen open, de onderbouwing en het tempo achter een knop.
    ["de score van Account Health en de ringen van PacingMonitor blijven open (samengevat)", /<HealthBadge clientId=\{clientId\} samenvatten \/>[\s\S]*<PacingMonitor [^>]*samenvatten/],
    ["het landfilter en de keuze maand of beurs blijven", /\{landfilter\}[\s\S]*<TijdasKeuze /],
    ["de losse trendgrafieken, video en de kopkaart achter een klik", /<CollapsiblePanel[\s\S]*<MonthlyTrendLine [\s\S]*<CollapsiblePanel[\s\S]*<VideoPerformance [\s\S]*<CollapsiblePanel[\s\S]*\{kop\}/],
  ] as [string, RegExp][]) check(`Google, nieuw: ${naam}`, patroon.test(tak));
  check("Google, nieuw: geen landentegels en geen losse jaarkaarten", !/<GeoRanglijstCard/.test(tak) && !/<MetricCards/.test(tak) && !/<PerformanceChart /.test(tak));
  check("Google, vertrouwd: de oude blokken staan er nog", ["<GeoRanglijstCard", "<MetricCards", "<PerformanceChart ", "<MonthlyTrendLine", "<VideoPerformance"].every((b) => vertrouwd.includes(b)));
  // De bovenbalk en de bureaubanner volgen de schakelaar alleen op een klantpagina.
  const balk = lees("components", "layout", "top-bar.tsx");
  check("de bovenbalk: zonder de knop Zoeken en de datum in de nieuwe weergave, het palet blijft gemount",
    /\{!nieuweChrome && \(\s*<button[\s\S]{0,700}Zoeken/.test(balk) && /\{!nieuweChrome && \(\s*<span data-chrome-oud className="hidden text-sm text-muted-foreground md:inline">/.test(balk) && /\n\s*<CommandPalette \/>/.test(balk));
  check("alleen op een klantpagina: elders blijft de chrome wat hij was",
    chromeIsNieuw({ pad: "/client/demo-greentech", url: "nieuw", bewaard: null }) && !chromeIsNieuw({ pad: "/portfolio", url: "nieuw", bewaard: "nieuw" })
      && !chromeIsNieuw({ pad: "/client/demo-greentech", url: null, bewaard: null }) && !chromeIsNieuw({ pad: null, url: "nieuw", bewaard: null }));
}

console.warn = waarschuw;
console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);
