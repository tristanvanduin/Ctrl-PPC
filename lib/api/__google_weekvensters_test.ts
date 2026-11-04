// De twee weekaanroepen van de client-data-route en hun grens over de jaarwisseling. Geen IO.
// Draaien: tsx lib/api/__google_weekvensters_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Google levert weekrijen op de maandag (segments.week), afgekapt op het gevraagde bereik. De
// route vroeg de historie t/m 31 december en het lopende jaar vanaf 1 januari. De week van maandag
// 29 december 2025 viel daardoor in twee stukken: 29-31 december als korte vijfde decemberweek in
// de historie, en 1-4 januari als een rij met een maandag in 2025 in de aanroep van 2026 -- die
// googleAdsWeeklyByYear(...).get(2026) weggooit. Vier dagen van januari stonden in geen enkel
// weekrecord, en december 2025 had een vijfde week van drie dagen waar december 2024 (midden in de
// historie) er een van zeven had. De echte API is hier niet bereikbaar; de nabootsing hieronder
// doet wat hij doet: per maandag, afgekapt op het bereik.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GoogleAdsMetrics } from "./google-ads";
import { googleAdsWeeklyByYear } from "./adapter";
import { addDays } from "../reporting-date";
// Als namespace: tegen een versie zonder deze export een FAIL-regel, geen crash bij het laden.
import * as vensters from "./google-weekvensters";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const DAG_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Zoals de API: een rij per maandag, met alleen de dagen binnen [van, tot]. Conversies = dagen. */
function apiWeken(van: string, tot: string): GoogleAdsMetrics[] {
  const perMaandag = new Map<string, number>();
  for (let ms = Date.parse(`${van}T00:00:00Z`); ms <= Date.parse(`${tot}T00:00:00Z`); ms += DAG_MS) {
    const maandag = iso(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAG_MS);
    perMaandag.set(maandag, (perMaandag.get(maandag) ?? 0) + 1);
  }
  return [...perMaandag].map(([date, dagen]) => ({
    date, impressions: 0, clicks: 0, cost: dagen, conversions: dagen, conversionsValue: dagen,
    ctr: 0, avgCpc: 0, costPerConversion: 0, conversionRate: 0,
  }));
}
const dagenTussen = (van: string, tot: string) => Math.round((Date.parse(tot) - Date.parse(van)) / DAG_MS) + 1;

// De oude grens, als voorwaarde: anders bewijst de rest niets.
console.log("De oude grens (1 januari)");
{
  const lopend = apiWeken("2026-01-01", "2026-12-31");
  check("de aanroep van 2026 begint met een rij op maandag 29 december 2025", lopend[0].date === "2025-12-29" && lopend[0].conversions === 4);
  const w26 = googleAdsWeeklyByYear(lopend).get(2026) ?? [];
  check("en die valt weg: 361 van de 365 dagen in de weekrecords van 2026", w26.reduce((s, w) => s + w.conversions, 0) === 361);
}

console.log("googleWeekVensters (lib/api/google-weekvensters.ts)");
type Vensters = { historie: { van: string; tot: string }; lopend: { van: string; tot: string } };
const googleWeekVensters = (vensters as { googleWeekVensters?: (huidig: number, eerste: number) => Vensters }).googleWeekVensters;
check("googleWeekVensters bestaat", typeof googleWeekVensters === "function");
if (googleWeekVensters) {
  const v = googleWeekVensters(2026, 2021);
  check("de grens ligt op de eerste maandag van 2026 (5 januari)", v.lopend.van === "2026-01-05" && v.historie.tot === "2026-01-04", JSON.stringify(v));
  check("geen dag tussen de twee aanroepen in, en geen dag dubbel", addDays(v.historie.tot, 1) === v.lopend.van);
  check("de historie begint op de eerste maandag van 2021 (4 januari)", v.historie.van === "2021-01-04", v.historie.van);
  check("het lopende jaar loopt t/m 31 december", v.lopend.tot === "2026-12-31", v.lopend.tot);
  const maandagJaar = googleWeekVensters(2024, 2019);
  check("valt 1 januari op een maandag (2024), dan blijft de grens 1 januari", maandagJaar.lopend.van === "2024-01-01" && maandagJaar.historie.tot === "2023-12-31",
    JSON.stringify(maandagJaar));

  const historie = apiWeken(v.historie.van, v.historie.tot);
  const lopend = apiWeken(v.lopend.van, v.lopend.tot);
  const perJaarHist = googleAdsWeeklyByYear(historie);
  const perJaarLopend = googleAdsWeeklyByYear(lopend);
  check("de aanroep van 2026 heeft alleen rijen van 2026: er valt niets weg", [...perJaarLopend.keys()].join(",") === "2026", [...perJaarLopend.keys()].join(","));
  check("de historie heeft alleen rijen van 2021 t/m 2025", [...perJaarHist.keys()].join(",") === "2021,2022,2023,2024,2025", [...perJaarHist.keys()].join(","));
  const dec25 = (perJaarHist.get(2025) ?? []).filter((w) => w.month === 12).map((w) => `${w.week}:${w.conversions}`).join(",");
  check("december 2025 heeft vijf hele weken, net als december 2024 midden in de historie", dec25 === "1:7,2:7,3:7,4:7,5:7", dec25);
  const dec24 = (perJaarHist.get(2024) ?? []).filter((w) => w.month === 12).map((w) => `${w.week}:${w.conversions}`).join(",");
  check("december 2024 ter vergelijking", dec24 === "1:7,2:7,3:7,4:7,5:7", dec24);
  check("elke historische weekrij is een hele week", historie.every((r) => r.conversions === 7));
  // Wat de route houdt: de historische jaren 2021-2025 en het lopende jaar 2026. Samen precies
  // elke dag van het eerste tot het laatste gevraagde, één keer.
  const gehouden = [2021, 2022, 2023, 2024, 2025].reduce((s, j) => s + (perJaarHist.get(j) ?? []).reduce((t, w) => t + w.conversions, 0), 0)
    + (perJaarLopend.get(2026) ?? []).reduce((s, w) => s + w.conversions, 0);
  check("elke gevraagde dag staat in precies één weekrecord dat de route houdt", gehouden === dagenTussen(v.historie.van, v.lopend.tot),
    `${gehouden} tegen ${dagenTussen(v.historie.van, v.lopend.tot)}`);
}

// ── De bedrading: de route vraagt de weken op deze grenzen ─────────────────────────────────────
console.log("De bedrading (app/api/google-ads/client-data/route.ts)");
{
  const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const route = zonderCommentaar(readFileSync(join(import.meta.dirname, "..", "..", "app/api/google-ads/client-data/route.ts"), "utf8"));
  check("de route haalt de grenzen uit googleWeekVensters", /googleWeekVensters\(currentYear,\s*firstHistoricalYear\)/.test(route));
  const weekAanroepen = route.match(/getAccountMetricsByWeek\([^)]*\)/g) ?? [];
  check("twee weekaanroepen", weekAanroepen.length === 2, String(weekAanroepen.length));
  check("de historie op weekVensters.historie, het lopende jaar op weekVensters.lopend",
    /weekVensters\.historie\.van,\s*weekVensters\.historie\.tot/.test(weekAanroepen[0] ?? "") && /weekVensters\.lopend\.van,\s*weekVensters\.lopend\.tot/.test(weekAanroepen[1] ?? ""),
    weekAanroepen.join(" | "));
}

// ── De sync: ads_account_weekly begint op een maandag ─────────────────────────────────────────
console.log("De sync (lib/sync/orchestrator.ts)");
{
  // Dezelfde soort fout, in de sync: die vroeg de weken vanaf getDateRange13Months().startDate, de
  // 1e van een maand. Op een december-run is dat woensdag 1 oktober 2025; Google geeft die week
  // terug onder maandag 29 september, met alleen 1-5 oktober erin, en de upsert op
  // (client_id, week_start) overschreef zo bij elke run een hele week met een afgekapte.
  const vanaf = (vensters as { maandagVanWeek?: (dag: string) => string }).maandagVanWeek;
  check("google-weekvensters.ts exporteert maandagVanWeek", typeof vanaf === "function");
  if (typeof vanaf === "function") {
    check("woensdag 1 oktober 2025: maandag 29 september", vanaf("2025-10-01") === "2025-09-29", vanaf("2025-10-01"));
    check("een maandag blijft staan (1 september 2025)", vanaf("2025-09-01") === "2025-09-01", vanaf("2025-09-01"));
    check("zondag 1 februari 2026: maandag 26 januari", vanaf("2026-02-01") === "2026-01-26", vanaf("2026-02-01"));
    check("over de jaargrens (donderdag 1 januari 2026)", vanaf("2026-01-01") === "2025-12-29", vanaf("2026-01-01"));
    // Met de nabootsing: de eerste weekrij is de hele week waarin het venster begint, dus de upsert
    // overschrijft geen eerder geschreven hele week met een stuk, en er valt geen dag weg.
    const rijen = apiWeken(vanaf("2025-10-01"), "2025-12-31");
    check("de eerste weekrij is de hele week van 1 oktober", rijen[0]?.date === "2025-09-29" && rijen[0].conversions === 7, JSON.stringify(rijen[0]));
  }
  const orch = readFileSync(join(import.meta.dirname, "..", "sync", "orchestrator.ts"), "utf8");
  // Met convActionIds als vijfde argument: de weekvraag draagt dezelfde conversieselectie als de
  // maandvraag (gedrag: lib/sync/__weeksync_conversieselectie_test.ts).
  check("de sync vraagt de weken vanaf maandagVanWeek(startDate)",
    /getAccountMetricsByWeek\(credentials,\s*customerId,\s*maandagVanWeek\(startDate\),\s*endDate,\s*convActionIds\)/.test(orch));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
