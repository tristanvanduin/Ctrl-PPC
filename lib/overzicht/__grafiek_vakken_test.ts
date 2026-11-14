// De hoofdgrafiek over een periode per dag (lib/overzicht/grafiek-vakken.ts en
// components/dashboard/overzicht-hoofdgrafiek.tsx).
// Draaien: tsx --tsconfig ./tsconfig.json lib/overzicht/__grafiek_vakken_test.ts
//
// WAAROM. Op Black Friday (21 nov t/m 1 dec 2025) telden de kerncijfers per dag en tekende de
// grafiek "per maand: nov-dec 2025": twee vensters voor dezelfde periode op één scherm. Deze test
// houdt vast dat de grafiek de dagen zelf volgt, met een korrel naar de lengte, dat de vakken samen
// de kerncijfers zijn, dat een kanaal dat niet liep een gat is en geen nul, dat de vergelijking er
// alleen bij staat als de vakken aan beide kanten even veel dagen tellen, en dat zonder korrel (de
// maandweg, en de schakelaar uit) alles per maand blijft zoals het was.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeSupabase } from "../decision/__fake_supabase";
import { seededDemoClientData } from "../demo/geoclone-demo-data";
import { DEMO_GREENTECH_ID } from "../demo/greentech-mock";
import { demoRows } from "../demo/demo-rows";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "../api/adapter";
import { resolveChannelConversionConfig } from "../analysis/channel-conversion-config";
import type { ClientHistoricalData } from "../types";
import { telDagPeriode, type DagTelInvoer, type GoogleDagRij, type GoogleWeekRij } from "../period/dag-telling";
import { aantalDagen, type DagPeriode } from "../period/dag-periode";
import { addDays } from "../reporting-date";
import { maandagVanWeek } from "../api/google-weekvensters";
import { PeriodProvider } from "../period/period-context";
import { ALLE_KANALEN, type Kanaal } from "../kanalen/beschikbaar";
import type { PeriodeKeuzeMetDag } from "../period/dag-keuze";
import { grafiekMaanden } from "./bovenkant";
import { alsBronReeks } from "../period/apply-period";
import {
  dagGrafiek, googleKorrel, googleVoorbehoud, grafiekVakken, kiesKorrel, vakkenVan, vergelijkVakken, vergelijkWaarde, gatenIn, type GrafiekVak,
} from "./grafiek-vakken";
import { OverzichtHoofdgrafiek } from "../../components/dashboard/overzicht-hoofdgrafiek";
import { Vensterlabel } from "../../components/ui/vensterlabel";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const dicht = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const tekst = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const BF: DagPeriode = { start: "2025-11-21", eind: "2025-12-01" };

console.log("De korrel past bij de lengte");
{
  const p = (n: number): DagPeriode => ({ start: "2025-01-01", eind: addDays("2025-01-01", n - 1) });
  check("Black Friday (11 dagen): per dag", kiesKorrel(BF) === "dag");
  check("zes weken: nog per dag", kiesKorrel(p(42)) === "dag");
  check("43 dagen: per week", kiesKorrel(p(43)) === "week");
  check("ongeveer zes maanden: per week", kiesKorrel(p(184)) === "week");
  check("daarboven: per maand", kiesKorrel(p(185)) === "maand" && kiesKorrel(p(365)) === "maand");
  // Nooit fijner dan Google kan: zonder dagrijen telt Google per week, en per dag was elk vak een gat.
  check("Google per week: Black Friday per week, niet per dag", kiesKorrel(BF, "week") === "week");
  check("Google per week: een lange periode houdt zijn korrel", kiesKorrel(p(100), "week") === "week" && kiesKorrel(p(365), "week") === "maand");
  check("Google alleen per maand: de maandweg (null), behalve als de lengte al per maand is", kiesKorrel(BF, "maand") === null && kiesKorrel(p(100), "maand") === null && kiesKorrel(p(365), "maand") === "maand");
  check("Google per dag: naar de lengte", kiesKorrel(BF, "dag") === "dag");
}

console.log("De vakken zijn samen precies de periode; weken van maandag t/m zondag, afgekapt");
{
  const p: DagPeriode = { start: "2025-11-05", eind: "2025-12-20" }; // woensdag t/m zaterdag
  const w = vakkenVan(p, "week");
  const aaneen = w.every((v, i) => i === 0 || v.periode.start === addDays(w[i - 1].periode.eind, 1));
  check("aaneengesloten, van de eerste t/m de laatste dag", aaneen && w[0].periode.start === p.start && w[w.length - 1].periode.eind === p.eind);
  check("de eerste week is afgekapt op woensdag 5 nov", w[0].afgekapt && w[0].periode.eind === "2025-11-09" && aantalDagen(w[0].periode) === 5, JSON.stringify(w[0]));
  check("de laatste week is afgekapt op zaterdag 20 dec", w[w.length - 1].afgekapt && w[w.length - 1].periode.start === "2025-12-15" && aantalDagen(w[w.length - 1].periode) === 6);
  check("de weken ertussen zijn hele weken, maandag t/m zondag",
    w.slice(1, -1).every((v) => !v.afgekapt && maandagVanWeek(v.periode.start) === v.periode.start && aantalDagen(v.periode) === 7));
  const d = vakkenVan(BF, "dag");
  check("per dag: elf vakken van één dag", d.length === 11 && d.every((v) => v.periode.start === v.periode.eind));
  const m = vakkenVan({ start: "2025-01-15", eind: "2025-09-10" }, "maand");
  check("per maand: de eerste en de laatste afgekapt", m.length === 9 && m[0].afgekapt && m[0].periode.start === "2025-01-15" && m[8].periode.eind === "2025-09-10" && !m[1].afgekapt);
}

async function main() {
  // Recharts meldt in react-dom/server dat de container geen maat heeft; dat is de server, geen fout.
  console.warn = () => {};
  const rijen = demoRows();
  const sb = new FakeSupabase();
  for (const [tabel, r] of Object.entries(rijen)) sb.seed(tabel, r);
  const api = await seededDemoClientData(sb as never, DEMO_GREENTECH_ID);
  const maanden: ClientHistoricalData = buildClientDataFromApi(
    DEMO_GREENTECH_ID, api.historicalYears as YearDataInput[], api.currentYearMonthly as ApiMonthlyData[],
    api.currentYearWeekly as ApiWeeklyData[], api.targetCurrentYear, api.currentYear, api.realizedThroughMonth,
  );
  const cs = rijen.client_settings.find((r) => r.client_id === DEMO_GREENTECH_ID)!;
  const convConfig = resolveChannelConversionConfig(cs.channel_conversion_config as never);
  const van = (t: string) => (rijen[t] ?? []).filter((r) => r.client_id === DEMO_GREENTECH_ID) as Record<string, unknown>[];
  const dagen = van("ads_account_daily") as unknown as GoogleDagRij[];
  const invoer: DagTelInvoer = {
    google: { maanden, dagen, weken: null },
    dagkanalen: { meta: van("meta_account_daily"), linkedin: van("linkedin_account_daily"), microsoft: van("microsoft_account_daily") },
    convConfig,
  };
  const kanalen: Kanaal[] = [...ALLE_KANALEN];

  console.log("De demo: de vakken tellen samen op tot de kerncijfers van dezelfde periode");
  for (const p of [BF, { start: "2025-09-10", eind: "2025-12-20" }]) {
    const korrel = kiesKorrel(p)!;
    const vakken = grafiekVakken(p, korrel, invoer, kanalen);
    const kern = telDagPeriode(p, invoer);
    check(`${p.start} t/m ${p.eind} (${korrel}): geen enkel kanaal valt terug op hele maanden`, vakken.every((v) => v.grof.length === 0), JSON.stringify(vakken.map((v) => v.grof)));
    for (const k of kanalen) {
      const t = kern.perKanaal.find((x) => x.kanaal === k)!;
      const som = vakken.reduce((s, v) => s + (v.perKanaal[k]?.conversions ?? 0), 0);
      const kosten = vakken.reduce((s, v) => s + (v.perKanaal[k]?.adSpend ?? 0), 0);
      check(`${korrel}, ${k}: de vakken zijn de kerncijfers`, dicht(som, t.totalen.conversions) && dicht(kosten, t.totalen.adSpend), `${som} / ${t.totalen.conversions}`);
    }
    const totaal = vakken.reduce((s, v) => s + v.conversions, 0);
    check(`${korrel}: alle kanalen samen zijn de eerste tegel`, dicht(totaal, kern.totaal.conversions), `${totaal} / ${kern.totaal.conversions}`);
  }

  console.log("Een kanaal dat (een deel van) de periode niet liep: een gat, geen nul");
  {
    // Meta begint op 25 nov 2025, midden in Black Friday.
    const meta = (invoer.dagkanalen!.meta ?? []).filter((r) => String(r.date) >= "2025-11-25");
    const v = grafiekVakken(BF, "dag", { ...invoer, dagkanalen: { meta } }, ["meta"]);
    const ervoor = v.filter((x) => x.periode.start < "2025-11-25");
    check("de vier dagen ervoor: Meta liep nog niet", ervoor.length === 4 && ervoor.every((x) => x.voorStart.includes("meta") && gatenIn(x).includes("meta")));
    check("vanaf 25 nov telt Meta gewoon", v.filter((x) => x.periode.start >= "2025-11-25").every((x) => gatenIn(x).length === 0));
    const html = renderToStaticMarkup(createElement(PeriodProvider, { scope: "vakken-gat", children: createElement(OverzichtHoofdgrafiek, { maanden: v, kanalen: ["meta"], gekozen: "meta", korrel: "dag" }) }));
    check("de tabel voor schermlezers zegt 'liep nog niet', geen nul", (html.match(/<td>liep nog niet<\/td>/g) ?? []).length === 4);
    check("de voetregel noemt de start per dag", /Meta telt vanaf 25 nov 2025: de vakken daarvoor zijn niet gemeten, geen nul/.test(tekst(html)), tekst(html));

    // Google met een dagopslag die pas op 28 nov begint: de kerncijfers tellen Black Friday dan met
    // heel november per maand en pas vanaf 1 dec per dag (splitsOpDagOpslag). De vakken volgen
    // dezelfde splitsing: ook 28 t/m 30 nov zijn een gat, anders stonden die dagen in de tegel (via
    // de maand) en ernaast nog eens als staaf.
    const laatInvoer: DagTelInvoer = { google: { maanden, dagen: dagen.filter((d) => d.date >= "2025-11-28"), weken: null } };
    const laat = grafiekVakken(BF, "dag", laatInvoer, ["google"]);
    check("Google vóór de dagstart van de periode (1 dec): een gat (grof), ook 28-30 nov; 1 dec per dag",
      laat.slice(0, 10).every((x) => x.grof.includes("google") && x.conversions === 0) && laat[10].grof.length === 0 && laat[10].conversions > 0,
      JSON.stringify(laat.map((x) => [x.periode.start, x.grof, x.conversions])));
    const kern = telDagPeriode(BF, laatInvoer);
    const dec1 = dagen.find((d) => d.date === "2025-12-01")!;
    check("de staaf die er staat is precies het dagdeel van de kerncijfers", dicht(laat[10].conversions, dec1.conversions ?? 0) && kern.perKanaal[0].totalen.conversions > laat[10].conversions);
    const html2 = renderToStaticMarkup(createElement(PeriodProvider, { scope: "vakken-grof", children: createElement(OverzichtHoofdgrafiek, {
      maanden: laat, kanalen: ["google"], gekozen: "google", korrel: "dag", totalen: { google: kern.perKanaal[0].totalen },
    }) }));
    check("de voetregel zegt dat Google 10 van de 11 vakken niet per dag telt, en dat het totaal hem meetelt",
      /Google Ads telt 10 van de 11 vakken niet per dag .*Het totaal rechts telt hem wel mee/.test(tekst(html2)), tekst(html2));
  }

  console.log("De vergelijking: alleen bij dezelfde korrel en even lange vakken");
  {
    const vorigBF: DagPeriode = { start: "2024-11-22", eind: "2024-12-02" }; // vorig jaar, dezelfde weekdagen
    // Microsoft liep in 2024 nog niet: in elk vak een gat aan de vorige kant en niet aan de huidige.
    // Dan geen enkel punt, en dus geen lijn, legenda of kolom, maar wel de reden met het kanaal.
    const alle = dagGrafiek(BF, vorigBF, invoer, kanalen)!;
    const punten = alle.vakken.filter((x, i) => vergelijkWaarde(x, alle.vergelijking?.vorig?.[i], "conversions") !== null).length;
    check("Black Friday tegen 2024 met Microsoft: geen enkel punt, dus geen lijn, met de reden",
      punten === 0 && alle.vergelijking?.vorig === null && /Geen vergelijkingslijn: Microsoft Ads telt aan één kant niet/.test(alle.vergelijking?.reden ?? ""), String(alle.vergelijking?.reden));
    const zonderMs = kanalen.filter((k) => k !== "microsoft");
    const h = { korrel: "dag" as const, vakken: grafiekVakken(BF, "dag", invoer, zonderMs) };
    const v = vergelijkVakken(h, { korrel: kiesKorrel(vorigBF), vakken: grafiekVakken(vorigBF, "dag", invoer, zonderMs) });
    const vPunten = h.vakken.filter((x, i) => vergelijkWaarde(x, v.vorig?.[i], "conversions") !== null).length;
    check("zonder Microsoft: per dag aan beide kanten, dezelfde kanalen, dus elf punten", v.vorig !== null && vPunten === 11 && v.reden === null, `${vPunten} ${v.reden}`);
    // Een deel van de vakken zonder punt: de lijn blijft, de reden zegt hoeveel en welk kanaal.
    const deels = vergelijkVakken(h, { korrel: "dag", vakken: v.vorig!.map((x, i) => (i < 3 ? { ...x, voorStart: ["meta" as Kanaal] } : x)) });
    check("een deel zonder punt: de lijn blijft, met de reden", deels.vorig !== null && /in 3 van de 11 vakken geen punt: Meta telt aan één kant niet/.test(deels.reden ?? ""), String(deels.reden));
    const twintig: DagPeriode = { start: "2024-11-12", eind: "2024-12-01" };
    const dagLang = vergelijkVakken(h, { korrel: "dag", vakken: grafiekVakken(twintig, "dag", invoer, zonderMs) });
    check("dagen tegen een vergelijking met meer dagen: een eigen zin, niet 'de maanden'", dagLang.vorig === null && /telt een ander aantal dagen/.test(dagLang.reden ?? "") && !/maanden/.test(dagLang.reden ?? ""), String(dagLang.reden));
    const lang: DagPeriode = { start: "2024-09-01", eind: "2024-11-30" };
    const anders = vergelijkVakken(h, { korrel: kiesKorrel(lang), vakken: grafiekVakken(lang, kiesKorrel(lang)!, invoer, kanalen) });
    check("dagen tegen weken: geen lijn, en de reden", anders.vorig === null && /per dag, de vergelijkingsperiode per week/.test(anders.reden ?? ""), String(anders.reden));
    // Twee periodes van 50 dagen die op een andere weekdag beginnen: andere weken.
    const a: DagPeriode = { start: "2025-10-01", eind: addDays("2025-10-01", 49) };
    const b: DagPeriode = { start: "2024-10-01", eind: addDays("2024-10-01", 49) };
    const wk = vergelijkVakken({ korrel: "week", vakken: grafiekVakken(a, "week", invoer, kanalen) }, { korrel: "week", vakken: grafiekVakken(b, "week", invoer, kanalen) });
    check("weken die anders vallen: geen lijn, en de reden", wk.vorig === null && /weken vallen in de vergelijkingsperiode anders/.test(wk.reden ?? ""), String(wk.reden));
    // Een vak waarin aan één kant een kanaal een gat heeft: geen punt.
    const metGat = { ...h.vakken[0], voorStart: ["meta" as Kanaal] } as GrafiekVak;
    check("een kanaal met een gat aan één kant: geen vergelijkingspunt", vergelijkWaarde(metGat, h.vakken[0], "conversions") === null && vergelijkWaarde(h.vakken[0], h.vakken[0], "conversions") === h.vakken[0].conversions);

    const dag = (vergelijk: "none" | "same_dates_last_year"): PeriodeKeuzeMetDag => ({
      preset: "last_12m", custom: null, comparison: "none",
      dag: { periode: { soort: "dagen", start: BF.start, eind: BF.eind, event: null }, vergelijk, eigen: null, weekdag: true },
    });
    const kern = telDagPeriode(BF, { ...invoer, dagkanalen: { meta: invoer.dagkanalen!.meta, linkedin: invoer.dagkanalen!.linkedin } });
    const totalen = Object.fromEntries(kern.perKanaal.map((x) => [x.kanaal, x.totalen]));
    const html = renderToStaticMarkup(createElement(PeriodProvider, { scope: "vakken-bf", dagModus: true, beginKeuze: dag("same_dates_last_year"), children: createElement(OverzichtHoofdgrafiek, {
      maanden: h.vakken, kanalen: zonderMs, gekozen: null, korrel: "dag", totalen,
      vergelijking: { periode: "22 nov t/m 2 dec 2024", vakken: v.vorig, reden: null },
    }) }));
    const t = tekst(html);
    check("de kop zegt per dag, het label de dagen zelf", /Conversies per dag/.test(t) && /volgt periode · per dag: 21 nov 2025 t\/m 1 dec 2025/.test(t) && !/per maand: nov/.test(t), t.slice(0, 300));
    check("het aria-label en de caption noemen de dagen, niet de maanden", /aria-label="Conversies per dag, 21 nov 2025 t\/m 1 dec 2025"/.test(html)
      && /<caption>[^<]*over 21 nov 2025 t\/m 1 dec 2025<\/caption>/.test(html), /aria-label="Conversies[^"]*"/.exec(html)?.[0] ?? "");
    check("de tabel voor schermlezers: elf dagen, met de vergelijking, in een sr-only div", (html.match(/<th scope="row">/g) ?? []).length === 11
      && /<div class="sr-only"><table>/.test(html) && /Vergelijking \(22 nov t\/m 2 dec 2024\)<\/th>/.test(html));
    const totaalRechts = /Totaal<\/dt><dd[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
    check("de tabel rechts telt op tot de eerste tegel", Number(totaalRechts.replace(/\./g, "")) === Math.round(kern.totaal.conversions), `${totaalRechts} / ${kern.totaal.conversions}`);

    const geenLijn = renderToStaticMarkup(createElement(PeriodProvider, { scope: "vakken-bf2", dagModus: true, beginKeuze: dag("same_dates_last_year"), children: createElement(OverzichtHoofdgrafiek, {
      maanden: h.vakken, kanalen: zonderMs, gekozen: null, korrel: "dag", totalen,
      vergelijking: { periode: "1 sep t/m 30 nov 2024", vakken: null, reden: anders.reden },
    }) }));
    check("zonder te paren vakken: geen vergelijkingskolom, wel de reden", !/Vergelijking \(/.test(geenLijn) && /Geen vergelijkingslijn: de gekozen periode telt per dag/.test(tekst(geenLijn)));

    console.log("Zonder korrel (de maandweg, en de schakelaar uit): per maand, zoals het was");
    const label = renderToStaticMarkup(createElement(PeriodProvider, { scope: "vakken-label", dagModus: true, beginKeuze: dag("none"), children: createElement(Vensterlabel, { soort: "periode" }) }));
    check("een blok zonder korrel noemt bij een dagperiode nog steeds de maanden", /volgt periode · per maand: /.test(tekst(label)), tekst(label));
    const reeks = { google: alsBronReeks("google", maanden) };
    const oud = renderToStaticMarkup(createElement(PeriodProvider, { scope: "vakken-oud", children: createElement(OverzichtHoofdgrafiek, {
      maanden: grafiekMaanden(reeks, ["google"], { start: "2025-11", end: "2025-12" }), kanalen: ["google"], gekozen: "google",
    }) }));
    check("de grafiek zonder korrel: per maand, met maanden in de tabel", /Conversies per maand/.test(tekst(oud)) && /<th scope="col">Maand<\/th>/.test(oud)
      && /<th scope="row">nov &#x27;25<\/th>/.test(oud) && !/Vergelijking/.test(oud), oud.slice(-600));
  }

  console.log("Google zonder dagrijen (elke klant behalve de demo, en geen echte sync): per week, nooit 'Geen data'");
  {
    // Weekrijen zoals ads_account_weekly: de dagrijen van de demo opgeteld per maandag, vanaf 2025.
    const perWeek = new Map<string, GoogleWeekRij>();
    for (const d of dagen) {
      const m = maandagVanWeek(d.date);
      const w = perWeek.get(m) ?? { week_start: m, cost: 0, conversions: 0, conversions_value: 0 };
      w.cost = (w.cost ?? 0) + (d.cost ?? 0);
      w.conversions = (w.conversions ?? 0) + (d.conversions ?? 0);
      w.conversions_value = (w.conversions_value ?? 0) + (d.conversions_value ?? 0);
      perWeek.set(m, w);
    }
    const weken = [...perWeek.values()].filter((w) => w.week_start >= "2025-01-06");
    const wInvoer: DagTelInvoer = { ...invoer, google: { maanden, dagen: null, weken } };
    check("googleKorrel: per week", googleKorrel(BF, wInvoer.google)?.korrel === "week");
    const g = dagGrafiek(BF, null, wInvoer, kanalen)!;
    check("Black Friday met Google per week: per week, en de middelste week telt Google gewoon",
      g.korrel === "week" && g.vakken.length === 3 && !g.vakken[1].grof.length && g.vakken[0].grof.includes("google") && g.vakken[2].grof.includes("google"),
      JSON.stringify(g.vakken.map((x) => [x.periode.start, x.grof])));
    const kern = telDagPeriode(BF, wInvoer);
    const voorbehoud = googleVoorbehoud(kern.perKanaal.find((x) => x.kanaal === "google"));
    check("het voorbehoud staat er, ook zonder `venster` (telGoogleWeken zet er geen)", voorbehoud?.kort === "Google per week" && /per week/.test(voorbehoud.uitleg), JSON.stringify(voorbehoud));
    const keuze: PeriodeKeuzeMetDag = { preset: "last_12m", custom: null, comparison: "none",
      dag: { periode: { soort: "dagen", start: BF.start, eind: BF.eind, event: null }, vergelijk: "none", eigen: null, weekdag: true } };
    const render = (vakken: GrafiekVak[], korrel: "dag" | "week") => tekst(renderToStaticMarkup(createElement(PeriodProvider, { scope: `vakken-week-${korrel}`, dagModus: true, beginKeuze: keuze,
      children: createElement(OverzichtHoofdgrafiek, { maanden: vakken, kanalen: ["google"], gekozen: "google", korrel, venster: voorbehoud }) })));
    const t = render(grafiekVakken(BF, "week", wInvoer, ["google"]), "week");
    check("per week: geen 'Geen data', het label zegt per week met het voorbehoud", !/Geen data/.test(t) && /volgt periode · per week: 21 nov 2025 t\/m 1 dec 2025/.test(t) && /Google per week/.test(t), t.slice(0, 400));
    check("het voorbehoud staat ook zichtbaar in de voetregel (het label kapt af op een telefoon)", /Google Ads telt per week \(maandag t\/m zondag\): geteld is/.test(t), t);
    // En als toch elk vak grof is (per dag tegen weekrijen): de grof-regel, nooit "Geen data".
    const t2 = render(grafiekVakken(BF, "dag", wInvoer, ["google"]), "dag");
    check("alle vakken grof: de regel, geen 'Geen data'", !/Geen data/.test(t2) && /Google Ads telt deze periode niet per dag/.test(t2), t2.slice(0, 400));
    // Weekrijen pas vanaf mei 2026 (zoals ads_account_weekly van de demo): Black Friday 2025 kan
    // alleen per hele maand, dan de maandweg.
    const laatWeken: DagTelInvoer = { ...invoer, google: { maanden, dagen: null, weken: weken.filter((w) => w.week_start >= "2026-05-11") } };
    check("Google alleen per maand over de periode: dagGrafiek null (de maandweg)", googleKorrel(BF, laatWeken.google)?.korrel === "maand" && dagGrafiek(BF, null, laatWeken, kanalen) === null);
    check("met de vergelijking alleen per maand: geen lijn, met de reden", /alleen per hele maand/.test(dagGrafiek({ start: "2026-06-01", eind: "2026-06-10" }, { start: "2025-06-02", eind: "2025-06-11" }, laatWeken, ["google"])?.vergelijking?.reden ?? ""));
  }

  console.log(`\n${passed} geslaagd, ${failed} mislukt`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
