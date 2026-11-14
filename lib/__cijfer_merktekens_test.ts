// Test: de cijfers die de cijfercontrole (scripts/check-cijfers-gelijk.mjs) op een data-cijfer
// afleest, staan er ook echt met dat merkteken. Draaien: tsx lib/__cijfer_merktekens_test.ts
//
// Wat er misging. De controle eindigde op twee punten altijd met NIET GEMETEN:
// - het jaardoel stond op de Prognose ("vs. doel 1.650 (-24%)") en op Doelen & voortgang ("Doel:
//   1.650") in kleine tekst, en de lezer zag alleen getallen vanaf 18 px onder een label;
// - op Campagnes telde hij de tfoot's van de campagnetabellen op, die een vast venster hebben (90
//   dagen, hele maanden) en dus nooit gelijk horen te zijn aan twaalf maanden Overzicht.
// Nu zet de pagina het cijfer zelf neer: data-cijfer="jaardoel" met data-kpi, en
// data-cijfer="kanaaltotaal-conversies" / "kanaaltotaal-kosten" op de totaalrij van de kanaaltotalen.
// Het jaardoel draagt ook data-reeks: zonder ingevoerd doel schat elke reeks zijn eigen doel (vorig
// jaar +10%), en dan is "Google 1.430 tegen alle kanalen 1.650" geen fout. De controle vergelijkt
// het doel alleen tussen twee plekken met dezelfde reeks.
// Haalt iemand zo'n merkteken weg, dan staat de controle weer stil op NIET GEMETEN; deze test zegt
// het eerder.
//
// De componenten lezen hun data uit contexten (ClientDataProvider). Die worden hier gevuld door
// createContext en useContext te omwikkelen vóór de componenten geladen worden, zoals in
// lib/__geen_noemer_teksten_test.ts: zo rendert het echte component.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientHistoricalData, MonthlyRecord } from "./types";

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

// ── Contexten vullen: elk createContext krijgt een naam (bestand#volgnummer) ─────────────────
const namen = new Map<unknown, string>();
const waarden: Record<string, unknown> = {};
const echtCreate = React.createContext;
(React as { createContext: unknown }).createContext = (standaard: unknown) => {
  const ctx = echtCreate(standaard);
  const regel = (new Error().stack ?? "").split("\n").find((l) => /\/(lib|components)\//.test(l) && !l.includes("__cijfer_merktekens_test")) ?? "";
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

// ── Een jaar met een doel: 1.300 conversies, € 26.000 kosten; zeven maanden van 100 conversies ──
const maand = (m: number, conv: number, spend: number): MonthlyRecord => ({
  month: m, conversions: conv, revenue: conv * 100, adSpend: spend,
  weeks: [1, 2, 3, 4].map((w) => ({ week: w, month: m, conversions: conv / 4, revenue: conv * 25, adSpend: spend / 4 })),
});
const DATA: ClientHistoricalData = {
  clientId: "t", currentYear: 2026, dataStand: null,
  targetCurrentYear: { conversions: 1300, revenue: 130000, adSpend: 26000 },
  historicalYears: { 2025: Array.from({ length: 12 }, (_, i) => maand(i + 1, 100, 2000)) },
  currentYearData: Array.from({ length: 12 }, (_, i) => (i < 7 ? maand(i + 1, 100, 2000) : null)),
};

/** De tekst van elk element met dit merkteken, met zijn data-kpi en data-reeks. */
function gemerkt(html: string, naam: string): { kpi: string | null; reeks: string | null; tekst: string }[] {
  const uit: { kpi: string | null; reeks: string | null; tekst: string }[] = [];
  const re = new RegExp(`<span([^>]*)data-cijfer="${naam}"([^>]*)>([^<]*)</span>`, "g");
  for (const m of html.matchAll(re)) {
    const attrs = `${m[1]} ${m[2]}`;
    uit.push({ kpi: (attrs.match(/data-kpi="([^"]*)"/) ?? [])[1] ?? null, reeks: (attrs.match(/data-reeks="([^"]*)"/) ?? [])[1] ?? null, tekst: m[3].replace(/&nbsp;| /g, " ").trim() });
  }
  return uit;
}

async function main() {
  const fc = await import("./forecast");
  const { formatterFor } = await import("./forecast-format");
  const { ForecastSummaryTiles } = await import("../components/dashboard/forecast-table");
  const { DgmView } = await import("../components/dashboard/dgm-view");

  const forecast = fc.computeForecast(DATA);
  waarden["lib/client-data-provider.tsx#0"] = { data: DATA, loading: false, error: null };
  waarden["lib/client-data-provider.tsx#1"] = forecast;
  const doelTekst = formatterFor("conversions")(forecast.conversions.kpi.annualTarget);

  await deel("[1] Prognose: het jaardoel staat gemerkt, met de KPI erbij en zonder het percentage", () => {
    const html = renderToStaticMarkup(React.createElement(ForecastSummaryTiles, { clientId: "t" }));
    const doelen = gemerkt(html, "jaardoel");
    check("precies één jaardoel", doelen.length === 1, JSON.stringify(doelen));
    check(`het doel zelf (${doelTekst}), van de KPI conversions`, doelen[0]?.kpi === "conversions" && doelen[0]?.tekst === doelTekst, JSON.stringify(doelen));
    check("over de reeks van het tabblad (google)", doelen[0]?.reeks === "google", JSON.stringify(doelen));
  });

  await deel("[2] Doelen & voortgang: elke doelkaart merkt zijn doel, per KPI", () => {
    const html = renderToStaticMarkup(React.createElement(DgmView, { clientId: "t" }));
    const doelen = gemerkt(html, "jaardoel");
    const conv = doelen.find((d) => d.kpi === "conversions");
    check(`de conversiekaart: ${doelTekst}, hetzelfde als op de Prognose`, conv?.tekst === doelTekst, JSON.stringify(doelen));
    check("elke kaart heeft een KPI, en geen KPI staat er twee keer", doelen.length > 1 && doelen.every((d) => d.kpi) && new Set(doelen.map((d) => d.kpi)).size === doelen.length, JSON.stringify(doelen));
    // Zonder kanalen rekent het tabblad op Google (reeksVanDoel), en dat moet de kaart zeggen.
    check("elke kaart zegt over welke reeks hij rekent (google)", doelen.every((d) => d.reeks === "google"), JSON.stringify(doelen));
  });

  await deel("[3] Campagnes: de totaalrij van de kanaaltotalen draagt de merktekens", () => {
    // De kanaaltabel haalt zijn rijen op via de blended route; die is in een test niet te bereiken,
    // dus hier de bron: de merktekens staan op de totalen `tot` van de totaalrij, niet op een kanaalrij.
    const bron = readFileSync(join(__dirname, "..", "components/dashboard/cross-channel-view.tsx"), "utf8");
    check("kosten: data-cijfer=\"kanaaltotaal-kosten\" om eur(tot.spend)", /<span data-cijfer="kanaaltotaal-kosten">\{eur\(tot\.spend\)\}<\/span>/.test(bron));
    check("conversies: data-cijfer=\"kanaaltotaal-conversies\" om fmt(tot.conversions)", /<span data-cijfer="kanaaltotaal-conversies">\{fmt\(tot\.conversions\)\}<\/span>/.test(bron));
    const totaalrij = bron.slice(bron.indexOf("<TotaalRij>"), bron.indexOf("</TotaalRij>"));
    check("beide binnen de totaalrij", /kanaaltotaal-kosten/.test(totaalrij) && /kanaaltotaal-conversies/.test(totaalrij));
  });

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
