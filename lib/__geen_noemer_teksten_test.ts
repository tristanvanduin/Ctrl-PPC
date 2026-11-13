// Test: wat de schermen en teksten zeggen over een verhouding zonder noemer (kosten zonder één
// conversie), voorbij de maandpunten. Draaien: tsx lib/__geen_noemer_teksten_test.ts
//
// lib/__geen_noemer_test.ts dekt deriveForecast en de YTD-cijfers. Wat daarna nog misging:
// - de jaarprognose van een CPA zonder één verwachte conversie stond als "€ 0" op de kaart, in de
//   kanaaltegel, de Prognose-tabel en het rapport, naast "Gerealiseerd YTD —";
// - het rapport zei "geen conversies YTD, dus geen CPA" en twee regels later "Huidige CPA: € 20"
//   (het CPA-doel), en de inzichten en taken noemden dat getal ook "huidige CPA";
// - het DGM-tabblad toonde "Kosten per conversie € 0" waar Overzicht "—" zei;
// - de inzichten zeiden "CPA daalt … optimalisaties werken" direct na een maand van € 2.000
//   zonder één conversie, terwijl de health-score er een waarschuwing voor gaf;
// - de grafiekbanner, de DGM en het herstelplan gaven het CPA-budgetgetal ("+825% naar
//   € 101.767/maand") nog naast "pas te berekenen als de conversiemeting klopt" in de inzichten.
//
// De componenten lezen hun data uit contexten (ClientDataProvider, ChannelDataProvider). Die worden
// hier gevuld door createContext en useContext te omwikkelen vóór de componenten geladen worden:
// zo rendert het echte component, en niet een kopie van zijn tekst.

import { createRequire } from "node:module";
import type { ClientHistoricalData, MonthlyRecord, WeeklyRecord } from "./types";

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
  renderToStaticMarkup(el).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ── Contexten vullen: elk createContext krijgt een naam (bestand#volgnummer) ─────────────────
const namen = new Map<unknown, string>();
const waarden: Record<string, unknown> = {};
const echtCreate = React.createContext;
(React as { createContext: unknown }).createContext = (standaard: unknown) => {
  const ctx = echtCreate(standaard);
  const regel = (new Error().stack ?? "").split("\n").find((l) => /\/(lib|components)\//.test(l) && !l.includes("__geen_noemer_teksten_test")) ?? "";
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
// De metrickeuze in de views start op "conversions"; hier op `metric`. Met `open` staan ingeklapte
// lijsten (useState(false), "Toon alle inzichten") open.
let metric = "cpa";
let open = false;
const echtState = React.useState;
(React as { useState: unknown }).useState = (init: unknown) => echtState(init === "conversions" ? metric : init === false && open ? true : init);

// ── Scenario's: elke maand vier weken; 2025 normaal (25 conversies, € 500, € 2.500 per week) ──
const wk = (month: number, conv: number[], spend: number[], rev: number[]): WeeklyRecord[] =>
  conv.map((c, i) => ({ week: i + 1, month, conversions: c, revenue: rev[i], adSpend: spend[i] }));
const rec = (month: number, weeks: WeeklyRecord[]): MonthlyRecord => ({
  month, weeks,
  conversions: weeks.reduce((s, w) => s + w.conversions, 0),
  revenue: weeks.reduce((s, w) => s + w.revenue, 0),
  adSpend: weeks.reduce((s, w) => s + w.adSpend, 0),
});
const vol = (m: number) => rec(m, wk(m, [25, 25, 25, 25], [500, 500, 500, 500], [2500, 2500, 2500, 2500]));
const kostenZonderConv = (m: number) => rec(m, wk(m, [0, 0, 0, 0], [500, 500, 500, 500], [0, 0, 0, 0]));
const DOEL = { conversions: 1300, revenue: 130000, adSpend: 26000 };
const VORIG = { 2025: Array.from({ length: 12 }, (_, i) => vol(i + 1)) };
const jaar = (maanden: (MonthlyRecord | null)[]): (MonthlyRecord | null)[] => Array.from({ length: 12 }, (_, i) => maanden[i] ?? null);
// D: januari-juli € 2.000 per maand en geen enkele conversie, met een doel (CPA-doel € 20).
const D: ClientHistoricalData = { clientId: "t", currentYear: 2026, targetCurrentYear: DOEL, historicalYears: VORIG, currentYearData: jaar(Array.from({ length: 7 }, (_, i) => kostenZonderConv(i + 1))), dataStand: null };
// D0: idem zonder doel en zonder historie (een kanaal zonder jaardoel): geen verwachte conversie.
const D0: ClientHistoricalData = { ...D, targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 }, historicalYears: {} };
// G: CPA daalt januari-juni (70, 80 .. 120 conversies op € 2.000), juli € 2.000 en 0 conversies.
const G: ClientHistoricalData = {
  ...D,
  currentYearData: jaar([...[70, 80, 90, 100, 110, 120].map((c, i) => rec(i + 1, wk(i + 1, [c / 4, c / 4, c / 4, c / 4], [500, 500, 500, 500], [c * 25, c * 25, c * 25, c * 25]))), kostenZonderConv(7)]),
};
// G0: zonder die julimaand (t/m juni): de daling is echt, en dan hoort de positieve tekst er wel.
const G0: ClientHistoricalData = { ...G, currentYearData: jaar(G.currentYearData.slice(0, 6)) };

async function main() {
  const fc = await import("./forecast");
  const { computeHealthScore, zonderKanaalSpecifiekeHygiene } = await import("./health-score");
  const { MetricCardsView } = await import("../components/dashboard/metric-cards");
  const { ReportExport } = await import("../components/dashboard/report-export");
  const { ForecastTable, ForecastSummaryTiles } = await import("../components/dashboard/forecast-table");
  const { ChannelForecastOverview } = await import("../components/dashboard/channel-forecast-overview");
  const { DgmView } = await import("../components/dashboard/dgm-view");
  const { InsightsBlock } = await import("../components/insights/insights-block");
  const { RecommendationsBlock } = await import("../components/insights/recommendations-block");

  const zet = (data: ClientHistoricalData) => {
    const forecast = fc.computeForecast(data);
    waarden["lib/client-data-provider.tsx#0"] = { data, loading: false, error: null };
    waarden["lib/client-data-provider.tsx#1"] = forecast;
    // De KanaalData-vorm van de provider (fase 1, stap 5: met `maanden`, en het tab-object draagt
    // ook de health). Hier leest alleen ChannelForecastOverview hem, en die leest `forecast`.
    waarden["components/dashboard/channel-data-provider.tsx#0"] = {
      rijen: [], maanden: [], convVan: () => 0, convLabel: "",
      forecast: { data, forecast, health: zonderKanaalSpecifiekeHygiene(computeHealthScore(forecast)) },
    };
    return forecast;
  };
  const naNa = (t: string, van: string, lengte = 160) => { const i = t.indexOf(van); return i < 0 ? "(niet gevonden)" : t.slice(i, i + lengte); };

  await deel("[7] De CPA-jaarprognose zonder één verwachte conversie", () => {
    const f = zet(D0);
    check("voorwaarde: kosten geprognotiseerd, geen conversies", f.adSpend.kpi.adjustedAnnual > 0 && f.conversions.kpi.adjustedAnnual === 0,
      `${f.adSpend.kpi.adjustedAnnual} / ${f.conversions.kpi.adjustedAnnual}`);
    const verh = (fc as Partial<typeof fc>).jaarprognoseVerhouding;
    check("jaarprognoseVerhouding: CPA null, conversies gewoon de som", typeof verh === "function" && verh(f, "cpa") === null && verh(f, "conversions") === 0);
    check("jaarKaartCijfers: adjusted null", fc.jaarKaartCijfers(f, "cpa").adjusted === null, String(fc.jaarKaartCijfers(f, "cpa").adjusted));
    const normaal = zet({ ...D, currentYearData: jaar(Array.from({ length: 7 }, (_, i) => vol(i + 1))) });
    check("met conversies: de verhouding (gelijk aan kpi.adjustedAnnual)", verh?.(normaal, "cpa") === normaal.cpa.kpi.adjustedAnnual && verh?.(normaal, "roas") === normaal.roas.kpi.adjustedAnnual);

    zet(D0);
    const kaart = tekst(React.createElement(MetricCardsView, { forecast: fc.computeForecast(D0) }));
    const cpaKaart = naNa(kaart, "Gerealiseerd YTD —");
    check("Overzicht, CPA-kaart: 'Jaarprognose —', niet '€ 0'", /Jaarprognose —/.test(cpaKaart) && !/Jaarprognose € 0/.test(cpaKaart), cpaKaart);
    metric = "cpa";
    const tegel = tekst(React.createElement(ChannelForecastOverview, {}));
    const cpaTegel = naNa(tegel, "CPA Gerealiseerd YTD", 120);
    check("kanaaltegel CPA: 'Jaarprognose —'", /Jaarprognose —/.test(cpaTegel) && !/Jaarprognose € 0/.test(cpaTegel), cpaTegel);
    const tabel = tekst(React.createElement(ForecastTable, { clientId: "t" }));
    check("Prognose-tabel CPA: het totaal zegt '—', geen '€ 0' en geen '0%'", /Totaal € 0 — — —/.test(tabel) || /Totaal [^ ]+ [^ ]* — — —/.test(tabel), naNa(tabel, "Totaal", 60));
    const rapport = tekst(React.createElement(ReportExport, { clientId: "t" }));
    const cpaRegel = (rapport.match(/\| CPA \|[^\n]*?\|[^|]*\|[^|]*\|[^|]*\|/) ?? [""])[0];
    check("rapport: de CPA-regel zegt '-' voor de jaarprognose en het verschil", /\| CPA \| - \| [^|]+ \| - \| - \|/.test(cpaRegel), cpaRegel);
  });

  await deel("[8] Het budgetadvies zonder conversies YTD noemt het CPA-doel, geen 'huidige CPA'", () => {
    const f = zet(D);
    check("voorwaarde: achter op doel, CPA uit het doel (€ 20)", f.budgetRecommendation.behindTarget && f.budgetRecommendation.currentCpa === 20, JSON.stringify(f.budgetRecommendation));
    check("BudgetRecommendation.cpaUitDoel", (f.budgetRecommendation as { cpaUitDoel?: boolean }).cpaUitDoel === true);
    const rapport = tekst(React.createElement(ReportExport, { clientId: "t" }));
    check("rapport: geen 'Huidige CPA' naast 'geen conversies YTD, dus geen CPA'",
      rapport.includes("geen conversies YTD, dus geen CPA") && !rapport.includes("Huidige CPA") && /Gerekend met het CPA-doel\*\* \(nog geen conversies YTD\): € 20/.test(rapport),
      naNa(rapport, "Budget Aanbeveling", 300));
    const inzicht = tekst(React.createElement(InsightsBlock, { clientId: "t" }));
    // Hier stond ook "en wel 'het CPA-doel van € 20'". Na zeven maanden kosten zonder één conversie
    // geeft het budgetblok geen budget meer op een CPA (zie [10b]): het tekort blijft staan, het
    // budget wacht op de conversiemeting. Het rapport en de DGM noemen het CPA-doel nog wel.
    check("inzichten: niet 'Bij huidige CPA van € 20'", !/huidige CPA van € 20/.test(inzicht), naNa(inzicht, "Om het jaardoel", 200));
    check("inzichten: het tekort, en het budget pas na de conversiemeting", /Om het jaardoel te halen zijn nog [\d.]+ conversies nodig/.test(inzicht) && /pas te berekenen als de conversiemeting klopt/.test(inzicht),
      naNa(inzicht, "Om het jaardoel", 260));
    const dgm = tekst(React.createElement(DgmView, { clientId: "t" }));
    check("DGM: niet 'bij huidige CPA van € 20'", !/huidige CPA van € 20/.test(dgm), (dgm.match(/[^.]*huidige CPA[^.]*\./) ?? [""])[0]);
    // Met conversies YTD blijft het de huidige CPA.
    const g = zet(G);
    check("met conversies YTD: cpaUitDoel false", (g.budgetRecommendation as { cpaUitDoel?: boolean }).cpaUitDoel === false);
  });

  await deel("[9] DGM-tabblad: een CPA zonder één conversie is geen € 0", () => {
    zet(D);
    const dgm = tekst(React.createElement(DgmView, { clientId: "t" }));
    check("DGM CPA-kaart: niet 'Kosten per conversie € 0'", !/Kosten per conversie € 0\b/.test(dgm) && /Kosten per conversie —/.test(dgm), (dgm.match(/Kosten per conversie [^ ]+ [^ ]*/) ?? [""])[0]);
  });

  await deel("[10] Inzichten na een maand met kosten en geen conversies", () => {
    zet(G);
    open = true;
    const inzicht = tekst(React.createElement(InsightsBlock, { clientId: "t" }));
    check("inzichten: geen 'CPA daalt' en geen 'optimalisaties werken'", !inzicht.includes("CPA daalt") && !inzicht.includes("optimalisaties werken"), naNa(inzicht, "Efficiency", 200));
    check("inzichten: wel een waarschuwing over kosten zonder conversie in juli", /Jul[^.]*kosten zonder één conversie/.test(inzicht), naNa(inzicht, "Efficiency", 200));
    const adv = tekst(React.createElement(RecommendationsBlock, { clientId: "t" }));
    check("aanbevelingen: geen 'CPA daalt' en geen budgetverhoging op die daling", !adv.includes("CPA daalt") && !/ideale moment om budget te verhogen/.test(adv), naNa(adv, "CPA", 200));
    // Zonder die maand: de daling is echt.
    zet(G0);
    const echt = tekst(React.createElement(InsightsBlock, { clientId: "t" }));
    check("zonder julimaand: 'CPA daalt' blijft", echt.includes("CPA daalt"), naNa(echt, "Efficiency", 200));
    open = false;
  });

  await deel("[10b] Geen budgetadvies op de CPA naast 'controleer eerst de conversiemeting'", async () => {
    // De waarschuwing zegt "verhoog of verschuif geen budget op basis van de CPA tot dat duidelijk
    // is"; ernaast stond "Verhoog het maandbudget … Bij de huidige CPA van € 25 levert dit 48 extra
    // conversies", een target CPA, "vereist dit € 5.895 extra budget" en een taak voor een
    // budget-voorstel. Dat advies rekent met een CPA die een maand zonder één gemeten conversie bevat.
    const { TasksBlock } = await import("../components/insights/tasks-block");
    const budgetAdvies = (adv: string, inzicht: string, taken: string) => ({
      verhoog: adv.includes("Verhoog het maandbudget"),
      targetCpa: /target CPA van €/.test(adv),
      vereist: /vereist dit € [\d.]+ extra budget/.test(inzicht),
      budgetProbleem: inzicht.includes("het budget is het probleem") || inzicht.includes("Als budget wordt opgeschaald naar plan"),
      voorstel: taken.includes("budget-voorstel"),
    });
    open = true;
    zet(G);
    const g = budgetAdvies(tekst(React.createElement(RecommendationsBlock, { clientId: "t" })), tekst(React.createElement(InsightsBlock, { clientId: "t" })), tekst(React.createElement(TasksBlock, { clientId: "t" })));
    check("met de julimaand zonder conversies: geen 'Verhoog het maandbudget'", !g.verhoog);
    check("met de julimaand: geen target CPA van € …", !g.targetCpa);
    check("met de julimaand: geen 'vereist dit … extra budget'", !g.vereist);
    check("met de julimaand: niet 'het budget is het probleem'", !g.budgetProbleem);
    check("met de julimaand: geen taak 'budget-voorstel'", !g.voorstel);
    const taken = tekst(React.createElement(TasksBlock, { clientId: "t" }));
    check("met de julimaand: wel een taak om de conversiemeting te controleren", /conversiemeting/.test(taken), naNa(taken, "Budget", 200));
    const inzicht = tekst(React.createElement(InsightsBlock, { clientId: "t" }));
    check("met de julimaand: het tekort aan conversies blijft genoemd", /Om het jaardoel te halen zijn nog [\d.]+ conversies nodig/.test(inzicht), naNa(inzicht, "Om het jaardoel", 300));
    zet(G0);
    const g0 = budgetAdvies(tekst(React.createElement(RecommendationsBlock, { clientId: "t" })), tekst(React.createElement(InsightsBlock, { clientId: "t" })), tekst(React.createElement(TasksBlock, { clientId: "t" })));
    check("zonder julimaand: het budgetadvies blijft", g0.verhoog && g0.vereist && g0.voorstel, JSON.stringify(g0));
    // De target CPA staat bij een grotere achterstand (Biedstrategie, conversies > 15% achter): in G
    // wel, zonder juli niet. Daarom hier apart: G zonder de julimaand-regel zou hem tonen.
    check("voorwaarde: G is meer dan 15% achter (dan staat de Biedstrategie er)", fc.computeForecast(G).conversions.kpi.diffPct < -15);
    // Met minder spend (€ 1.500 per maand, 31% onder het doel) zei het spendblok "het budget is het
    // probleem" en "Als budget wordt opgeschaald naar plan, herstelt de prognose": ook een
    // budgetadvies op een efficiency met een maand zonder één conversie erin.
    const laag = (zonderJuli: boolean): ClientHistoricalData => ({
      ...G,
      currentYearData: jaar([...[70, 80, 90, 100, 110, 120].map((c, i) => rec(i + 1, wk(i + 1, [c / 4, c / 4, c / 4, c / 4], [375, 375, 375, 375], [c * 25, c * 25, c * 25, c * 25]))),
        ...(zonderJuli ? [] : [rec(7, wk(7, [0, 0, 0, 0], [375, 375, 375, 375], [0, 0, 0, 0]))])]),
    });
    zet(laag(false));
    const laagMet = tekst(React.createElement(InsightsBlock, { clientId: "t" }));
    check("minder spend, met de julimaand: niet 'het budget is het probleem' of 'opgeschaald naar plan'",
      !laagMet.includes("het budget is het probleem") && !laagMet.includes("Als budget wordt opgeschaald naar plan"), naNa(laagMet, "Ad spend ligt", 300));
    check("minder spend, met de julimaand: de spend onder het doel blijft genoemd", /Ad spend ligt [^ ]+ onder target/.test(laagMet), naNa(laagMet, "Ad spend", 120));
    zet(laag(true));
    const laagZonder = tekst(React.createElement(InsightsBlock, { clientId: "t" }));
    check("minder spend, zonder julimaand: 'het budget is het probleem' blijft", laagZonder.includes("het budget is het probleem"), naNa(laagZonder, "Ad spend ligt", 300));
    open = false;
  });

  await deel("[10c] Grafiekbanner, DGM en herstelplan zeggen over het budget hetzelfde als Inzichten", async () => {
    // Inzichten zei na de julimaand "hoeveel budget daarvoor nodig is, is pas te berekenen als de
    // conversiemeting klopt", en op dezelfde pagina zei de banner boven de grafiek "Verhoog
    // maandelijks budget met 825% naar € 101.767/maand", de DGM "de CPA (€ 233) ligt boven het
    // doel", "Budgetvoorstel voorbereiden: € 453.833 extra budget" en "Scenario: bij een
    // budgetverhoging van 825%", en het herstelplan verwees naar "de CPA berekening hierboven" die
    // er niet meer stond. Dat getal rekent met een CPA waar die maand in de teller zit.
    const { PerformanceChartView } = await import("../components/dashboard/performance-chart");
    const render = (data: ClientHistoricalData) => {
      const f = zet(data);
      return {
        f,
        banner: naNa(tekst(React.createElement(PerformanceChartView, { clientData: data, forecast: f, metric: "conversions" })), "Budget aanbeveling", 260),
        dgm: tekst(React.createElement(DgmView, { clientId: "t" })),
        inzicht: tekst(React.createElement(InsightsBlock, { clientId: "t" })),
        adv: tekst(React.createElement(RecommendationsBlock, { clientId: "t" })),
      };
    };
    const cpaBudgetGetal = (r: ReturnType<typeof render>) => ({
      banner: /Verhoog maandelijks budget met \d+%|€ [\d.]+\/maand/.test(r.banner),
      dgmCpa: /Meer budget is niet de oplossing: de CPA \(€/.test(r.dgm) || /Efficiency verbeteren vóór budget verhogen/.test(r.dgm),
      dgmVerhoging: /Budget verhogen met \d+%|budgetverhoging van \d+%/.test(r.dgm),
      dgmVoorstel: /Budgetvoorstel voorbereiden/.test(r.dgm) && /€ [\d.]+ extra budget nodig/.test(r.dgm),
      herstelplan: /\(5\) Overleg budget verhoging met de klant op basis van de CPA berekening hierboven/.test(r.inzicht),
      klantbespreking: /Gebruik de budget-aanbeveling als basis voor het gesprek/.test(r.adv),
    });
    // G is 18% achter, en het herstelplan (sectie 10) en de klantbespreking staan er pas vanaf 25%:
    // dezelfde reeks met de helft van de conversies, met en zonder de julimaand.
    const GV: ClientHistoricalData = {
      ...G,
      currentYearData: jaar([...[35, 40, 45, 50, 55, 60].map((c, i) => rec(i + 1, wk(i + 1, [c / 4, c / 4, c / 4, c / 4], [500, 500, 500, 500], [c * 25, c * 25, c * 25, c * 25]))), kostenZonderConv(7)]),
    };
    const GV0: ClientHistoricalData = { ...GV, currentYearData: jaar(GV.currentYearData.slice(0, 6)) };
    open = true;
    const g = render(GV);
    check("voorwaarde: GV is achter op doel met een budgetadvies, en meer dan 25% achter (herstelplan)",
      g.f.budgetRecommendation.behindTarget && g.f.budgetRecommendation.spendIncreasePct > 5 && g.f.conversions.kpi.diffPct < -25,
      JSON.stringify({ behind: g.f.budgetRecommendation.behindTarget, pct: g.f.budgetRecommendation.spendIncreasePct, diff: g.f.conversions.kpi.diffPct }));
    const met = cpaBudgetGetal(g);
    check("met de julimaand: de banner noemt geen percentage en geen maandbedrag", !met.banner, g.banner);
    check("met de julimaand: de banner zegt dat het budget wacht op de conversiemeting", /pas te berekenen als de conversiemeting klopt: in Jul/.test(g.banner), g.banner);
    // De herkomst van het doel (lib/__doel_herkomst_test.ts) hoort ook in de wacht-tak: die zei "om
    // het geschatte jaardoel te halen" zonder "(vorig jaar +10%; er is nog geen doel ingevoerd)", en
    // bij een groeidoel "het jaardoel" zonder "(vorig jaar +15%)". GV heeft geen doelHerkomst: de schatting.
    check("met de julimaand: de wacht-banner draagt de herkomst van het geschatte doel",
      /om het geschatte jaardoel \(vorig jaar \+10%; er is nog geen doel ingevoerd\) te halen, is pas te berekenen/.test(g.banner), g.banner);
    const gGroei = render({ ...GV, doelHerkomst: { conversions: { soort: "groei", groeiPct: 15 }, revenue: { soort: "groei", groeiPct: 15 } } });
    check("met de julimaand, groeidoel: 'het jaardoel (vorig jaar +15%)' in de wacht-banner, nergens 'geschat'",
      /om het jaardoel \(vorig jaar \+15%\) te halen, is pas te berekenen/.test(gGroei.banner) && !/geschat/.test(gGroei.banner), gGroei.banner);
    const gVast = render({ ...GV, doelHerkomst: { conversions: { soort: "absoluut" }, revenue: { soort: "absoluut" } } });
    check("met de julimaand, vast doel: 'om het jaardoel te halen', zonder haakjes",
      /om het jaardoel te halen, is pas te berekenen/.test(gVast.banner) && !/geschat|vorig jaar/.test(gVast.banner), gVast.banner);
    check("met de julimaand, DGM: niet 'de CPA (€ …) ligt boven het doel' en niet 'Efficiency verbeteren vóór budget verhogen'", !met.dgmCpa, naNa(g.dgm, "Meer budget", 200));
    check("met de julimaand, DGM: geen 'Budget verhogen met X%' en geen 'budgetverhoging van X%'", !met.dgmVerhoging, naNa(g.dgm, "verhog", 200));
    check("met de julimaand, DGM: geen 'Budgetvoorstel voorbereiden … € … extra budget nodig'", !met.dgmVoorstel, naNa(g.dgm, "Budgetvoorstel", 200));
    check("met de julimaand, DGM: wel 'Conversiemeting controleren', en het scenario wacht op de meting",
      /Conversiemeting controleren/.test(g.dgm) && /Scenario: hoeveel budget nodig is.*?pas te berekenen als de conversiemeting klopt: in Jul/.test(g.dgm), naNa(g.dgm, "Scenario:", 260));
    check("met de julimaand: herstelplan (5) verwijst niet naar 'de CPA berekening hierboven'", !met.herstelplan && /\(5\) Controleer eerst de conversiemeting/.test(g.inzicht), naNa(g.inzicht, "(5)", 160));
    check("met de julimaand: de klantbespreking verwijst niet naar 'de budget-aanbeveling'", !met.klantbespreking && /een budget-aanbeveling volgt pas als die klopt/.test(g.adv), naNa(g.adv, "Klantbespreking", 400));
    // Zonder die maand staat het advies er gewoon, met getal.
    const g0 = render(GV0);
    check("voorwaarde: GV0 ook achter op doel met een budgetadvies, en meer dan 25% achter",
      g0.f.budgetRecommendation.behindTarget && g0.f.budgetRecommendation.spendIncreasePct > 5 && g0.f.conversions.kpi.diffPct < -25,
      JSON.stringify({ behind: g0.f.budgetRecommendation.behindTarget, pct: g0.f.budgetRecommendation.spendIncreasePct, diff: g0.f.conversions.kpi.diffPct }));
    const zonder = cpaBudgetGetal(g0);
    // GV0 heeft een CPA boven het CPA-doel (efficiencyBottleneck). Hier stond eerst "Verhoog
    // maandelijks budget met X%" in de banner en "Scenario: bij een budgetverhoging van X%" op
    // Doelen, naast "meer budget is niet de oplossing" op diezelfde pagina. Sinds 13 november komen
    // alle drie uit één regel (budgetAdvies in lib/doel/jaardoel.ts), en die zegt hier: efficiëntie.
    check("voorwaarde: GV0 heeft een efficiëntie-bottleneck", g0.f.budgetRecommendation.efficiencyBottleneck);
    check("zonder julimaand, CPA boven doel: de banner zegt efficiëntie eerst, met de herkomst van het doel en zonder percentage",
      /meer budget is niet de oplossing om het geschatte jaardoel te halen \(vorig jaar \+10%; er is nog geen doel ingevoerd\)\./.test(g0.banner) && !zonder.banner, g0.banner);
    check("zonder julimaand, CPA boven doel: DGM zegt efficiëntie, zonder budgetvoorstel of scenario met +X%",
      zonder.dgmCpa && !zonder.dgmVoorstel && !/Scenario: Bij een budgetverhoging van \d+%/.test(g0.dgm), JSON.stringify(zonder));
    check("zonder julimaand: herstelplan (5) en klantbespreking zoals voorheen", zonder.herstelplan && zonder.klantbespreking, JSON.stringify(zonder));
    open = false;
  });

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
