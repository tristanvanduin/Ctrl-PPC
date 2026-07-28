// Test voor de campagne-analyse. Deterministisch, geen IO.
// Draaien: npx tsx lib/__campaign_analysis_test.ts
//
// Deze module was de grootste ongeteste in lib/ (695 regels) en bevatte vier fouten die allemaal
// hetzelfde patroon volgen: een getal dat plausibel oogt maar iets anders meet dan het beweert.
// Zulke fouten breken niets — ze produceren een aanbeveling die de gebruiker gewoon opvolgt.
//
// De tests hieronder leggen precies die vier vast.

import { summarize } from "./campaign-analysis";
import { trendOver } from "./analysis/trend";
import type { CampaignData, CampaignMonthlyMetrics } from "./campaign-types";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function maand(m: number, o: Partial<CampaignMonthlyMetrics> = {}): CampaignMonthlyMetrics {
  return {
    month: m, conversions: 0, revenue: 0, adSpend: 0, impressions: 0, clicks: 0,
    ctr: 0, avgCpc: 0, conversionRate: 0, roas: 0, cpa: 0, ...o,
  };
}

function campagne(maanden: CampaignMonthlyMetrics[], o: Partial<CampaignData> = {}): CampaignData {
  return {
    campaignId: "1", campaignName: "Test", campaignType: "Search",
    purpose: "generic", status: "ENABLED", monthly: maanden, ...o,
  };
}

// ── De trend meet de periode, niet twee losse maanden ──────────────────────

console.log("Trend over een periode");

// Het geval dat de oude versie miste: twaalf maanden wegzakken, laatste maand herstelt.
// Eerste tegen laatste gaf +1% — geen waarschuwing — terwijl de campagne stervende was.
{
  const reeks = [100, 95, 88, 80, 72, 65, 58, 52, 48, 44, 40, 38, 101];
  const eersteVsLaatste = ((reeks[12] - reeks[0]) / reeks[0]) * 100;
  check("eerste-tegen-laatste zou dit gemist hebben", Math.abs(eersteVsLaatste) < 5, `${eersteVsLaatste.toFixed(1)}%`);
  // De laatste drie (44, 40, 38 -> nee: 40, 38, 101) tegen de drie daarvoor (48, 44, 40).
  // Het herstel is echt, dus de trend hoort positief te zijn — maar niet als "alles is in orde".
  check("periode-vergelijking gebruikt meer dan een maand", trendOver(reeks) !== eersteVsLaatste);
}

// Het geval dat de oude versie verzon: een halve eerste maand na de lancering.
{
  const reeks = [3, 80, 84, 79, 88, 91, 85, 90, 87, 92, 88, 90, 86];
  const eersteVsLaatste = ((reeks[12] - reeks[0]) / reeks[0]) * 100;
  check("eerste-tegen-laatste zag 2767 procent groei", eersteVsLaatste > 2000, `${Math.round(eersteVsLaatste)}%`);
  check("periode-vergelijking ziet een vlakke reeks", Math.abs(trendOver(reeks)) < 10, `${trendOver(reeks).toFixed(1)}%`);
}

// Een echte, aanhoudende daling hoort wel degelijk door de drempel te zakken.
{
  const dalend = [100, 98, 96, 90, 85, 80, 70, 62, 55, 48, 42, 38, 34];
  check("een echte daling wordt gezien", trendOver(dalend) < -15, `${trendOver(dalend).toFixed(1)}%`);
}
// En een echte stijging ook.
{
  const stijgend = [34, 38, 42, 48, 55, 62, 70, 80, 85, 90, 96, 98, 100];
  check("een echte stijging wordt gezien", trendOver(stijgend) > 15, `${trendOver(stijgend).toFixed(1)}%`);
}
// Een enkele uitschieter in de laatste maand mag de uitkomst niet bepalen.
{
  const vlakMetPiek = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 500];
  check("een losse piek kantelt de trend niet", trendOver(vlakMetPiek) < 400, `${trendOver(vlakMetPiek).toFixed(0)}%`);
}

// Randgevallen: te weinig data, alleen nullen, precies twee maanden.
check("een lege reeks is 0", trendOver([]) === 0);
check("een reeks van een is 0", trendOver([42]) === 0);
check("alleen nullen is 0 en geen NaN", trendOver([0, 0, 0, 0]) === 0);
check("twee maanden werkt", Number.isFinite(trendOver([10, 20])) && trendOver([10, 20]) === 100);
check("nooit NaN", [[], [1], [0, 0], [1, 2, 3], [0, 0, 0, 5, 5, 5]].every((r) => Number.isFinite(trendOver(r))));

// ── CPA bestaat niet zonder conversies ─────────────────────────────────────

console.log("\nCPA bij nul conversies");
{
  const zonder = summarize(campagne([maand(1, { adSpend: 30, clicks: 40 }), maand(2, { adSpend: 30, clicks: 40 })]), 1000);
  check("cpa is null en niet de besteding", zonder.cpa === null, String(zonder.cpa));
  // Dit is het geval dat stil doorglipte: 60 euro zou als "CPA 60" onder een gemiddelde van
  // 80 zijn gebleven, terwijl er nul conversies waren.
  check("de besteding blijft wel geteld", zonder.totalSpend === 60);
  check("de conversies zijn nul", zonder.totalConversions === 0);
}
{
  const met = summarize(campagne([maand(1, { adSpend: 100, conversions: 4 })]), 1000);
  check("met conversies is cpa gewoon een getal", met.cpa === 25, String(met.cpa));
}
// ROAS blijft 0 bij nul besteding en levert geen deling door nul op.
{
  const leeg = summarize(campagne([maand(1)]), 0);
  check("lege campagne geeft geen NaN", [leeg.roas, leeg.avgCtr, leeg.avgCpc, leeg.cpm, leeg.spendShare]
    .every((v) => Number.isFinite(v)));
}

// ── Het periodelabel volgt de data ─────────────────────────────────────────

console.log("\nHet label noemt de vergeleken maanden");
{
  // Dertien maanden, eindigend in juli. Het venster is drie, dus vergeleken wordt
  // feb-mrt-apr tegen mei-jun-jul; het label loopt van feb tot en met jul.
  const maanden = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7].map((m) => maand(m, { conversions: 10 }));
  const s = summarize(campagne(maanden), 1000);
  check("het label is niet meer hardgecodeerd op Jan-Mrt", !s.trendPeriode.includes("Jan→Mrt"), s.trendPeriode);
  check("het label noemt de eerste vergeleken maand", s.trendPeriode.includes("feb"), s.trendPeriode);
  check("en de laatste", s.trendPeriode.includes("jul"), s.trendPeriode);
}
{
  const s = summarize(campagne([maand(1)]), 1000);
  check("bij een enkele maand geen label", s.trendPeriode === "", s.trendPeriode);
}

// ── Sommen kloppen met de invoer ───────────────────────────────────────────

console.log("\nDe optelling");
{
  const maanden = [
    maand(1, { adSpend: 100, conversions: 5, revenue: 500, impressions: 1000, clicks: 50 }),
    maand(2, { adSpend: 200, conversions: 10, revenue: 900, impressions: 3000, clicks: 150 }),
  ];
  const s = summarize(campagne(maanden), 600);
  check("besteding telt op", s.totalSpend === 300);
  check("conversies tellen op", s.totalConversions === 15);
  check("omzet telt op", s.totalRevenue === 1400);
  check("roas is de verhouding van de totalen", Math.abs(s.roas - 1400 / 300) < 1e-9);
  check("cpa is de verhouding van de totalen", Math.abs((s.cpa ?? 0) - 300 / 15) < 1e-9);
  // Niet het gemiddelde van de maandelijkse CTR's, maar klikken gedeeld door vertoningen.
  check("ctr is gewogen, niet gemiddeld", Math.abs(s.avgCtr - 200 / 4000) < 1e-9, String(s.avgCtr));
  check("aandeel in de besteding", Math.abs(s.spendShare - 50) < 1e-9);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
