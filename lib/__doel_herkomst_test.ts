// Test: waar het jaardoel vandaan komt, en dat elk scherm dat ook zegt.
// Draaien: tsx lib/__doel_herkomst_test.ts
//
// Wat er misging. De health score, de pacing, de grafiek en het rapport zeiden altijd dat het doel
// een schatting was: "geschat jaardoel (vorig jaar +10%)" en "(vorig jaar +10%; er is nog geen doel
// ingevoerd)". Ook als er in Instellingen wel een doel stond. Op de demo (2.600 conversies vast,
// CPA € 45) toonde het Google-tabblad "751 / 2.600" en daaronder "Prognose is slechts 48% van het
// geschatte jaardoel (vorig jaar +10%; er is nog geen doel ingevoerd)". Voor wie terugkwam (de
// instellingen in localStorage) was dat al zo; sinds stap 0 voegt het Google-tabblad de opgeslagen
// doelen bij elk bezoek samen, dus stond het er altijd.
//
// De oorzaak: de data droeg alleen het getal, niet waar het vandaan kwam. En getClientSettings gaf
// zonder opgeslagen doel de standaard (groei 10) terug, zonder te zeggen dat dat de standaard was.
//
// De componenten lezen hun data uit ClientDataProvider. Die context wordt hier gevuld door
// createContext en useContext te omwikkelen vóór de componenten geladen worden (zoals in
// lib/__geen_noemer_teksten_test.ts): zo rendert het echte component, en niet een kopie van zijn tekst.

import { createRequire } from "node:module";
import type { ClientHistoricalData } from "./types";
import type { ApiMonthlyData, YearDataInput } from "./api/adapter";

const req = createRequire(__filename);
const React = req("react") as typeof import("react") & Record<string, unknown>;
const { renderToStaticMarkup } = req("react-dom/server") as typeof import("react-dom/server");

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
async function deel(label: string, f: () => void | Promise<void>): Promise<void> {
  console.log(label);
  try { await f(); } catch (e) { check(`${label}: draait`, false, String(e)); }
}
const tekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<!-- -->/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const rond = (t: string, van: string, lengte = 180) => { const i = t.indexOf(van); return i < 0 ? `(niet gevonden: ${t.slice(0, 120)})` : t.slice(Math.max(0, i - 40), i + lengte); };

// ── Database en browser ───────────────────────────────────────────────────────────────────
// loadClientSettings vraagt de database alleen als er een browser-Supabase is (uit de omgeving).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
const opslag = new Map<string, string>();
Object.assign(globalThis, {
  window: {},
  document: { cookie: "" },
  localStorage: { getItem: (k: string) => opslag.get(k) ?? null, setItem: (k: string, v: string) => { opslag.set(k, v); }, removeItem: (k: string) => { opslag.delete(k); } },
});
const SLEUTEL = "rm-dashboard-settings-";

// De client_settings-rij per klant, zoals GET /api/data/client_settings hem geeft. Geen sleutel: geen rij.
const KPI_LEEG = { conversionsMode: "growth", conversionsGrowthPct: 0, conversionsAbsolute: 0, revenueMode: "growth", revenueGrowthPct: 0, revenueAbsolute: 0, roasTarget: 0, cpaTarget: 0 };
const rijen = new Map<string, Record<string, unknown>>([
  // De vorm van demo-greentech: 2.600 conversies vast, omzet vast op 0 (dus niets), CPA € 45.
  ["absoluut", { kpi_targets: { ...KPI_LEEG, conversionsMode: "absolute", conversionsAbsolute: 2600, revenueMode: "absolute", cpaTarget: 45 } }],
  ["groei", { kpi_targets: { ...KPI_LEEG, conversionsGrowthPct: 15, revenueGrowthPct: 15, cpaTarget: 45 } }],
  ["krimp", { kpi_targets: { ...KPI_LEEG, conversionsGrowthPct: -10 } }],
  // Alleen een omzetdoel: de conversiekaart uit (groei 0, vast 0), omzet vast op € 900.000.
  ["omzet", { kpi_targets: { ...KPI_LEEG, revenueMode: "absolute", revenueAbsolute: 900000 } }],
  // Een rij voor de conversieacties of de sector, zonder doelen: niets ingevoerd.
  ["null-rij", { kpi_targets: null, sector: "b2b" }],
]);
let geschreven = 0;
globalThis.fetch = (async (url: string, init?: { method?: string }) => {
  const u = String(url);
  if (init?.method === "POST") { geschreven += 1; return { ok: true, status: 200, json: async () => ({ data: [] }) }; }
  const vraag = JSON.parse(decodeURIComponent(u.split("?q=")[1] ?? "{}")) as { clientId?: string };
  return { ok: true, status: 200, json: async () => ({ data: rijen.get(vraag.clientId ?? "") ?? null }) };
}) as unknown as typeof fetch;

// ── ClientDataProvider vullen ─────────────────────────────────────────────────────────────
const namen = new Map<unknown, string>();
const waarden: Record<string, unknown> = {};
const echtCreate = React.createContext;
(React as { createContext: unknown }).createContext = (standaard: unknown) => {
  const ctx = echtCreate(standaard);
  const regel = (new Error().stack ?? "").split("\n").find((l) => /\/(lib|components)\//.test(l) && !l.includes("__doel_herkomst_test")) ?? "";
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

// ── De data: vorig jaar 120 conversies per maand, dit jaar januari-juli 55 ──────────────────
// Zwak genoeg dat de prognose ook onder het standaarddoel (vorig jaar +10%) onder de 50% blijft:
// dan staat de anomalie "jaardoel in gevaar" er in elk scenario en is elke zin te vergelijken.
const api = (maanden: number[], conv: number, rev: number, spend: number): ApiMonthlyData[] =>
  maanden.map((month) => ({ month, conversions: conv, revenue: rev, adSpend: spend, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 }));
const HIST: YearDataInput[] = [{ year: 2025, monthly: api([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 120, 24000, 11000), weekly: [] }];
const HUIDIG = api([1, 2, 3, 4, 5, 6, 7], 55, 11000, 11000);

async function main() {
  const instellingen = await import("./client-settings");
  const { mergeKpiTargets } = await import("./kpi-target-merge");
  const { buildClientDataFromApi } = await import("./api/adapter");
  const { standaardJaardoel } = await import("./analysis/standaard-jaardoel");
  const fc = await import("./forecast");
  const som = await import("./forecast-som");
  const { computeHealthScore } = await import("./health-score");
  const { landGefilterdeData } = await import("./use-country-filtered-data");
  const { HealthBadgeView } = await import("../components/dashboard/health-badge");
  const { PacingMonitor } = await import("../components/dashboard/pacing-monitor");
  const { PerformanceChart, PerformanceChartView } = await import("../components/dashboard/performance-chart");
  const { ReportExport } = await import("../components/dashboard/report-export");

  // De route geeft altijd het standaarddoel; mergeKpiTargets legt de instellingen erop.
  const routeDoel = standaardJaardoel({ conversions: 1440, revenue: 288000, adSpend: 132000 });
  const route = (clientId: string): ClientHistoricalData => buildClientDataFromApi(clientId, HIST, HUIDIG, [], routeDoel, 2026, 7);
  type Herkomst = { soort?: string; groeiPct?: number } | undefined;
  const herkomst = (d: unknown, m: "conversions" | "revenue"): Herkomst =>
    ((d as { doelHerkomst?: Record<string, Herkomst> }).doelHerkomst ?? {})[m];
  const opgeslagen = (s: unknown) => (s as { kpiDoelenOpgeslagen?: boolean }).kpiDoelenOpgeslagen;

  /** Alles wat het Google-tabblad over het doel zegt, voor één klant. */
  const schermen = (clientId: string) => {
    const data = mergeKpiTargets(clientId, route(clientId));
    const forecast = fc.computeForecast(data);
    waarden["lib/client-data-provider.tsx#0"] = { data, loading: false, error: null };
    waarden["lib/client-data-provider.tsx#1"] = forecast;
    const health = computeHealthScore(forecast);
    return {
      data, forecast, health,
      doelFactor: health.factors.find((f) => f.name === "Doelstelling")?.description ?? "",
      gevaar: health.anomalies.find((a) => /jaardoel in gevaar/i.test(a.title)),
      badge: tekst(React.createElement(HealthBadgeView, { health })),
      pacing: tekst(React.createElement(PacingMonitor, { clientId })),
      grafiek: tekst(React.createElement(PerformanceChart, { clientId })),
      rapport: tekst(React.createElement(ReportExport, { clientId })),
    };
  };
  const nergensGeschat = (s: ReturnType<typeof schermen>) =>
    [s.badge, s.pacing, s.grafiek, s.rapport].every((t) => !/geschat/i.test(t) && !t.includes("nog geen doel ingevoerd"));

  await deel("Instellingen: wat is echt opgeslagen?", async () => {
    // Zonder opgeslagen doel geeft getClientSettings de standaard (groei 10). Dat is geen ingevoerd doel.
    const vers = instellingen.getClientSettings("nooit-geladen");
    check("de standaard: groei 10, maar niet opgeslagen", vers.kpiTargets.conversionsGrowthPct === 10 && opgeslagen(vers) === false, JSON.stringify({ g: vers.kpiTargets.conversionsGrowthPct, o: opgeslagen(vers) }));

    await instellingen.loadClientSettings("absoluut");
    check("een rij met kpi_targets: opgeslagen", opgeslagen(instellingen.getClientSettings("absoluut")) === true);
    const lokaal = JSON.parse(opslag.get(SLEUTEL + "absoluut") ?? "{}");
    check("en localStorage onthoudt dat", lokaal.kpiDoelenOpgeslagen === true, JSON.stringify(lokaal.kpiDoelenOpgeslagen));

    await instellingen.loadClientSettings("null-rij");
    check("een rij waarvan kpi_targets null is: niet opgeslagen", opgeslagen(instellingen.getClientSettings("null-rij")) === false);
    check("ook in localStorage", JSON.parse(opslag.get(SLEUTEL + "null-rij") ?? "{}").kpiDoelenOpgeslagen === false);

    await instellingen.loadClientSettings("geen-rij");
    check("geen rij: niet opgeslagen", opgeslagen(instellingen.getClientSettings("geen-rij")) === false);

    for (const id of ["groei", "krimp"]) {
      await instellingen.loadClientSettings(id);
      check(`${id}: opgeslagen`, opgeslagen(instellingen.getClientSettings(id)) === true);
    }

    // Instellingen opslaan, ook met de standaardwaarden: de gebruiker zag "+10%" en sloeg dat op.
    const voor = geschreven;
    await instellingen.saveClientSettings(instellingen.getClientSettings("bewaard"));
    check("na saveClientSettings: opgeslagen (en naar de database geschreven)", opgeslagen(instellingen.getClientSettings("bewaard")) === true && geschreven === voor + 1);
    check("ook in localStorage", JSON.parse(opslag.get(SLEUTEL + "bewaard") ?? "{}").kpiDoelenOpgeslagen === true);
  });

  await deel("Een vorig bezoek in localStorage", () => {
    // Na een herlaadbeurt is het geheugen leeg en leest getClientSettings localStorage.
    const zet = (id: string, extra: Record<string, unknown>, kpi: Record<string, unknown>) =>
      opslag.set(SLEUTEL + id, JSON.stringify({ clientId: id, conversionActions: [], conversionLagDays: 3, kpiTargets: { ...KPI_LEEG, ...kpi }, ...extra }));
    zet("lokaal-ja", { kpiDoelenOpgeslagen: true }, { conversionsGrowthPct: 10, revenueGrowthPct: 10 });
    zet("lokaal-nee", { kpiDoelenOpgeslagen: false }, { conversionsGrowthPct: 10, revenueGrowthPct: 10 });
    check("opgeslagen groei 10 blijft ingevoerd", herkomst(mergeKpiTargets("lokaal-ja", route("lokaal-ja")), "conversions")?.soort === "groei");
    check("de standaard groei 10 blijft de standaard", herkomst(mergeKpiTargets("lokaal-nee", route("lokaal-nee")), "conversions")?.soort === "standaard");
    // Een vermelding van vóór deze vlag. Wijkt het doel af van de standaard, dan is het ingevoerd
    // (de standaard kan het niet zijn); is het de standaard, dan is dat niet te onderscheiden en
    // geldt de schatting tot loadClientSettings de rij heeft gelezen.
    zet("oud-vast", {}, { conversionsMode: "absolute", conversionsAbsolute: 2600 });
    zet("oud-standaard", {}, { conversionsGrowthPct: 10, revenueGrowthPct: 10 });
    check("oud, afwijkend: ingevoerd", herkomst(mergeKpiTargets("oud-vast", route("oud-vast")), "conversions")?.soort === "absoluut");
    check("oud, gelijk aan de standaard: de standaard", herkomst(mergeKpiTargets("oud-standaard", route("oud-standaard")), "conversions")?.soort === "standaard");
  });

  await deel("mergeKpiTargets zet de herkomst bij het doel", () => {
    const vast = mergeKpiTargets("absoluut", route("absoluut"));
    check("vast doel: 2.600, absoluut", vast.targetCurrentYear.conversions === 2600 && herkomst(vast, "conversions")?.soort === "absoluut", JSON.stringify(herkomst(vast, "conversions")));
    check("omzet vast op 0 is niets ingevoerd: de standaard", herkomst(vast, "revenue")?.soort === "standaard", JSON.stringify(herkomst(vast, "revenue")));
    const groei = mergeKpiTargets("groei", route("groei"));
    check("groei 15: vorig jaar x 1,15 en de herkomst noemt 15", groei.targetCurrentYear.conversions === 1656 && herkomst(groei, "conversions")?.soort === "groei" && herkomst(groei, "conversions")?.groeiPct === 15,
      `${groei.targetCurrentYear.conversions} ${JSON.stringify(herkomst(groei, "conversions"))}`);
    const niets = mergeKpiTargets("null-rij", route("null-rij"));
    check("niets ingevoerd: het standaarddoel, en de standaard als herkomst", niets.targetCurrentYear.conversions === routeDoel.conversions && herkomst(niets, "conversions")?.soort === "standaard",
      `${niets.targetCurrentYear.conversions} ${JSON.stringify(herkomst(niets, "conversions"))}`);
    // De herkomst gaat mee naar de prognose: daar lezen de schermen hem.
    check("computeForecast draagt de herkomst mee", (fc.computeForecast(vast) as { doelHerkomst?: unknown }).doelHerkomst === (vast as { doelHerkomst?: unknown }).doelHerkomst);
  });

  await deel("Een vast doel in Instellingen (de demo): 'jaardoel', nergens 'geschat'", () => {
    const s = schermen("absoluut");
    check("voorwaarde: 2.600 als doel, achter op het doel", s.forecast.conversions.kpi.annualTarget === 2600 && s.forecast.budgetRecommendation.behindTarget);
    check("Doelstelling: 'Prognose X% van jaardoel'", /^Prognose \d+% van jaardoel$/.test(s.doelFactor), s.doelFactor);
    check("de anomalie heet 'Jaardoel in gevaar'", s.gevaar?.title === "Jaardoel in gevaar", JSON.stringify(s.gevaar));
    check("en zegt niet dat er geen doel is ingevoerd", /^Prognose is slechts \d+% van het jaardoel\. Zonder ingrijpen wordt het niet gehaald\.$/.test(s.gevaar?.description ?? ""), s.gevaar?.description);
    check("pacing: 'X% van jaardoel'", /\d+% van jaardoel/.test(s.pacing), rond(s.pacing, "Op dit tempo"));
    check("grafiek: 'om het jaardoel te halen.'", s.grafiek.includes("om het jaardoel te halen."), rond(s.grafiek, "Budget aanbeveling"));
    check("rapport: 'Het jaardoel wordt ... niet gehaald'", s.rapport.includes("Het jaardoel wordt op basis van de huidige trend niet gehaald. Om het te bereiken:"), rond(s.rapport, "Budget Aanbeveling", 260));
    check("op geen enkel scherm 'geschat' of 'nog geen doel ingevoerd'", nergensGeschat(s), [rond(s.badge, "eschat"), rond(s.pacing, "eschat"), rond(s.grafiek, "eschat"), rond(s.rapport, "ESCHAT")].join(" || "));
  });

  await deel("Een groei in Instellingen: 'jaardoel (vorig jaar +15%)'", () => {
    const s = schermen("groei");
    check("Doelstelling", /^Prognose \d+% van jaardoel \(vorig jaar \+15%\)$/.test(s.doelFactor), s.doelFactor);
    check("anomalie", s.gevaar?.title === "Jaardoel in gevaar" && /van het jaardoel \(vorig jaar \+15%\)\. Zonder ingrijpen wordt het niet gehaald\.$/.test(s.gevaar.description), JSON.stringify(s.gevaar));
    check("pacing", /\d+% van jaardoel \(vorig jaar \+15%\)/.test(s.pacing), rond(s.pacing, "Op dit tempo"));
    check("grafiek", s.grafiek.includes("om het jaardoel te halen (vorig jaar +15%)."), rond(s.grafiek, "Budget aanbeveling"));
    check("rapport", s.rapport.includes("Het jaardoel (vorig jaar +15%) wordt op basis van de huidige trend niet gehaald."), rond(s.rapport, "Budget Aanbeveling", 260));
    check("nergens 'geschat'", nergensGeschat(s));
    const krimp = computeHealthScore(fc.computeForecast(mergeKpiTargets("krimp", route("krimp")))).factors.find((f) => f.name === "Doelstelling")?.description ?? "";
    check("een krimpdoel met zijn teken: 'vorig jaar -10%'", /van jaardoel \(vorig jaar -10%\)$/.test(krimp), krimp);
  });

  await deel("Opgeslagen met de standaardwaarde 10: een ingevoerd doel van +10%", () => {
    const s = schermen("bewaard");
    check("Doelstelling: 'jaardoel (vorig jaar +10%)', zonder 'geschat'", /^Prognose \d+% van jaardoel \(vorig jaar \+10%\)$/.test(s.doelFactor), s.doelFactor);
    check("nergens 'geschat' of 'nog geen doel ingevoerd'", nergensGeschat(s));
  });

  await deel("Niets ingevoerd: de schatting, woord voor woord zoals voorheen", () => {
    for (const id of ["null-rij", "geen-rij", "nooit-geladen"]) {
      const s = schermen(id);
      check(`${id}: Doelstelling`, /^Prognose \d+% van geschat jaardoel \(vorig jaar \+10%\)$/.test(s.doelFactor), s.doelFactor);
      check(`${id}: anomalie`, s.gevaar?.title === "Geschat jaardoel in gevaar"
        && /^Prognose is slechts \d+% van het geschatte jaardoel \(vorig jaar \+10%; er is nog geen doel ingevoerd\)\. Zonder ingrijpen wordt dat niveau niet gehaald\.$/.test(s.gevaar.description), JSON.stringify(s.gevaar));
      check(`${id}: pacing`, /\d+% van geschat jaardoel/.test(s.pacing), rond(s.pacing, "Op dit tempo"));
      check(`${id}: grafiek`, s.grafiek.includes("om het geschatte jaardoel te halen (vorig jaar +10%; er is nog geen doel ingevoerd)."), rond(s.grafiek, "Budget aanbeveling"));
      check(`${id}: rapport`, s.rapport.includes("Het GESCHATTE jaardoel (vorig jaar +10%, automatisch afgeleid — er is nog geen doel ingevoerd) wordt op basis van de huidige trend niet gehaald. Om dat niveau te bereiken:"), rond(s.rapport, "Budget Aanbeveling", 260));
    }
  });

  await deel("Alleen een omzetdoel: 'nog geen conversiedoel', niet 'nog geen doel'", async () => {
    // De zinnen rekenen op het conversiedoel, en dat is de schatting. Maar "er is nog geen doel
    // ingevoerd" was onwaar: het omzetdoel staat in Instellingen. Nu noemen ze het ontbrekende doel.
    await instellingen.loadClientSettings("omzet");
    const s = schermen("omzet");
    check("voorwaarde: conversies de standaard, omzet vast", herkomst(s.data, "conversions")?.soort === "standaard" && herkomst(s.data, "revenue")?.soort === "absoluut",
      JSON.stringify((s.data as { doelHerkomst?: unknown }).doelHerkomst));
    check("grafiek", s.grafiek.includes("om het geschatte jaardoel te halen (vorig jaar +10%; er is nog geen conversiedoel ingevoerd)."), rond(s.grafiek, "Budget aanbeveling"));
    check("rapport", s.rapport.includes("Het GESCHATTE jaardoel (vorig jaar +10%, automatisch afgeleid — er is nog geen conversiedoel ingevoerd) wordt op basis van de huidige trend niet gehaald."), rond(s.rapport, "Budget Aanbeveling", 260));
    check("anomalie", s.gevaar?.title === "Geschat jaardoel in gevaar" && (s.gevaar.description ?? "").includes("het geschatte jaardoel (vorig jaar +10%; er is nog geen conversiedoel ingevoerd)"), JSON.stringify(s.gevaar));
    check("nergens 'nog geen doel ingevoerd'", [s.badge, s.pacing, s.grafiek, s.rapport, s.gevaar?.description ?? ""].every((t) => !t.includes("nog geen doel ingevoerd")),
      [rond(s.grafiek, "nog geen"), rond(s.rapport, "nog geen")].join(" || "));
  });

  await deel("Alle kanalen: de som per kanaal draagt de herkomst mee", () => {
    // Twee kanalen met dezelfde maanden; samen de optelling zoals de blended hook hem bouwt.
    const kanaal = (k: string, deel: number): ClientHistoricalData => buildClientDataFromApi(k,
      [{ year: 2025, monthly: api([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 120 * deel, 24000 * deel, 11000 * deel), weekly: [] }],
      api([1, 2, 3, 4, 5, 6, 7], 55 * deel, 11000 * deel, 11000 * deel), [], standaardJaardoel({ conversions: 1440 * deel, revenue: 288000 * deel, adSpend: 132000 * deel }), 2026, 7);
    for (const [id, verwacht] of [["absoluut", "om het jaardoel te halen."], ["null-rij", "om het geschatte jaardoel te halen (vorig jaar +10%; er is nog geen doel ingevoerd)."]] as const) {
      const samen = mergeKpiTargets(id, route(id));
      const f = som.somForecast([fc.computeForecast(kanaal("google", 0.5)), fc.computeForecast(kanaal("meta", 0.5))], samen.targetCurrentYear, samen);
      check(`${id}: somForecast draagt de herkomst van de optelling`, (f as { doelHerkomst?: unknown }).doelHerkomst === (samen as { doelHerkomst?: unknown }).doelHerkomst && herkomst(f, "conversions") !== undefined);
      const grafiek = tekst(React.createElement(PerformanceChartView, { clientData: samen, forecast: f }));
      check(`${id}: de grafiek op Alle kanalen`, grafiek.includes(verwacht), rond(grafiek, "Budget aanbeveling"));
      // Zonder kanalen valt blendedForecastUitKanalen terug op computeForecast(samen).
      check(`${id}: ook de terugval zonder kanalen`, herkomst(som.blendedForecastUitKanalen(id, [], samen, 7), "conversions")?.soort === herkomst(samen, "conversions")?.soort);
    }
  });

  await deel("Een landfilter houdt de herkomst", () => {
    const vol = mergeKpiTargets("absoluut", route("absoluut"));
    const rij = (m: number) => ({ countryCode: "NL", month: `2026-${String(m).padStart(2, "0")}-01`, conversions: 30, conversionsValue: 6000, cost: 6000, spendShare: 0.5 });
    const nl = landGefilterdeData(vol, [1, 2, 3, 4, 5, 6, 7].map(rij) as unknown as Parameters<typeof landGefilterdeData>[1], "NL");
    check("het landdeel van een vast doel is nog steeds een ingevoerd doel", herkomst(nl, "conversions")?.soort === "absoluut", JSON.stringify(herkomst(nl, "conversions")));
  });

  await deel("Kanaaltabbladen: geen herkomst, dus de schatting zoals voorheen", () => {
    // Meta/LinkedIn/Microsoft krijgen hun prognose uit buildChannelForecastUitEmmers (het tab-object
    // van useBlendedClientData), zonder herkomst: het doel komt uit client_targets of is vorig jaar
    // plus groei. Daar geldt de eigen regel van het kanaal ("geen jaardoel ingesteld voor dit
    // kanaal" in de beurssectie); de health score blijft de schatting noemen. Sinds fase 1, stap 5
    // geldt dat ook voor de kanaalbadges en KanaalHealthRanking, die hetzelfde object lezen. Alleen
    // de rapporten en Code Rood lopen nog via computeAnalysisTargets, en die geeft de herkomst wel
    // mee (lib/analysis/__compute_targets_test.ts).
    const kanaalForecast = JSON.parse(JSON.stringify(fc.computeForecast(route("kanaal"))));
    const d = computeHealthScore(kanaalForecast).factors.find((f) => f.name === "Doelstelling")?.description ?? "";
    check("Doelstelling op een kanaaltab", /^Prognose \d+% van geschat jaardoel \(vorig jaar \+10%\)$/.test(d), d);
  });

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
