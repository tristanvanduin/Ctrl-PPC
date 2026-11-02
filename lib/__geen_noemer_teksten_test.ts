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
//   zonder één conversie, terwijl de health-score er een waarschuwing voor gaf.
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
    waarden["components/dashboard/channel-data-provider.tsx#0"] = { rijen: [], convVan: () => 0, convLabel: "", forecast: { data, forecast } };
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

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
