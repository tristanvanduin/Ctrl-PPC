// Test: wat de Trend-factor van de health score meet, en dat de woorden dat ook zeggen.
// Draaien: tsx lib/__trend_verwachting_test.ts
//
// Wat er misging. Bij een volwassen account scoort de Trend-factor de gewogen prestatiefactor en de
// laatste maand, allebei gerealiseerd TEGEN DE VERWACHTING. Die verwachting is het jaardoel over de
// maanden verdeeld (forecastCoreMetric schaalt hem naar het doel). Met een hoog ingevoerd doel (de
// demo: 2.600 tegen een tempo van ongeveer 1.300) stond er "Sterke neerwaartse trend — Gewogen
// prestatiefactor 48%, laatste maand 47% van verwachting", en bij de factor "Neerwaartse trend".
// De conversies dalen daar niet: het account loopt achter op een verwachting die het doel volgt.
// De inzichten zeiden hetzelfde ("Neerwaartse trend ... Zonder ingrijpen verslechtert de prognose
// verder").
//
// De SCORES blijven precies wat ze waren (de tabel hieronder is vastgelegd vóór de wijziging); alleen
// de woorden veranderen. Bij een opschalend account meet de factor wel een trend (de efficiency):
// daar blijven de woorden staan.

import { createRequire } from "node:module";
import { computeHealthScore, type HealthScore } from "./health-score";
import { beoordeelCodeRood } from "./adoptie/code-rood";
import type { ClientHistoricalData } from "./types";
import type { ApiMonthlyData } from "./api/adapter";

const req = createRequire(__filename);
const React = req("react") as typeof import("react") & Record<string, unknown>;
const { renderToStaticMarkup } = req("react-dom/server") as typeof import("react-dom/server");

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── Een forecast met precies de invoer van de Trend-factor ────────────────────────────────
type Modus = "volwassen" | "opschalend";
// Een conversiedoel erbij (standaard 1.200, met een prognose op dat doel zodat de Doelstelling-factor
// geen anomalie geeft): de verwachting volgt dat doel. Hier stond `annualTarget: 0`, en dan legde
// de test "de verwachting volgt het geschatte jaardoel" vast voor een account zonder enig doel, waar
// er geen verwachting is om tegen te meten.
function forecast(pf: number, laatste: number, modus: Modus, opties: { et?: number; herkomst?: unknown; doel?: number } = {}): Parameters<typeof computeHealthScore>[0] {
  const punten = [{ realized: 100, monthRatio: 1, monthLabel: "Jan" }, { realized: 100, monthRatio: laatste, monthLabel: "Feb" }];
  const leeg = { kpi: { annualTarget: 0, adjustedAnnual: 0, ytdRealized: 0, ytdExpected: 0, projectionFactor: 1 }, points: [] };
  const doel = opties.doel ?? 1200;
  return {
    conversions: { kpi: { ...leeg.kpi, annualTarget: doel, adjustedAnnual: doel, projectionFactor: pf }, points: punten }, revenue: leeg, adSpend: leeg, roas: leeg, cpa: leeg,
    budgetRecommendation: {},
    dataMaturity: modus === "volwassen"
      ? { isMature: true, isScaling: false, efficiencyTrend: 1 }
      : { isMature: false, isScaling: true, efficiencyTrend: opties.et ?? 1 },
    ...(opties.herkomst ? { doelHerkomst: opties.herkomst } : {}),
  } as unknown as Parameters<typeof computeHealthScore>[0];
}
const trend = (h: HealthScore) => h.factors.find((f) => f.name === "Trend")!;
// Alleen de anomalieën van de Trend-factor (de MoM-daling kan hier niet voorkomen: twee gelijke maanden).
const trendAnomalieen = (h: HealthScore) => h.anomalies.filter((a) => !/^Scherpe daling/.test(a.title));

// ── De scores, vastgelegd op de code van vóór deze wijziging ────────────────────────────────
// [prestatiefactor, laatste maand, score, ernst van de anomalie of null]
const VOLWASSEN: [number, number, number, "critical" | "warning" | null][] = [
  [0.5, 0.5, 0, "critical"], [0.5, 0.79, 0, "critical"], [0.5, 0.86, 2, "warning"], [0.5, 0.95, 2, null], [0.5, 1.05, 4, null],
  [0.78, 0.5, 2, "critical"], [0.78, 0.79, 2, "critical"], [0.78, 0.86, 4, "warning"], [0.78, 0.95, 4, null], [0.78, 1.05, 6, null],
  [0.82, 0.5, 2, "warning"], [0.82, 0.79, 2, "warning"], [0.82, 0.86, 4, "warning"], [0.82, 0.95, 4, null], [0.82, 1.05, 6, null],
  [0.88, 0.5, 6, "warning"], [0.88, 0.79, 6, "warning"], [0.88, 0.86, 8, "warning"], [0.88, 0.95, 8, null], [0.88, 1.05, 10, null],
  [0.92, 0.5, 6, null], [0.92, 0.79, 6, null], [0.92, 0.86, 8, null], [0.92, 0.95, 8, null], [0.92, 1.05, 10, null],
  [1, 0.5, 10, null], [1, 0.79, 10, null], [1, 0.86, 12, null], [1, 0.95, 12, null], [1, 1.05, 14, null],
  [1.1, 0.5, 14, null], [1.1, 0.79, 14, null], [1.1, 0.86, 16, null], [1.1, 0.95, 16, null], [1.1, 1.05, 18, null],
  [1.2, 0.5, 16, null], [1.2, 0.79, 16, null], [1.2, 0.86, 18, null], [1.2, 0.95, 18, null], [1.2, 1.05, 20, null],
];
// [efficiencytrend, laatste maand, score, beschrijving, met de anomalie "Efficiency daalt bij opschaling"]
const OPSCHALEND: [number, number, number, string, boolean][] = [
  [0.7, 0.5, 2, "Neerwaartse trend", true], [0.7, 1.05, 6, "Neerwaartse trend", true],
  [0.9, 0.5, 6, "Neerwaartse trend", false], [0.9, 1.05, 10, "Stabiel", false],
  [1, 0.5, 10, "Stabiel", false], [1, 1.05, 14, "Stabiel", false],
  [1.05, 0.5, 14, "Stabiel", false], [1.05, 1.05, 18, "Opwaartse trend", false],
  [1.2, 0.5, 18, "Opwaartse trend", false], [1.2, 1.05, 20, "Opwaartse trend", false],
];

console.log("Volwassen account: dezelfde scores, woorden over de verwachting");
for (const [pf, laatste, score, ernst] of VOLWASSEN) {
  const h = computeHealthScore(forecast(pf, laatste, "volwassen"));
  const t = trend(h);
  const a = trendAnomalieen(h);
  const label = `pf ${pf}, laatste ${laatste}`;
  check(`${label}: score ${score}`, t.score === score, String(t.score));
  check(`${label}: anomalie ${ernst ?? "geen"}`, ernst === null ? a.length === 0 : a.length === 1 && a[0].severity === ernst, JSON.stringify(a));
  const woord = score >= 16 ? "Boven verwachting" : score >= 10 ? "Op verwachting" : "Onder verwachting";
  check(`${label}: '${woord}', met waar de verwachting vandaan komt`, t.description === `${woord} (de verwachting volgt het geschatte jaardoel)`, t.description);
  check(`${label}: nergens 'trend'`, !/trend/i.test(t.description) && a.every((x) => !/trend/i.test(x.title) && !/trend/i.test(x.description)), JSON.stringify([t.description, a]));
  if (ernst === "critical") check(`${label}: 'Sterk achter op verwachting'`, a[0].title === "Sterk achter op verwachting", a[0].title);
  if (ernst === "warning") check(`${label}: 'Achter op verwachting'`, a[0].title === "Achter op verwachting", a[0].title);
}

console.log("De demo: 48% en 47% van een verwachting die het ingevoerde doel volgt");
{
  const h = computeHealthScore(forecast(0.481, 0.47, "volwassen", { herkomst: { conversions: { soort: "absoluut" }, revenue: { soort: "standaard" } } }));
  const [a] = trendAnomalieen(h);
  check("factor: 'Onder verwachting (de verwachting volgt het jaardoel)'", trend(h).description === "Onder verwachting (de verwachting volgt het jaardoel)", trend(h).description);
  check("anomalie: titel", a?.title === "Sterk achter op verwachting", a?.title);
  check("anomalie: zegt wat er gemeten is, en wat niet",
    a?.description === "Gewogen prestatiefactor 48%, laatste maand 47% van verwachting. De verwachting volgt het jaardoel: dit meet de achterstand op dat doel, niet of de conversies dalen.",
    a?.description);
  const groei = computeHealthScore(forecast(0.85, 0.83, "volwassen", { herkomst: { conversions: { soort: "groei", groeiPct: 15 }, revenue: { soort: "standaard" } } }));
  check("met een ingevoerde groei: de herkomst erbij", trendAnomalieen(groei)[0]?.description.includes("De verwachting volgt het jaardoel (vorig jaar +15%): dit meet"), trendAnomalieen(groei)[0]?.description);
  const geschat = computeHealthScore(forecast(0.85, 0.83, "volwassen"));
  check("zonder ingevoerd doel: het geschatte jaardoel", trendAnomalieen(geschat)[0]?.description.includes("De verwachting volgt het geschatte jaardoel (vorig jaar +10%): dit meet"), trendAnomalieen(geschat)[0]?.description);
}

console.log("Geen jaardoel: geen verwachting om tegen te meten");
{
  // Zonder conversiedoel is de verwachting overal nul, geeft computePerformanceFactor 1,0 en is de
  // laatste maand 100%: score 14. Daar stond "Op verwachting (de verwachting volgt het geschatte
  // jaardoel)", naast de Doelstelling-factor die op hetzelfde account "Geen jaardoel ingesteld" zei.
  // Elke Meta of LinkedIn die dit jaar begon bij een klant zonder kpi_targets.
  const h = computeHealthScore(forecast(1, 1, "volwassen", { doel: 0 }));
  check("zonder doel: score 14 (onveranderd)", trend(h).score === 14, String(trend(h).score));
  check("zonder doel: zegt dat er geen verwachting is", trend(h).description === "Geen jaardoel, dus geen verwachting om tegen te meten — neutraal", trend(h).description);
  check("zonder doel: niet 'de verwachting volgt'", !trend(h).description.includes("verwachting volgt") && trendAnomalieen(h).every((a) => !a.description.includes("verwachting volgt")),
    JSON.stringify([trend(h).description, trendAnomalieen(h)]));
  check("zonder doel: de Doelstelling-factor zegt hetzelfde", h.factors.find((f) => f.name === "Doelstelling")?.description === "Geen jaardoel ingesteld — niet beoordeeld");
  // Met een doel blijft de verwachting erbij staan.
  check("met een doel: 'Op verwachting (de verwachting volgt ...)'", trend(computeHealthScore(forecast(1, 1, "volwassen"))).description.startsWith("Op verwachting (de verwachting volgt"),
    trend(computeHealthScore(forecast(1, 1, "volwassen"))).description);
}

console.log("Opschalend account: daar meet de factor wel een trend, en blijven de woorden");
for (const [et, laatste, score, woord, anomalie] of OPSCHALEND) {
  const h = computeHealthScore(forecast(1, laatste, "opschalend", { et }));
  const label = `efficiency ${et}, laatste ${laatste}`;
  check(`${label}: score ${score}`, trend(h).score === score, String(trend(h).score));
  check(`${label}: '${woord}'`, trend(h).description === woord, trend(h).description);
  check(`${label}: anomalie`, trendAnomalieen(h).map((a) => a.title).join() === (anomalie ? "Efficiency daalt bij opschaling" : ""), JSON.stringify(trendAnomalieen(h)));
}

console.log("Code Rood leest de ernst, niet de titel");
{
  const h = computeHealthScore(forecast(0.5, 0.5, "volwassen"));
  const o = beoordeelCodeRood({ licht: "groen", redenen: [] }, h);
  check("de kritieke achterstand maakt het rood, met de nieuwe titel als reden", o.licht === "rood" && o.redenen.includes("Sterk achter op verwachting"), JSON.stringify(o));
}

// ── De inzichten (components/insights/insights-block.tsx), uit het echte component ───────────
const namen = new Map<unknown, string>();
const waarden: Record<string, unknown> = {};
const echtCreate = React.createContext;
(React as { createContext: unknown }).createContext = (standaard: unknown) => {
  const ctx = echtCreate(standaard);
  const regel = (new Error().stack ?? "").split("\n").find((l) => /\/(lib|components)\//.test(l) && !l.includes("__trend_verwachting_test")) ?? "";
  const bestand = (regel.match(/\/((?:lib|components)\/[^:)]+)/) ?? [])[1] ?? "?";
  const n = [...namen.values()].filter((v) => v.startsWith(`${bestand}#`)).length;
  namen.set(ctx, `${bestand}#${n}`);
  return ctx;
};
const echtUseContext = React.useContext;
(React as { useContext: unknown }).useContext = (ctx: unknown) => {
  const naam = namen.get(ctx);
  return naam !== undefined && naam in waarden ? waarden[naam] : echtUseContext(ctx as Parameters<typeof echtUseContext>[0]);
};
// "Toon alle inzichten" open (useState(false) wordt true), zodat elk inzicht in de render staat.
const echtState = React.useState;
(React as { useState: unknown }).useState = (init: unknown) => echtState(init === false ? true : init);
const tekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const fc = await import("./forecast");
  const { buildClientDataFromApi } = await import("./api/adapter");
  const { InsightsBlock } = await import("../components/insights/insights-block");
  const api = (maanden: number[], conv: number): ApiMonthlyData[] =>
    maanden.map((month) => ({ month, conversions: conv, revenue: conv * 200, adSpend: 11000, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 }));
  // Vorig jaar 120 per maand, dit jaar 110: vlak, geen daling van betekenis. Alleen het doel verschilt.
  const data = (doelConversies: number, herkomst?: unknown): ClientHistoricalData => ({
    ...buildClientDataFromApi("t", [{ year: 2025, monthly: api([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 120), weekly: [] }],
      api([1, 2, 3, 4, 5, 6, 7], 110), [], { conversions: doelConversies, revenue: doelConversies * 200, adSpend: 132000 }, 2026, 7),
    ...(herkomst ? { doelHerkomst: herkomst } : {}),
  } as ClientHistoricalData);
  const inzicht = (d: ClientHistoricalData) => {
    const f = fc.computeForecast(d);
    waarden["lib/client-data-provider.tsx#0"] = { data: d, loading: false, error: null };
    waarden["lib/client-data-provider.tsx#1"] = f;
    return { f, t: tekst(React.createElement(InsightsBlock, { clientId: "t" })) };
  };

  {
    const { f, t } = inzicht(data(2600, { conversions: { soort: "absoluut" }, revenue: { soort: "absoluut" } }));
    check("voorwaarde: een volwassen account ver achter op een hoog doel", !(f.dataMaturity.isScaling && !f.dataMaturity.isMature) && f.conversions.kpi.projectionFactor < 0.9, `${f.conversions.kpi.projectionFactor}`);
    check("inzicht: geen 'Neerwaartse trend'", !t.includes("Neerwaartse trend"), t.slice(0, 200));
    check("inzicht: 'Onder verwachting', met wat de verwachting is en wat dit niet meet",
      /Onder verwachting: gewogen prestatiefactor \d+%\. Recente maanden blijven onder de verwachting, en die volgt het jaardoel: dit meet de achterstand op dat doel, niet of de conversies dalen\./.test(t),
      (t.match(/.{0,40}(Onder verwachting|Neerwaartse trend).{0,260}/) ?? [""])[0]);
    check("inzicht: niet 'verslechtert de prognose verder' (de prognose rekent de factor al mee)", !t.includes("verslechtert de prognose verder"));
  }
  {
    const { f, t } = inzicht(data(800));
    check("voorwaarde: voor op een laag doel", f.conversions.kpi.projectionFactor > 1.05, `${f.conversions.kpi.projectionFactor}`);
    check("inzicht: 'Boven verwachting' en niet 'Opwaartse trend'", /Boven verwachting: gewogen prestatiefactor \d+%\. Recente maanden presteren beter dan de verwachting, en die volgt het geschatte jaardoel\./.test(t) && !t.includes("Opwaartse trend"),
      (t.match(/.{0,40}(Boven verwachting|Opwaartse trend).{0,260}/) ?? [""])[0]);
    // De spiegel van "verslechtert de prognose verder": de prognose rekent de factor al mee. Een
    // account dat 110% van de verwachting blijft doen, houdt dezelfde jaarprognose (1.428 in juli en
    // in augustus); "Houdt dat aan, dan verbetert de jaarprognose" beloofde iets wat niet gebeurt.
    check("voorwaarde: voor op het doel", f.conversions.kpi.diffPct >= 0, String(f.conversions.kpi.diffPct));
    check("inzicht: niet 'verbetert de jaarprognose'", !t.includes("verbetert de jaarprognose"), (t.match(/Boven verwachting.{0,260}/) ?? [""])[0]);
    check("inzicht: 'De jaarprognose rekent dit tempo al mee.'", /Boven verwachting:[^]*?De jaarprognose rekent dit tempo al mee\./.test(t), (t.match(/Boven verwachting.{0,260}/) ?? [""])[0]);
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
