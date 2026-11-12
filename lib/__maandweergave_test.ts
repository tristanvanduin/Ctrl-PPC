// Regressietest: de maandweergaven van de forecast (MonthlyOverview, MonthlyTrendBars) en de
// gedeelde weergaveregels in lib/forecast-format.ts (isOptelbaar, zonderData).
// Draaien: tsx lib/__maandweergave_test.ts
//
// Wat er misging, en pas zichtbaar werd toen de forecast de datastand ging volgen:
//   - Een maand zonder realisatie en zonder prognose (vóór de start van een kanaal, of een gat)
//     stond er als "Prognose 0" met een groene of rode ratio. Die ratio is de projectiefactor: er is
//     niets gemeten. De beurssectie toonde zulke weken al als "Geen data"; de maandweergaven niet.
//   - De kaarten heetten altijd "Vorige / Huidige / Volgende maand", met de voortgang van de
//     browserklok. Met data t/m 25 augustus is t/m juli gerealiseerd, en dan was de "Huidige maand"
//     op 1 november augustus, 3% van de maand voorbij.
//   - Het tempo voor een maand zonder weekdata deelde de YTD (t/m juli) door de dag van het jaar
//     volgens de browser (305 op 1 november), en heette dan "Gerealiseerd".

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as weergave from "./forecast-format";
import * as maand from "../components/dashboard/monthly-overview";
import * as rapport from "../components/dashboard/report-export";
import { computeForecast } from "./forecast";
import { liveDataStand } from "./api/client-data-stand";
import type { ClientHistoricalData, MonthlyRecord } from "./types";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const tekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const bron = (pad: string) => readFileSync(join(__dirname, "..", pad), "utf8");
const telt = (heel: string, deel: string) => heel.split(deel).length - 1;

const rec = (month: number, conversions: number): MonthlyRecord =>
  ({ month, conversions, revenue: conversions * 100, adSpend: conversions * 40, weeks: [] });
const vorigJaar = Array.from({ length: 12 }, (_, i) => rec(i + 1, 50));

/** Een kanaal dat in maart 2026 begon, data t/m 25 augustus: t/m juli gerealiseerd. */
const vanafMaart: ClientHistoricalData = {
  clientId: "test",
  targetCurrentYear: { conversions: 700, revenue: 70_000, adSpend: 28_000 },
  historicalYears: { 2025: vorigJaar },
  currentYearData: Array.from({ length: 12 }, (_, i) => (i >= 2 && i <= 6 ? rec(i + 1, 60) : null)),
  currentYear: 2026,
  dataStand: {
    laatsteVolleMaand: "2026-07", partieel: { maand: "2026-08", tmDag: 25, dagenInMaand: 31 },
    verwachteMaand: "2026-10", maandenAchter: 3, dataTot: "2026-08-25", uitgesloten: [],
  },
};

/** Een account dat bij is: t/m oktober vol, en het is 15 november. */
const bij: ClientHistoricalData = {
  ...vanafMaart,
  currentYearData: Array.from({ length: 12 }, (_, i) => (i <= 9 ? rec(i + 1, 60) : null)),
  dataStand: {
    laatsteVolleMaand: "2026-10", partieel: null, verwachteMaand: "2026-10", maandenAchter: 0,
    dataTot: "2026-11-14", uitgesloten: [],
  },
};

// ── De gedeelde regels ────────────────────────────────────────────────────────────────────────
console.log("isOptelbaar / zonderData (lib/forecast-format.ts)");
{
  const { isOptelbaar, zonderData } = weergave as unknown as {
    isOptelbaar?: (m: string) => boolean; zonderData?: (p: { realized: number | null; forecast: number | null }) => boolean;
  };
  check("isOptelbaar bestaat", typeof isOptelbaar === "function");
  check("zonderData bestaat", typeof zonderData === "function");
  if (isOptelbaar) {
    check("conversies en omzet tellen op", isOptelbaar("conversions") && isOptelbaar("revenue"));
    check("ROAS en CPA zijn verhoudingen", !isOptelbaar("roas") && !isOptelbaar("cpa"));
  }
  if (zonderData) {
    check("geen realisatie en geen prognose = geen data", zonderData({ realized: null, forecast: null }));
    check("een prognose van 0 is wel data", !zonderData({ realized: null, forecast: 0 }));
    check("een realisatie van 0 is wel data", !zonderData({ realized: 0, forecast: null }));
  }
  // Niemand schrijft de regel nog zelf uit.
  for (const pad of ["lib/forecast.ts", "components/dashboard/fair-weeks-overview.tsx", "components/dashboard/channel-forecast-overview.tsx"]) {
    const b = bron(pad);
    check(`${pad}: geen eigen "conversions || revenue" als optelregel`,
      !/(const\s+(optelbaar|additief|toonVoortgang)\s*=\s*metric\s*===\s*"conversions"\s*\|\|)/.test(b));
  }
  check("fair-weeks-overview.tsx heeft geen eigen zonderData meer",
    !/function\s+zonderData\s*\(/.test(bron("components/dashboard/fair-weeks-overview.tsx")));
}

// ── De voortgang van de "huidige" kaart ────────────────────────────────────────────────────────
console.log("maandVoortgang (monthly-overview.tsx)");
{
  const f = (maand as { maandVoortgang?: unknown }).maandVoortgang as undefined
    | ((j: number, m: number, s: ClientHistoricalData["dataStand"], v: string) => { tmDag: number; dagenInMaand: number; isKalendermaand: boolean } | null);
  check("monthly-overview.tsx exporteert maandVoortgang", typeof f === "function");
  if (f) {
    const aug = f(2026, 8, vanafMaart.dataStand, "2026-11-01");
    check("augustus partieel: 25 van 31, geen kalendermaand", aug?.tmDag === 25 && aug.dagenInMaand === 31 && aug.isKalendermaand === false, JSON.stringify(aug));
    const nov = f(2026, 11, bij.dataStand, "2026-11-15");
    check("de lopende maand: dag 15 van 30 (Amsterdam, niet de browserklok)", nov?.tmDag === 15 && nov.dagenInMaand === 30 && nov.isKalendermaand, JSON.stringify(nov));
    check("een maand die verder achter ligt: geen voortgang", f(2026, 9, vanafMaart.dataStand, "2026-11-01") === null);
    check("schrikkelfebruari als lopende maand: 29 dagen", f(2028, 2, null, "2028-02-10")?.dagenInMaand === 29);
  }
}

// ── De kaarten en de strook, gerenderd ─────────────────────────────────────────────────────────
console.log("MonthlyOverviewView gerenderd");
{
  const View = (maand as { MonthlyOverviewView?: unknown }).MonthlyOverviewView;
  check("monthly-overview.tsx exporteert MonthlyOverviewView", typeof View === "function");
  if (typeof View === "function") {
    type Props = { data: ClientHistoricalData; forecast: ReturnType<typeof computeForecast>; vandaag: string };
    const render = (data: ClientHistoricalData, vandaag: string) =>
      tekst(createElement(View as ComponentType<Props>, { data, forecast: computeForecast(data), vandaag }));

    const achter = render(vanafMaart, "2026-11-01");
    const fc = computeForecast(vanafMaart);
    check("voorwaarde: de forecast telt t/m juli", fc.conversions.kpi.realizedThroughMonth === 7, String(fc.conversions.kpi.realizedThroughMonth));
    check("voorwaarde: januari en februari hebben geen realisatie en geen prognose",
      fc.conversions.points[0].realized === null && fc.conversions.points[0].forecast === null && fc.conversions.points[1].forecast === null);

    check("de kaarten gaan over juli, augustus en september", achter.includes("Jul 2026") && achter.includes("Aug 2026") && achter.includes("Sep 2026"));
    check("data loopt achter: geen \"Huidige maand\" voor augustus op 1 november", !achter.includes("Huidige maand") && !achter.includes("Vorige maand"), achter.slice(0, 400));
    check("labels naar de data: \"Laatste volle maand\" en \"Data t/m 25 aug\"",
      achter.includes("Laatste volle maand") && achter.includes("Data t/m 25 aug") && achter.includes("Maand erna"));
    check("voortgang van augustus uit de datastand: 81% van maand, niet 3%", achter.includes("81% van maand") && !achter.includes("3% van maand"), achter);
    check("een getal uit het tempo heet geen \"Gerealiseerd\" maar \"Geschat tot nu\"", achter.includes("Geschat tot nu"));
    // Het tempo: 5 x 60 conversies over 1 maart t/m 31 juli (153 dagen), maal 25 dagen = 49.
    // Hier stond 35: dat deelde door 1 januari t/m 31 juli (212 dagen), terwijl dit kanaal pas in
    // maart begon. Januari en februari hebben geen rij, dus er is daar geen tempo gemeten; het
    // werkelijke dagtempo (60 per maand) zit op 49 voor 25 augustusdagen, niet op 35.
    check("het tempo deelt door de dagen vanaf de eerste maand met een rij t/m juli: 49",
      /Geschat tot nu 49 /.test(achter), (achter.match(/Geschat tot nu \S+/) ?? [""])[0]);
    // Met een landfilter: landGefilterdeData vult elke maand vanaf januari aan met een nulrecord,
    // terwijl de kaart de forecast van het ACCOUNT krijgt (useForecast), die pas in maart begint. De
    // deler kwam uit de gefilterde reeks (212 dagen) en de teller uit het account: weer 35. De deler
    // hoort bij de reeks waarover ytdRealized loopt.
    const landData: ClientHistoricalData = {
      ...vanafMaart,
      currentYearData: Array.from({ length: 12 }, (_, i) => (i <= 6 ? rec(i + 1, i >= 2 ? 30 : 0) : null)),
    };
    const metLand = tekst(createElement(View as ComponentType<Props>, { data: landData, forecast: fc, vandaag: "2026-11-01" }));
    check("met een landfilter (nulrecords vanaf januari, forecast van het account): ook 49",
      /Geschat tot nu 49 /.test(metLand), (metLand.match(/Geschat tot nu \S+/) ?? [""])[0]);
    check("januari en februari in de strook: \"geen data\", geen ratio", telt(achter, "geen data") === 2, String(telt(achter, "geen data")));
    check("januari en februari in de strook: een streepje, geen 0", /Jan — /.test(achter) && /Feb — /.test(achter), (achter.match(/Jan \S+/) ?? [""])[0]);

    const bijTekst = render(bij, "2026-11-15");
    check("data bij: \"Vorige maand\", \"Huidige maand\", \"Volgende maand\"",
      bijTekst.includes("Vorige maand") && bijTekst.includes("Huidige maand") && bijTekst.includes("Volgende maand"));
    check("data bij: voortgang van vandaag, 15 van 30 = 50%", bijTekst.includes("50% van maand"));
    check("data bij: geen \"geen data\"", !bijTekst.includes("geen data") && !bijTekst.includes("Geen data"));

    // Januari: nog niets gerealiseerd in het nieuwe jaar (realizedThroughMonth 0), de live API
    // levert t/m gisteren. De eerste kaart was dan januari met "Laatste volle maand", terwijl
    // januari de lopende maand is, en februari heette "Nog niet binnen". Elk jaar, de hele maand.
    const januari: ClientHistoricalData = {
      ...vanafMaart,
      currentYear: 2027,
      historicalYears: { 2026: vorigJaar },
      currentYearData: Array.from({ length: 12 }, () => null),
    };
    check("voorwaarde: in januari is er nog niets gerealiseerd", computeForecast(januari).conversions.kpi.realizedThroughMonth === 0);
    for (const dag of ["2027-01-01", "2027-01-15"]) {
      const jan = render({ ...januari, dataStand: liveDataStand(dag) }, dag);
      check(`${dag}: januari is de huidige maand, niet de laatste volle`,
        jan.includes("Jan 2027 Huidige maand") && !jan.includes("Laatste volle maand"), jan.slice(0, 300));
      check(`${dag}: februari is de volgende maand, niet "Nog niet binnen"`,
        jan.includes("Feb 2027 Volgende maand") && !jan.includes("Nog niet binnen"), jan.slice(0, 300));
      check(`${dag}: geen kaart voor maart en geen vorige maand`, !jan.includes("Mrt 2027") && !jan.includes("Vorige maand"), jan.slice(0, 300));
      check(`${dag}: geen "Geschat tot nu" zonder gerealiseerde dagen`, !jan.includes("Geschat tot nu"), jan.slice(0, 300));
    }
  }
}

// ── MonthlyTrendBars: dezelfde regel, maar zonder renderbare grafiek in node ─────────────────
console.log("MonthlyTrendBars (bron)");
{
  // Bewust aangepast in fase 2. De staven en de CPA-lijn volgen de gekozen periode en lezen de
  // gemeten maanden uit slicePeriod, niet meer de laatste zes punten van de jaarprognose. De regel
  // "een maand zonder data krijgt geen staaf" hoefde daar eerst een eigen voorwaarde voor
  // (zonderData(pt) ? null); nu staat zo'n maand niet eens in de reeks. Het paneel achter een
  // staaf of punt is één gedeeld bestand geworden (maand-metrieken-popover.tsx) en houdt voor de
  // maanden van het prognosejaar dezelfde regel.
  const b = bron("components/dashboard/monthly-trend-bars.tsx");
  check("de staven zijn de gemeten maanden van de gekozen periode (slicePeriod)",
    /slicePeriod\(clientData, \{ start: periodeStart, end: periodeEind \}\)\.months/.test(b) && /usePeriod\(\)/.test(b) && !/\.slice\(-6\)/.test(b));
  check("geen eigen kopie van het paneel meer", b.includes("<MaandMetriekenPopover") && !b.includes("PeriodPopover"));
  const pop = bron("components/dashboard/maand-metrieken-popover.tsx");
  // Het label komt uit geenWaardeLabel: "Geen data", behalve bij kosten zonder conversies (geenNoemer,
  // lib/__geen_noemer_test.ts), die heet "Geen conversies".
  check("de popover zegt \"Geen data\" en geen ratio", pop.includes("mGeenData ? geenWaardeLabel(p, m)") && /!mGeenData && \(/.test(pop)
    && /zonderData\(p\)/.test(pop) && weergave.geenWaardeLabel({}, "cpa") === "Geen data");
  check("een maand buiten het prognosejaar krijgt geen 'verwacht' en geen ratio",
    /maand\.year === prognoseJaar/.test(pop) && /inPrognoseJaar \? forecast\[m\]\.points\[maand\.month - 1\] : undefined/.test(pop));
  const m = bron("components/dashboard/monthly-overview.tsx");
  check("monthly-overview.tsx leest de browserklok niet", !/new Date\(\)/.test(m) && !/getDate\(\)|getMonth\(\)|getFullYear\(\)/.test(m));
}

// ── Dezelfde regel in de maandtabel, de rapportexport en de CPA-lijn ─────────────────────────
// Een maand zonder realisatie en zonder prognose kreeg daar nog steeds de projectiefactor als
// ratio, groen of rood gekleurd: "— — 130%" in de tabel, "- | Prognose | 130%" in het rapport.
console.log("ForecastTable, rapportexport en MonthlyTrendLine");
{
  const fc = computeForecast(vanafMaart);
  const leeg = fc.conversions.points[0];
  const gemeten = fc.conversions.points[2];
  check("voorwaarde: januari is leeg, met een ratio die niets meet", leeg.realized === null && leeg.forecast === null && leeg.monthRatio !== 0);

  const regel = (rapport as { maandRegel?: unknown }).maandRegel as
    undefined | ((pt: typeof leeg) => string);
  check("report-export.tsx exporteert maandRegel", typeof regel === "function");
  if (typeof regel === "function") {
    check("rapport: een lege maand heet \"Geen data\" en krijgt geen ratio",
      regel(leeg) === "| Jan | 58 | - | Geen data | - |", regel(leeg));
    check("rapport: een gemeten maand houdt waarde, label en ratio",
      regel(gemeten) === `| Mrt | 58 | 60 | Gerealiseerd | ${(gemeten.monthRatio * 100).toFixed(0)}% |`, regel(gemeten));
  }

  const t = bron("components/dashboard/forecast-table.tsx");
  check("maandtabel: de ratiocel vraagt zonderData", /zonderData\(pt\)/.test(t));
  check("maandtabel: zonder data een streep in plaats van een percentage", /geenData\s*\?\s*"—"\s*:\s*formatPercent\(ratio,\s*0\)/.test(t));
  check("maandtabel: zonder data geen groen of rood", /geenData\s*\?\s*"text-muted-foreground"/.test(t));

  // Bewust aangepast in fase 2: de CPA-lijn deelt het paneel met de staven (zie hierboven), en
  // zijn punten zijn de gemeten maanden van de gekozen periode.
  const l = bron("components/dashboard/monthly-trend-line.tsx");
  check("CPA-lijn: het gedeelde paneel, geen eigen kopie", l.includes("<MaandMetriekenPopover") && !l.includes("PeriodPopover"));
  check("CPA-lijn: de gemeten maanden van de gekozen periode, en zonder conversies een gat in plaats van nul",
    /slicePeriod\(clientData, \{ start: periodeStart, end: periodeEind \}\)\.months/.test(l)
    && /m\.conversions > 0 \? m\.adSpend \/ m\.conversions : null/.test(l) && !/\.slice\(-6\)/.test(l));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
