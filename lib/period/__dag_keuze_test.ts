// De nieuwe periodekiezer (stap 3 van het periodemodel): de keuzes, de standaarden, de adresbalk
// (ook oude adressen), "niets" zonder pijlen, de vorige editie uitgeschakeld zonder event, en dat
// hele maanden precies dezelfde vensters en cijfers houden.
// Draaien: tsx --tsconfig ./tsconfig.json lib/period/__dag_keuze_test.ts

import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  dagKeuzeUitParams, dagKeuzeUitMaand, googleWeekNoot, kiesPeriode, kiesVergelijk, lostDagKeuzeOp, metDag, metDagUitParams,
  schoneDagKeuze, vergelijkUitleg, vergelijkZin, zetDagKeuzeParams, type DagKeuze,
} from "./dag-keuze";
import { periodeUitParams, zetPeriodeParams } from "./periode-url";
import { periodeCookieRegel, periodeUitCookie } from "./periode-cookie";
import { periodeWaarde, VastePeriode, type PeriodState } from "./period-context";
import { COMPARISON_MODES, PERIOD_PRESETS, type PeriodeKeuze } from "./period-range";
import { eventPeriodesVoorKlant } from "../events/event-periodes";
import { delta } from "./apply-period";
import { opDag } from "../reporting-date";
import type { DagCijfers } from "./use-dag-telling";
import { dagTegels, DagKerncijfers } from "../../components/dashboard/dag-kerncijfers";
import { alleenTabbaar, PeriodeKiezer, VergelijkDeel } from "../../components/dashboard/periode-kiezer";
import { Vensterlabel } from "../../components/ui/vensterlabel";
import type { FairEventCfg } from "../fair/fair-weeks";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const zoek = (s: string) => new URLSearchParams(s);
const alsTekst = (k: DagKeuze | null) => { const p = new URLSearchParams(); zetDagKeuzeParams(p, k); return p.toString(); };
// VastePeriode vraagt children als prop; als tweede argument van createElement is dat hetzelfde.
const Vast = VastePeriode as (p: { waarde: PeriodState; children?: ReactNode }) => ReactElement;
const vast = (waarde: PeriodState, kind: ReactElement) => createElement(Vast, { waarde }, kind);
const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Twee edities van Black Friday (met periode) en een event met één editie.
const EVENTS = eventPeriodesVoorKlant([
  { id: "bf", name: "Black Friday", abbrev: "BF", cadence: "annual", editions: [
    { date: "2025-11-28", label: "2025", start: "2025-11-21", end: "2025-12-01" },
    { date: "2026-11-27", label: "2026", start: "2026-11-20", end: "2026-11-30" },
  ] },
  { id: "md", name: "Moederdag-actie", abbrev: "MD", cadence: "annual", editions: [
    { date: "2026-05-10", label: "2026", start: "2026-04-27", end: "2026-05-10" },
  ] },
] as unknown as FairEventCfg[]);
const BF26 = EVENTS.find((e) => e.eventId === "bf" && e.label === "2026")!;
const MD26 = EVENTS.find((e) => e.eventId === "md")!;
const RANGE = { start: "2025-11", end: "2026-10" };

opDag("2026-11-13", () => {
  console.log("Oude adressen werken, en lezen precies als de maandkeuze");
  {
    for (const preset of PERIOD_PRESETS) {
      for (const v of [null, ...COMPARISON_MODES]) {
        const ruw = `periode=${preset === "custom" ? "2026-03..2026-08" : preset}${v ? `&vergelijk=${v}` : ""}`;
        const oud = periodeUitParams(zoek(ruw));
        const nieuw = metDagUitParams(zoek(ruw));
        check(`${ruw}: dezelfde keuze, zonder dag`, JSON.stringify(oud) === JSON.stringify(nieuw) && !nieuw?.dag, `${JSON.stringify(oud)} / ${JSON.stringify(nieuw)}`);
        // En terug in de adresbalk precies zoals de vertrouwde weergave hem schrijft.
        const a = new URLSearchParams(); zetPeriodeParams(a, oud);
        check(`${ruw}: dezelfde adresbalk`, a.toString() === alsTekst(dagKeuzeUitParams(zoek(ruw))), `${a} / ${alsTekst(dagKeuzeUitParams(zoek(ruw)))}`);
      }
    }
    check("zonder periode zegt de adresbalk niets", dagKeuzeUitParams(zoek("vergelijk=none")) === null);
    check("een datum die niet bestaat: geen keuze", dagKeuzeUitParams(zoek("periode=2026-02-30..2026-03-02")) === null);
    check("een kapotte periode: geen keuze", dagKeuzeUitParams(zoek("periode=gisteren")) === null);
  }

  console.log("Nieuwe adressen: event, vrije datums, vorige editie, vrije vergelijking, weekdagen");
  {
    const ev = dagKeuzeUitParams(zoek("periode=2026-11-20..2026-11-30&event=bf&vergelijk=previous_edition"))!;
    check("een event met de vorige editie", ev.periode.soort === "dagen" && ev.periode.event === "bf" && ev.vergelijk === "previous_edition");
    check("heen en terug hetzelfde adres", alsTekst(ev) === "periode=2026-11-20..2026-11-30&event=bf&vergelijk=previous_edition", alsTekst(ev));
    check("de vorige editie zonder event wordt vorig jaar",
      dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30&vergelijk=previous_edition"))!.vergelijk === "same_dates_last_year");
    check("de vorige editie bij maanden wordt vorig jaar", dagKeuzeUitParams(zoek("periode=last_3m&vergelijk=previous_edition"))!.vergelijk === "same_dates_last_year");
    const vrij = dagKeuzeUitParams(zoek("periode=2026-11-30..2026-11-17&vergelijk=2025-11-14..2025-11-01"))!;
    check("omgedraaide datums worden rechtgezet", vrij.periode.soort === "dagen" && vrij.periode.start === "2026-11-17" && vrij.eigen?.start === "2025-11-01");
    check("een vrije vergelijking in de adresbalk", alsTekst(vrij) === "periode=2026-11-17..2026-11-30&vergelijk=2025-11-01..2025-11-14", alsTekst(vrij));
    const uit = dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30&weekdag=uit"))!;
    check("weekdagen uit blijft bewaard bij een korte periode", uit.weekdag === false && alsTekst(uit).endsWith("weekdag=uit"));
    check("bij een lange periode doet weekdagen niet mee", dagKeuzeUitParams(zoek("periode=2026-01-01..2026-06-30&weekdag=uit"))!.weekdag === true);
    check("bij een andere vergelijking ook niet", dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30&vergelijk=none&weekdag=uit"))!.weekdag === true);
    // Maanden met een vrije vergelijking: kan niet als maandkeuze, dus met dag.
    const mv = metDagUitParams(zoek("periode=last_3m&vergelijk=2025-01-01..2025-03-31"))!;
    check("maanden tegen een vrije periode dragen dag", mv.dag?.vergelijk === "custom" && mv.preset === "last_3m");
    // De vertrouwde weergave leest een nieuw adres niet half: geen periode, dus de bewaarde keuze.
    check("de vertrouwde weergave negeert een periode per dag", periodeUitParams(zoek("periode=2026-11-20..2026-11-30&event=bf")) === null);
  }

  console.log("De cookie: dezelfde schrijfwijze, ook per dag");
  {
    const k = metDag(dagKeuzeUitParams(zoek("periode=2026-11-20..2026-11-30&event=bf&vergelijk=previous_edition"))!);
    const regel = periodeCookieRegel(k, "/client/demo")!;
    const terug = periodeUitCookie(regel.split(";")[0].slice(regel.indexOf("=") + 1));
    check("heen en terug door de cookie", JSON.stringify(terug) === JSON.stringify(k), `${JSON.stringify(terug)} / ${JSON.stringify(k)}`);
    const m: PeriodeKeuze = { preset: "last_6m", custom: null, comparison: "previous_period" };
    const rm = periodeCookieRegel(m, "/client/demo")!;
    check("een maandkeuze staat er zoals altijd", rm.startsWith("overzicht-periode=periode=last_6m&vergelijk=previous_period;"), rm);
  }

  console.log("De standaarden");
  {
    const basis = dagKeuzeUitMaand({ preset: "last_12m", custom: null, comparison: "same_period_last_year" });
    const bf = { soort: "dagen" as const, start: BF26.start, eind: BF26.eind, event: "bf" };
    check("een event: de vorige editie", kiesPeriode(basis, bf, { expliciet: false, heeftVorigeEditie: true }).vergelijk === "previous_edition");
    check("een event zonder vorige editie: vorig jaar", kiesPeriode(basis, { soort: "dagen", start: MD26.start, eind: MD26.eind, event: "md" }, { expliciet: false, heeftVorigeEditie: false }).vergelijk === "same_dates_last_year");
    const zelf = schoneDagKeuze({ ...basis, vergelijk: "previous_period" });
    check("zelf gekozen in deze sessie: blijft staan bij een event", kiesPeriode(zelf, bf, { expliciet: true, heeftVorigeEditie: true }).vergelijk === "previous_period");
    const ed = kiesPeriode(basis, bf, { expliciet: false, heeftVorigeEditie: true });
    const terug = kiesPeriode(ed, { soort: "maanden", preset: "last_3m", custom: null }, { expliciet: true });
    check("van een event naar maanden: de vorige editie wordt vorig jaar", terug.vergelijk === "same_dates_last_year");
    check("maanden, niet zelf gekozen: vorig jaar", kiesPeriode(schoneDagKeuze({ ...basis, vergelijk: "none" }), { soort: "maanden", preset: "last_6m", custom: null }, { expliciet: false }).vergelijk === "same_dates_last_year");
    check("maanden, zelf niets gekozen: blijft niets", kiesPeriode(schoneDagKeuze({ ...basis, vergelijk: "none" }), { soort: "maanden", preset: "last_6m", custom: null }, { expliciet: true }).vergelijk === "none");
  }

  console.log("De vorige editie: alleen bij een event, anders uitgeschakeld met de reden");
  {
    const maanden = lostDagKeuzeOp(dagKeuzeUitMaand({ preset: "last_12m", custom: null, comparison: "same_period_last_year" }), RANGE, EVENTS);
    check("zonder event niet kiesbaar", !maanden.vorigeEditie.kan);
    check("met de reden", vergelijkUitleg(maanden, "previous_edition").includes("Alleen bij een event"), vergelijkUitleg(maanden, "previous_edition"));
    check("kiezen verandert dan niets", JSON.stringify(kiesVergelijk(maanden, "previous_edition")) === JSON.stringify(maanden.keuze));
    const html = renderToStaticMarkup(createElement(VergelijkDeel, { staat: maanden, scope: "t" }));
    const radio = /<button[^>]*data-modus="previous_edition"[^>]*>/.exec(html)?.[0] ?? "";
    check("in de radiogroep: aria-disabled", radio.includes('aria-disabled="true"') && radio.includes('role="radio"') && radio.includes('aria-checked="false"'), radio);
    check("de gekozen keuze is aria-checked", /data-modus="same_dates_last_year"/.test(html) && /aria-checked="true"[^>]*data-modus="same_dates_last_year"/.test(html));
    check("weekdagen gelijk staat er niet bij maanden", !html.includes("Weekdagen gelijk"));
    // De focusval: bij de standaardkeuze (12 mnd tegen vorig jaar) is de gekozen radio de laatste
    // die Tab bereikt, niet de niet-gekozen "Een vrije periode" met tabindex -1.
    const velden = [...html.matchAll(/<(?:button|input)\b[^>]*>/g)].map((m) => ({
      tag: m[0], tabIndex: Number(/tabindex="(-?\d+)"/i.exec(m[0])?.[1] ?? 0),
    }));
    const tabbaar = alleenTabbaar(velden);
    const laatste = tabbaar[tabbaar.length - 1]?.tag ?? "";
    check("de focusval: de laatste tabbare is de gekozen radio", laatste.includes('aria-checked="true"') && laatste.includes('data-modus="same_dates_last_year"'), laatste);
    check("de focusval: ongefilterd was dat de vrije periode", velden[velden.length - 1]?.tag.includes('data-modus="custom"') ?? false);

    const md = lostDagKeuzeOp(schoneDagKeuze({ periode: { soort: "dagen", start: MD26.start, eind: MD26.eind, event: "md" }, vergelijk: "same_dates_last_year", eigen: null, weekdag: true }), RANGE, EVENTS);
    check("een event zonder eerdere editie: uitgeschakeld, met de reden", !md.vorigeEditie.kan && vergelijkUitleg(md, "previous_edition").includes("geen eerdere editie"));
    check("terwijl de events laden: ook uitgeschakeld", !lostDagKeuzeOp(md.keuze, RANGE, null).vorigeEditie.kan);
    const weg = lostDagKeuzeOp(dagKeuzeUitParams(zoek("periode=2026-11-20..2026-11-30&event=verdwenen&vergelijk=previous_edition"))!, RANGE, EVENTS);
    check("een event dat niet meer bestaat: de regel en de radio zeggen hetzelfde",
      !weg.vorigeEditie.kan && vergelijkZin(weg).includes("staat niet meer zo in Instellingen") && weg.vergelijking.reden === vergelijkUitleg(weg, "previous_edition"),
      `${vergelijkZin(weg)} / ${vergelijkUitleg(weg, "previous_edition")}`);

    const bf = lostDagKeuzeOp(dagKeuzeUitParams(zoek("periode=2026-11-20..2026-11-30&event=bf&vergelijk=previous_edition"))!, RANGE, EVENTS);
    check("met een event: kiesbaar", bf.vorigeEditie.kan);
    check("de datums zoals ingevuld", bf.vergelijking.periode?.start === "2025-11-21" && bf.vergelijking.periode?.eind === "2025-12-01", JSON.stringify(bf.vergelijking.periode));
    check("de regel zegt wat tegen wat, met datums", vergelijkZin(bf).includes("Black Friday 2026 (20 t/m 30 nov 2026)") && vergelijkZin(bf).includes("Black Friday 2025 (21 nov 2025 t/m 1 dec 2025, zoals ingevuld)"), vergelijkZin(bf));
    const html2 = renderToStaticMarkup(createElement(VergelijkDeel, { staat: bf, scope: "t" }));
    check("en in de radiogroep niet uitgeschakeld", !/<button[^>]*aria-disabled="true"[^>]*data-modus="previous_edition"/.test(html2));
  }

  console.log("Weekdagen gelijk: alleen bij een korte periode tegen vorig jaar, standaard aan");
  {
    const kort = lostDagKeuzeOp(dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30"))!, RANGE, EVENTS);
    check("zichtbaar", kort.weekdagZichtbaar);
    check("standaard 52 weken terug", kort.vergelijking.periode?.start === "2025-11-18" && vergelijkZin(kort).includes("Vrijdag staat tegen vrijdag"), JSON.stringify(kort.vergelijking.periode));
    const html = renderToStaticMarkup(createElement(VergelijkDeel, { staat: kort, scope: "t" }));
    check("de schakelaar staat er, aangevinkt", html.includes("Weekdagen gelijk") && /<input type="checkbox"[^>]*checked=""/.test(html));
    const uit = lostDagKeuzeOp(dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30&weekdag=uit"))!, RANGE, EVENTS);
    check("uit: dezelfde kalenderdatums", uit.vergelijking.periode?.start === "2025-11-17");
    const ander = lostDagKeuzeOp(dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30&vergelijk=previous_period"))!, RANGE, EVENTS);
    check("niet zichtbaar bij een andere vergelijking", !ander.weekdagZichtbaar);
    check("de periode ervoor is even lang", ander.vergelijking.periode?.start === "2026-11-03" && ander.vergelijking.periode?.eind === "2026-11-16");
  }

  console.log("Niets: alleen totalen, geen pijlen, percentages of \"was\"");
  {
    const niets = lostDagKeuzeOp(dagKeuzeUitParams(zoek("periode=2026-11-17..2026-11-30&vergelijk=none"))!, RANGE, EVENTS);
    check("geen vergelijkingsperiode", niets.vergelijking.periode === null);
    check("de regel zegt het", vergelijkZin(niets).includes("Geen vergelijking, dus geen pijlen of percentages"), vergelijkZin(niets));
    const totaal = { conversions: 412, revenue: 61800, adSpend: 9270 };
    const cijfers = { vergelijking: null, fouten: [], alleen: { periode: niets.periode, perKanaal: [], totaal, gemengd: false } } as unknown as DagCijfers;
    const tegels = dagTegels(cijfers);
    check("geen delta op een van de vijf tegels", tegels.length === 5 && tegels.every((t) => t.delta === undefined));
    const waarde = { ...periodeWaarde(metDag(niets.keuze), null, () => {}, { events: EVENTS, setDag: () => {} }) } as PeriodState;
    const html = tekst(renderToStaticMarkup(vast(waarde, createElement(DagKerncijfers, { cijfers, laden: false }))));
    check("in beeld geen percentage en geen \"was\"", !/%/.test(html) && !/\bwas\b/.test(html) && html.includes("totaal in deze periode"), html);
    check("de cijfers staan er wel", html.includes("412") && html.includes("61.800"));

    // Ter vergelijking: met een vergelijking staan ze er wel.
    const met = { vergelijking: { huidig: { totaal }, vorig: { totaal: { conversions: 367, revenue: 51294, adSpend: 9000 } }, perKanaal: [], ongepaard: [],
      vergelijking: { start: "2025-11-21", eind: "2025-12-01" },
      deltas: { conversions: delta(412, 367), revenue: delta(61800, 51294), adSpend: delta(9270, 9000) } }, alleen: null, fouten: [] } as unknown as DagCijfers;
    check("met een vergelijking wel een delta", dagTegels(met).every((t) => t.delta !== undefined));
  }

  console.log("Hele maanden: hetzelfde venster en dezelfde vergelijking als altijd");
  {
    const stand = { laatsteVolleMaand: "2026-08", partieel: { maand: "2026-09", tmDag: 26, dagenInMaand: 30 }, dataTot: "2026-09-26" };
    for (const preset of PERIOD_PRESETS) {
      for (const comparison of COMPARISON_MODES) {
        const k: PeriodeKeuze = { preset, custom: preset === "custom" ? { start: "2025-03", end: "2026-12" } : null, comparison };
        const oud = periodeWaarde(k, stand, () => {});
        const nieuw = periodeWaarde(metDag(dagKeuzeUitMaand(k)), stand, () => {}, { events: EVENTS, setDag: () => {} });
        check(`${preset}/${comparison}: de maandweg`, nieuw.dag?.maandPad === true);
        check(`${preset}/${comparison}: dezelfde maanden`, JSON.stringify([oud.range, oud.compareRange]) === JSON.stringify([nieuw.range, nieuw.compareRange]),
          `${JSON.stringify([oud.range, oud.compareRange])} / ${JSON.stringify([nieuw.range, nieuw.compareRange])}`);
      }
    }
    // Een periode per dag: de blokken per maand krijgen de maanden die hij raakt, en zeggen dat.
    const bf = periodeWaarde(metDag(dagKeuzeUitParams(zoek("periode=2026-11-20..2026-11-30&event=bf&vergelijk=previous_edition"))!), stand, () => {}, { events: EVENTS, setDag: () => {} });
    check("de maanden die de periode raken, niet geklemd", bf.range.start === "2026-11" && bf.range.end === "2026-11", JSON.stringify(bf.range));
    check("de vergelijking in maanden: die van de vorige editie", JSON.stringify(bf.compareRange) === JSON.stringify({ start: "2025-11", end: "2025-12" }), JSON.stringify(bf.compareRange));
    const label = tekst(renderToStaticMarkup(vast(bf, createElement(Vensterlabel, { soort: "periode" }))));
    check("het vensterlabel zegt per maand", label === "volgt periode · per maand: nov 2026", label);
    const maandLabel = tekst(renderToStaticMarkup(vast(periodeWaarde({ preset: "last_3m", custom: null, comparison: "previous_period" }, stand, () => {}, { events: EVENTS, setDag: () => {} }), createElement(Vensterlabel, { soort: "periode" }))));
    check("bij hele maanden het label van altijd", maandLabel === "volgt periode · jun–aug 2026", maandLabel);
    // Zonder dagmodus (de vertrouwde weergave) is er geen dag, en geen verschil.
    check("de vertrouwde weergave kent geen dag", periodeWaarde({ preset: "last_3m", custom: null, comparison: "none" }, stand, () => {}).dag === null);
  }

  console.log("Google per week, in een regel");
  {
    const noot = googleWeekNoot({ start: "2026-11-20", eind: "2026-11-30" }, ["google", "meta", "linkedin"]);
    check("de weken die de periode raken", !!noot?.includes("16 nov 2026 t/m 6 dec 2026") && noot.includes("Meta en LinkedIn tellen per dag"), String(noot));
    check("niet bij hele maanden", googleWeekNoot({ start: "2026-10-01", eind: "2026-10-31" }, ["google"]) === null);
    check("niet zonder Google", googleWeekNoot({ start: "2026-11-20", eind: "2026-11-30" }, ["meta"]) === null);
  }

  console.log("De kiezer dicht: twee knoppen naast elkaar en de regel eronder");
  {
    const waarde = periodeWaarde(metDag(dagKeuzeUitParams(zoek("periode=2026-11-20..2026-11-30&event=bf&vergelijk=previous_edition"))!), null, () => {}, { events: EVENTS, setDag: () => {} });
    const html = renderToStaticMarkup(vast(waarde,
      createElement(PeriodeKiezer, { scope: "t", events: EVENTS, kanalen: ["google", "meta"], onNaarEvents: () => {} })));
    const knoppen = html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>/g) ?? [];
    check("twee echte knoppen die een dialoog openen", knoppen.length === 2 && knoppen.every((k) => k.includes('type="button"') && k.includes('aria-expanded="false"')), String(knoppen.length));
    const t = tekst(html);
    check("Periode met het event en zijn datums", t.includes("Periode Black Friday 2026 · 20 t/m 30 nov 2026"), t);
    check("Vergelijk met de vorige editie", t.includes("Vergelijk met De vorige editie"), t);
    check("de regel eronder", html.includes("data-vergelijkzin") && t.includes("tegen Black Friday 2025"), t);
    check("de regel over Google per week", html.includes("data-googlenoot") && t.includes("Google telt op weekniveau"), t);
    check("dicht: geen dialoog in beeld", !html.includes('role="dialog"'));
    // Zonder dagmodus (de vertrouwde weergave) rendert hij niets.
    const oud = renderToStaticMarkup(vast(periodeWaarde({ preset: "last_3m", custom: null, comparison: "none" }, null, () => {}),
      createElement(PeriodeKiezer, { scope: "t", events: EVENTS, kanalen: ["google"], onNaarEvents: () => {} })));
    check("zonder dagmodus niets", oud === "");
  }
});

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
