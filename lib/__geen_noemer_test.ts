// Test: een verhouding zonder noemer, maar MET teller (lib/forecast.ts deriveForecast en wie hem leest).
// Draaien: tsx lib/__geen_noemer_test.ts
//
// Wat er misging. deriveForecast maakt een gerealiseerde maand of week zonder noemer null (0 / 0 is
// geen CPA van € 0). Maar hij keek alleen naar de noemer, en dan was "€ 2.000 kosten, 0 conversies"
// ook null: een meting (de slechtst denkbare CPA) die overal als "Geen data" in het grijs stond,
// terwijl de ROAS-tab dezelfde maand als een gemeten 0,00x in het rood toonde. Drie plekken lazen
// die null verder verkeerd:
// - de health-score liet de maand uit de CPA-trend vallen en zei "CPA stabiel of dalend";
// - de "Nu"-lijn in de CPA/ROAS-grafiek schoof naar de laatste periode MET een verhouding (mei in
//   plaats van juli, of W3 in plaats van W4);
// - de CPA-kaart en het klantrapport zeiden "Gerealiseerd YTD € 0" na € 14.000 zonder conversie.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fc from "./forecast";
import { computeHealthScore } from "./health-score";
import * as trend from "./analysis/trend";
import * as formaat from "./forecast-format";
import * as maand from "../components/dashboard/monthly-overview";
import * as beurs from "../components/dashboard/fair-weeks-overview";
import * as kaarten from "../components/dashboard/metric-cards";
import type { ClientHistoricalData, MonthlyRecord, WeeklyRecord } from "./types";

const req = createRequire(__filename);
const React = req("react") as typeof import("react");
const { renderToStaticMarkup } = req("react-dom/server") as typeof import("react-dom/server");

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
// Een onderdeel dat op de oude code niet bestaat, faalt als onderdeel in plaats van de hele run.
function deel(label: string, f: () => void): void {
  console.log(label);
  try { f(); } catch (e) { check(`${label}: draait`, false, String(e)); }
}
const tekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const bron = (pad: string) => readFileSync(join(__dirname, "..", pad), "utf8");

// Rendert met `metric` als startwaarde van de metrickeuze ("conversions" in de views).
function metMetric<T>(metric: fc.ForecastMetric, f: () => T): T {
  const echt = React.useState;
  (React as { useState: unknown }).useState = (init: unknown) => echt(init === "conversions" ? metric : init);
  try { return f(); } finally { (React as { useState: unknown }).useState = echt; }
}

const wk = (month: number, conv: number[], spend: number[], rev: number[]): WeeklyRecord[] =>
  conv.map((c, i) => ({ week: i + 1, month, conversions: c, revenue: rev[i], adSpend: spend[i] }));
const rec = (month: number, weeks: WeeklyRecord[]): MonthlyRecord => ({
  month, weeks,
  conversions: weeks.reduce((s, w) => s + w.conversions, 0),
  revenue: weeks.reduce((s, w) => s + w.revenue, 0),
  adSpend: weeks.reduce((s, w) => s + w.adSpend, 0),
});
const vol = (m: number) => rec(m, wk(m, [25, 25, 25, 25], [500, 500, 500, 500], [2500, 2500, 2500, 2500]));

// Januari-mei normaal, juni gepauzeerd (0 / 0), juli € 2.000 kosten en 0 conversies.
const cur: (MonthlyRecord | null)[] = Array.from({ length: 12 }, () => null);
for (let m = 1; m <= 5; m++) cur[m - 1] = vol(m);
cur[5] = rec(6, wk(6, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]));
cur[6] = rec(7, wk(7, [0, 0, 0, 0], [500, 500, 500, 500], [0, 0, 0, 0]));
const data: ClientHistoricalData = {
  clientId: "t", currentYear: 2026, targetCurrentYear: { conversions: 1300, revenue: 130000, adSpend: 26000 },
  historicalYears: { 2025: Array.from({ length: 12 }, (_, i) => vol(i + 1)) }, currentYearData: cur, dataStand: null,
};
const f = fc.computeForecast(data);

deel("deriveForecast: kosten zonder conversies is een meting, 0 / 0 niet", () => {
  const jun = f.cpa.points[5], jul = f.cpa.points[6];
  check("juni (0 / 0): geen waarde en geen vlag", jun.realized === null && !jun.geenNoemer, JSON.stringify(jun));
  check("juli (€ 2.000 / 0): geen waarde, wel de vlag", jul.realized === null && jul.geenNoemer === true, JSON.stringify(jul));
  check("en de weken van juli ook", f.cpa.weeklyPoints.filter((w) => w.month === 7).every((w) => w.realized === null && w.geenNoemer === true));
  check("ROAS in juli is een gemeten 0, zonder vlag", f.roas.points[6].realized === 0 && !f.roas.points[6].geenNoemer, JSON.stringify(f.roas.points[6]));
  check("de labels: CPA 'Geen conversies', ROAS 'Geen kosten', anders 'Geen data'",
    formaat.geenWaardeLabel(jul, "cpa") === "Geen conversies" && formaat.geenWaardeLabel({ geenNoemer: true }, "roas") === "Geen kosten" && formaat.geenWaardeLabel(jun, "cpa") === "Geen data");
});

deel("De maandkaart en de strip", () => {
  const t = metMetric("cpa", () => tekst(React.createElement(maand.MonthlyOverviewView, { data, forecast: f, vandaag: "2026-08-10" })));
  const html = metMetric("cpa", () => renderToStaticMarkup(React.createElement(maand.MonthlyOverviewView, { data, forecast: f, vandaag: "2026-08-10" })));
  check("de kaart van juli zegt 'Geen conversies', niet 'Geen data'", t.includes("Jul 2026") && t.includes("Geen conversies") && !t.slice(0, t.indexOf(" Jan ")).includes("Geen data"),
    t.slice(0, 200));
  check("en kleurt rood (een CPA die niet slechter kan)", html.includes("border-red-200 bg-red-50/50"), html.slice(0, 300));
  check("de strip: juni 'geen data', juli 'geen conversies'", t.includes("Jun — geen data") && t.includes("Jul — geen conversies"), t.slice(t.indexOf(" Jan ")));
});

deel("De beurssectie", () => {
  const weken = beurs.beursWekenVan(f, "cpa", 2026, "2026-09-30");
  const juli = weken.filter((w) => w.weekStart.startsWith("2026-07"));
  check("de weken van juli: geen waarde, wel de vlag", juli.length > 0 && juli.every((w) => w.realized === null && w.geenNoemer === true),
    JSON.stringify(juli.map((w) => [w.weekStart, w.realized, w.geenNoemer])));
  const juni = weken.filter((w) => w.weekStart.startsWith("2026-06"));
  check("de weken van juni (0 / 0): zonder vlag", juni.every((w) => w.realized === null && !w.geenNoemer));
});

deel("De health-score", () => {
  const h = computeHealthScore(f);
  const e = h.factors.find((x) => x.name === "Efficiency");
  check("efficiency: niet 'CPA stabiel of dalend' na een maand van € 2.000 zonder conversie",
    e !== undefined && e.score === 4 && !e.description.includes("stabiel"), JSON.stringify(e));
  check("en een waarschuwing die het zegt", h.anomalies.some((a) => a.title === "Kosten zonder conversies" && a.description.includes("Jul")), JSON.stringify(h.anomalies.map((a) => a.title)));
  // Zonder zo'n maand verandert er niets.
  const normaal = fc.computeForecast({ ...data, currentYearData: cur.map((m, i) => (i < 7 ? vol(i + 1) : null)) });
  const en = computeHealthScore(normaal).factors.find((x) => x.name === "Efficiency");
  check("zonder kosten-zonder-conversies: de gewone trend", en?.description === "CPA stabiel of dalend", JSON.stringify(en));
});

deel("De 'Nu'-lijn", () => {
  check("per maand: juli, ook bij CPA", fc.nuIndex(f, "maand") === 6, String(fc.nuIndex(f, "maand")));
  const w = fc.nuIndex(f, "week");
  check("per week: W4 juli", f.conversions.weeklyPoints[w]?.label === "W4 Jul", f.conversions.weeklyPoints[w]?.label);
  // Alleen de laatste week zonder conversies: de lijn bleef bij CPA op W3.
  const b = fc.computeForecast({ ...data, currentYearData: cur.map((m, i) => (i < 6 ? vol(i + 1) : i === 6 ? rec(7, wk(7, [25, 25, 25, 0], [500, 500, 500, 500], [2500, 2500, 2500, 0])) : null)) });
  check("alleen W4 juli zonder conversies: de lijn staat op W4", b.conversions.weeklyPoints[fc.nuIndex(b, "week")]?.label === "W4 Jul");
  for (const pad of ["components/dashboard/performance-chart.tsx", "components/dashboard/channel-forecast-overview.tsx"]) {
    const s = bron(pad);
    check(`${pad}: de lijn uit nuIndex, niet uit de reeks van de gekozen metric`, s.includes("nuIndex(") && !s.includes("findLastIndex((d) => d.gerealiseerd !== null)"));
  }
});

deel("Gerealiseerd YTD bij nul conversies", () => {
  // 2025 normaal; 2026 januari-juli € 500 per week, 0 conversies.
  const leeg: ClientHistoricalData = {
    ...data, currentYearData: Array.from({ length: 12 }, (_, i) => (i < 7 ? rec(i + 1, wk(i + 1, [0, 0, 0, 0], [500, 500, 500, 500], [0, 0, 0, 0])) : null)),
  };
  const g = fc.computeForecast(leeg);
  check("voorwaarde: de CPA-punten zijn null", g.cpa.points.slice(0, 7).every((p) => p.realized === null));
  check("de CPA YTD is geen € 0 maar onbekend", fc.ytdGerealiseerd(g, "cpa") === null && fc.jaarKaartCijfers(g, "cpa").realized === null,
    `${fc.ytdGerealiseerd(g, "cpa")} / ${fc.jaarKaartCijfers(g, "cpa").realized}`);
  check("met conversies gewoon de verhouding", fc.ytdGerealiseerd(f, "cpa") === f.cpa.kpi.ytdRealized && fc.ytdGerealiseerd(f, "roas") === f.roas.kpi.ytdRealized);
  check("conversies en omzet: de som", fc.ytdGerealiseerd(g, "conversions") === 0 && fc.ytdGerealiseerd(f, "revenue") === f.revenue.kpi.ytdRealized);
  const kaart = tekst(React.createElement(kaarten.MetricCardsView, { forecast: g }));
  check("de CPA-kaart toont geen 'Gerealiseerd YTD € 0'", !/CPA.*Gerealiseerd YTD € 0 /.test(kaart) && /Gerealiseerd YTD —/.test(kaart), kaart.slice(kaart.indexOf("CPA"), kaart.indexOf("CPA") + 120));
  const rapportBron = bron("components/dashboard/report-export.tsx");
  check("het rapport leest de YTD-verhouding uit ytdGerealiseerd", rapportBron.includes("ytdGerealiseerd(") && !/fmt\(cpa\.ytdRealized\)|formatRoas\(roas\.ytdRealized\)/.test(rapportBron));
  const tegelBron = bron("components/dashboard/channel-forecast-overview.tsx");
  check("de kanaaltegel ook", tegelBron.includes("ytdGerealiseerd("));
});

deel("De CPA-trend kent de maanden zonder conversies (cpaTrendVanForecast)", () => {
  const { cpaTrendVanForecast } = trend as Partial<typeof trend>;
  check("lib/analysis/trend.ts exporteert cpaTrendVanForecast", typeof cpaTrendVanForecast === "function");
  if (typeof cpaTrendVanForecast !== "function") return;
  // G: CPA daalt januari-juni (70 .. 120 conversies op € 2.000), juli € 2.000 en 0 conversies.
  const dalend = (c: number, m: number) => rec(m, wk(m, [c / 4, c / 4, c / 4, c / 4], [500, 500, 500, 500], [c * 25, c * 25, c * 25, c * 25]));
  const conv = [70, 80, 90, 100, 110, 120];
  const G = fc.computeForecast({ ...data, currentYearData: cur.map((_, i) => (i < 6 ? dalend(conv[i], i + 1) : i === 6 ? rec(7, wk(7, [0, 0, 0, 0], [500, 500, 500, 500], [0, 0, 0, 0])) : null)) });
  const tG = cpaTrendVanForecast(G);
  check("G: juli zonder conversies, en geen 'daalt'", tG.daalt === false && tG.stijgt === false && JSON.stringify(tG.zonderConversies) === JSON.stringify(["Jul"]), JSON.stringify(tG));
  // H: dezelfde daling, juni zonder conversies, juli weer normaal.
  const H = fc.computeForecast({ ...data, currentYearData: cur.map((_, i) => (i < 5 ? dalend(conv[i], i + 1) : i === 5 ? rec(6, wk(6, [0, 0, 0, 0], [500, 500, 500, 500], [0, 0, 0, 0])) : i === 6 ? dalend(130, 7) : null)) });
  check("H: juni zonder conversies valt in het venster", JSON.stringify(cpaTrendVanForecast(H).zonderConversies) === JSON.stringify(["Jun"]) && !cpaTrendVanForecast(H).daalt);
  // G0: zonder die julimaand is de daling echt.
  const G0 = fc.computeForecast({ ...data, currentYearData: cur.map((_, i) => (i < 6 ? dalend(conv[i], i + 1) : null)) });
  check("G0: zonder maand zonder conversies daalt de CPA gewoon", cpaTrendVanForecast(G0).daalt === true && cpaTrendVanForecast(G0).zonderConversies.length === 0);
  // De health-score leest dezelfde regel.
  const e = computeHealthScore(G).factors.find((x) => x.name === "Efficiency");
  check("G: de health-score zegt hetzelfde (4/20)", e?.score === 4, JSON.stringify(e));
});

deel("Restkosten zonder conversie onder één gewone CPA tellen niet als slechtste efficiency", () => {
  // Januari-juni normaal (CPA € 20), juli: 0 / 0, € 3 en 0 conversies, € 3 en 1 conversie.
  const juli = (conv: number, kosten: number) => fc.computeForecast({ ...data, currentYearData: cur.map((_, i) => (i < 6 ? vol(i + 1) : i === 6 ? rec(7, wk(7, [conv, 0, 0, 0], [kosten, 0, 0, 0], [0, 0, 0, 0])) : null)) });
  const eff = (f: fc.ClientForecast) => computeHealthScore(f).factors.find((x) => x.name === "Efficiency");
  const stil = computeHealthScore(juli(0, 0));
  const drie = computeHealthScore(juli(0, 3));
  check("€ 3 zonder conversie: dezelfde score als een stille juli", drie.total === stil.total && eff(juli(0, 3))?.score === eff(juli(0, 0))?.score,
    `${drie.total} ${eff(juli(0, 3))?.score} tegen ${stil.total} ${eff(juli(0, 0))?.score}`);
  check("€ 3 zonder conversie: geen waarschuwing 'Kosten zonder conversies'", !drie.anomalies.some((a) => a.title === "Kosten zonder conversies"), JSON.stringify(drie.anomalies.map((a) => a.title)));
  check("€ 19 (onder één CPA) ook niet", eff(juli(0, 19))?.score === eff(juli(0, 0))?.score);
  for (const kosten of [20, 300, 2000]) {
    check(`€ ${kosten} zonder conversie (minstens één CPA): wel de slechtste efficiency`, eff(juli(0, kosten))?.score === 4 && computeHealthScore(juli(0, kosten)).anomalies.some((a) => a.title === "Kosten zonder conversies"));
  }
});

deel("Een nieuw kanaal zonder doel: één week restkosten is nog geen CPA-oordeel", () => {
  // Meta, 25-31 oktober, € 0,40 per dag, geen doel en geen vorig jaar (zoals de kanaalbadge). Zonder
  // gemeten CPA en zonder CPA-doel telde een maand met kosten en 0 conversies altijd: € 2,80 gaf een
  // beoordeelde health van 20 en "slechter wordt de efficiency niet", terwijl dezelfde € 2,80 met één
  // conversie "niet beoordeeld" was. Zonder referentie telt zo'n maand pas mee als er minstens twee
  // maanden met kosten zijn, het minimum dat de CPA-trend ook vraagt.
  const { buildChannelForecast } = req("./analysis/channel-forecast-data") as typeof import("./analysis/channel-forecast-data");
  const { zonderKanaalSpecifiekeHygiene } = req("./health-score") as typeof import("./health-score");
  const kanaal = (van: string, tot: string, perDag: number, conv: (d: string) => number) => {
    const rijen = [];
    for (let t = Date.parse(`${van}T00:00:00Z`); t <= Date.parse(`${tot}T00:00:00Z`); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      rijen.push({ date: d, spend: perDag, conv: conv(d), revenue: 0 });
    }
    const r = buildChannelForecast("t", rijen, [], "meta_ads", "2026-11-01", "2026-10-31");
    const h = zonderKanaalSpecifiekeHygiene(computeHealthScore(r!.forecast));
    return { h, e: h.factors.find((x) => x.name === "Efficiency")! };
  };
  const nul = kanaal("2026-10-25", "2026-10-31", 0.4, () => 0);
  const een = kanaal("2026-10-25", "2026-10-31", 0.4, (d) => (d === "2026-10-31" ? 1 : 0));
  check("€ 2,80 zonder conversie: Efficiency niet beoordeeld", nul.e.assessed === false && nul.e.description === "Te weinig maanden voor een CPA-trend — niet beoordeeld", JSON.stringify(nul.e));
  check("€ 2,80 met één conversie: idem", een.e.assessed === false, JSON.stringify(een.e));
  check("en dus dezelfde health", nul.h.total === een.h.total && nul.h.assessedCount === een.h.assessedCount, `${nul.h.total}/${nul.h.assessedCount} tegen ${een.h.total}/${een.h.assessedCount}`);
  check("geen 'slechter wordt de efficiency niet'", !JSON.stringify(nul.h).includes("slechter wordt de efficiency niet"));
  // Twee maanden kosten zonder één conversie (september-oktober, € 60 per dag) blijven gemarkeerd.
  const twee = kanaal("2026-09-01", "2026-10-31", 60, () => 0);
  check("september-oktober zonder conversies, zonder doel: wel 'Kosten zonder conversies'", twee.e.assessed === true && twee.e.description === "Kosten zonder conversies"
    && twee.h.anomalies.some((a) => a.title === "Kosten zonder conversies"), JSON.stringify(twee.e));
});

deel("Een prognose met kosten en zonder verwachte conversies heet niet 'Geen data'", () => {
  // Een kanaal zonder doel en zonder vorig jaar: januari-juli € 2.000 per maand, 0 conversies. De
  // prognose voor augustus-december: kosten op tempo, conversies 0. Die maanden heetten "Geen data".
  const zonderDoel: ClientHistoricalData = {
    ...data, targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 }, historicalYears: {},
    currentYearData: Array.from({ length: 12 }, (_, i) => (i < 7 ? rec(i + 1, wk(i + 1, [0, 0, 0, 0], [500, 500, 500, 500], [0, 0, 0, 0])) : null)),
  };
  const g = fc.computeForecast(zonderDoel);
  const aug = g.cpa.points[7] as fc.ForecastPoint & { geenNoemerPrognose?: boolean };
  check("voorwaarde: augustus kosten geprognotiseerd, conversies 0", (g.adSpend.points[7].forecast ?? 0) > 0 && g.conversions.points[7].forecast === 0,
    `${g.adSpend.points[7].forecast} / ${g.conversions.points[7].forecast}`);
  check("augustus: geen waarde, de prognosevlag, en niet de gemeten vlag", aug.forecast === null && aug.geenNoemerPrognose === true && !aug.geenNoemer, JSON.stringify(aug));
  check("het label: 'Geen conversies verwacht'", formaat.geenWaardeLabel(aug, "cpa") === "Geen conversies verwacht", formaat.geenWaardeLabel(aug, "cpa"));
  const augWeken = g.cpa.weeklyPoints.filter((w) => w.month === 8) as (fc.WeeklyPoint & { geenNoemerPrognose?: boolean })[];
  check("en de weken van augustus ook", augWeken.length > 0 && augWeken.every((w) => w.forecast === null && w.geenNoemerPrognose === true && !w.geenNoemer));
  check("juli blijft gemeten (geenNoemer, geen prognosevlag)", g.cpa.points[6].geenNoemer === true && !(g.cpa.points[6] as { geenNoemerPrognose?: boolean }).geenNoemerPrognose);
  const weken = beurs.beursWekenVan(g, "cpa", 2026, "2026-10-28") as ({ weekStart: string; geenNoemerPrognose?: boolean; geenNoemer?: boolean })[];
  const sep = weken.filter((w) => w.weekStart.startsWith("2026-09"));
  check("de beursweken van september: de prognosevlag", sep.length > 0 && sep.every((w) => w.geenNoemerPrognose === true && !w.geenNoemer), JSON.stringify(sep));
  const t = metMetric("cpa", () => tekst(React.createElement(maand.MonthlyOverviewView, { data: zonderDoel, forecast: g, vandaag: "2026-08-10" })));
  check("de maandkaart van augustus: 'Geen conversies verwacht'", t.includes("Geen conversies verwacht") && t.includes("Aug — geen conversies verwacht"), t.slice(0, 400));
  // Een gestopt kanaal (nul kosten op nul conversies) krijgt geen vlag: daar is echt niets.
  const som = req("./forecast-som") as typeof import("./forecast-som");
  const stil = som.stilgelegd(g);
  check("gestopt kanaal (0 / 0): geen prognosevlag, gewoon 'Geen data'", !(stil.cpa.points[7] as { geenNoemerPrognose?: boolean }).geenNoemerPrognose && formaat.geenWaardeLabel(stil.cpa.points[7], "cpa") === "Geen data");
});

deel("Een historische maand met kosten en 0 conversies: de weekreeksen blijven gelijk", () => {
  // September 2025 met vijf weken van € 400 en 0 conversies (de tracking lag eruit). De
  // weekverdeling van de conversies sloeg dat jaar over en viel terug op vier gelijke weken, die
  // van de kosten hield er vijf. Het aantal weken kwam uit die verdeling, dus de conversiereeks had
  // er 48 en de kostenreeks 49, en deriveForecast koppelt op positie: vanaf september deelde elke
  // week-CPA de kosten van de ene week door de conversies van de volgende.
  const hist = Array.from({ length: 12 }, (_, i) => vol(i + 1));
  hist[8] = rec(9, wk(9, [0, 0, 0, 0, 0], [400, 400, 400, 400, 400], [0, 0, 0, 0, 0]));
  const g = fc.computeForecast({ ...data, historicalYears: { 2025: hist }, currentYearData: cur.map((_, i) => (i < 7 ? vol(i + 1) : null)) });
  const sleutels = (r: fc.ForecastResult) => r.weeklyPoints.map((w) => `${w.month}-${w.week}`).join(",");
  check("conversies, kosten en CPA hebben hetzelfde weekraster", sleutels(g.conversions) === sleutels(g.adSpend) && sleutels(g.cpa) === sleutels(g.adSpend),
    `${g.conversions.weeklyPoints.length} / ${g.adSpend.weeklyPoints.length} / ${g.cpa.weeklyPoints.length}`);
  // Op (maand, week) opgezocht in elke reeks, niet op positie.
  const opWeek = (r: fc.ForecastResult) => r.weeklyPoints.find((w) => w.month === 10 && w.week === 1)?.forecast ?? NaN;
  const eigen = opWeek(g.adSpend) / opWeek(g.conversions);
  check("de week-CPA van W1 oktober is zijn eigen kosten / zijn eigen conversies", Math.abs(opWeek(g.cpa) - eigen) < 0.01, `${opWeek(g.cpa)} tegen ${eigen}`);
  const laatste = g.cpa.weeklyPoints[g.cpa.weeklyPoints.length - 1];
  check("de laatste CPA-week (december) heeft een prognose", laatste.month === 12 && laatste.forecast !== null, JSON.stringify(laatste));
});

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
