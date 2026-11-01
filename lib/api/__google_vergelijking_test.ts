// De yoy-percentages van het portfolio-scorebord (/api/google-ads/overview): gepaard, zoals het
// klantdashboard. Draaien: npx tsx lib/api/__google_vergelijking_test.ts
//
// Waarom: de route zette som tegen som. Een account dat in juni vorig jaar begon, kreeg op "dit
// jaar t/m juni" groei over januari t/m mei, maanden waarin het vorig jaar nog niet bestond. Het
// dashboard paart per maand (gepaardeTotalen); het scorebord gebruikt nu dezelfde functie, met de
// historie erbij voor de start.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { googleMaandReeks, jaarOpJaar, HISTORIE_JAREN } from "./google-vergelijking";
import type { GoogleAdsMetrics } from "./google-ads";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const rij = (date: string, conversions: number, cost: number, conversionsValue = conversions * 50): GoogleAdsMetrics => ({
  date, impressions: 0, clicks: 0, cost, conversions, conversionsValue, ctr: 0, avgCpc: 0, costPerConversion: 0, conversionRate: 0,
});
const reeks = (van: string, tot: string, conv: number, kosten: number): GoogleAdsMetrics[] => {
  const out: GoogleAdsMetrics[] = [];
  let [j, m] = van.split("-").map(Number);
  const [tj, tm] = tot.split("-").map(Number);
  while (j < tj || (j === tj && m <= tm)) {
    out.push(rij(`${j}-${String(m).padStart(2, "0")}-01`, conv, kosten));
    m += 1; if (m > 12) { m = 1; j += 1; }
  }
  return out;
};
/** De oude berekening van de route: som van de periode tegen som van de vergelijking. */
const somTegenSom = (h: number, v: number) => (v > 0 ? parseFloat((((h - v) / v) * 100).toFixed(1)) : null);

const DIT_JAAR = { start: "2026-01", end: "2026-06" };
const VORIG_JAAR = { start: "2025-01", end: "2025-06" };

console.log("Een account dat halverwege de vergelijkingsperiode begon");
{
  // Vanaf juni 2025 elke maand 100 conversies en €1.000.
  const rijen = reeks("2025-06", "2026-06", 100, 1_000);
  const yoy = jaarOpJaar(googleMaandReeks("google", rijen), DIT_JAAR, VORIG_JAAR);
  check("de oude som-tegen-som gaf +500%", somTegenSom(600, 100) === 500);
  check("gepaard: alleen juni tegen juni, 0%", yoy.convChange === 0 && yoy.spendChange === 0 && yoy.revChange === 0, JSON.stringify(yoy));
}

console.log("Een account met volledige historie: niets verandert");
{
  const rijen = [...reeks("2024-01", "2025-12", 80, 800), ...reeks("2026-01", "2026-06", 100, 900)];
  const yoy = jaarOpJaar(googleMaandReeks("google", rijen), DIT_JAAR, VORIG_JAAR);
  check("conversies +25% (600 tegen 480)", yoy.convChange === somTegenSom(600, 480) && yoy.convChange === 25, JSON.stringify(yoy));
  check("kosten +12,5%", yoy.spendChange === 12.5, JSON.stringify(yoy));
}

console.log("Een seizoensaccount dat in januari vorig jaar stillag");
{
  // Liep al in 2024, lag in januari en februari 2025 stil, en draait dit jaar wel in januari.
  // Met de historie erbij is dat een pauze (echt nul) en geen account dat nog niet bestond.
  const rijen = [...reeks("2024-03", "2024-10", 50, 500), ...reeks("2025-03", "2025-06", 100, 1_000), ...reeks("2026-01", "2026-06", 100, 1_000)];
  const met = jaarOpJaar(googleMaandReeks("google", rijen), DIT_JAAR, VORIG_JAAR);
  check("met historie telt de pauze mee: +50% (600 tegen 400)", met.convChange === 50, JSON.stringify(met));
  const zonder = jaarOpJaar(googleMaandReeks("google", rijen.filter((r) => r.date >= "2025-01")), DIT_JAAR, VORIG_JAAR);
  check("zonder historie zou de start in maart liggen en januari/februari wegvallen: 0%", zonder.convChange === 0, JSON.stringify(zonder));
}

console.log("Randen");
{
  const leeg = jaarOpJaar(googleMaandReeks("google", reeks("2026-01", "2026-06", 10, 100)), DIT_JAAR, VORIG_JAAR);
  check("geen vergelijkingsdata: null, geen 0 en geen oneindig", leeg.convChange === null && leeg.spendChange === null, JSON.stringify(leeg));
  const r = googleMaandReeks("google", [rij("2026-01-01", 1.4, 10.4, 20.6), rij("2026-01-01", 1.4, 10.4, 20.6), rij("onzin", 5, 5)]);
  check("twee rijen in één maand worden opgeteld, afgerond zoals de adapter", r.maanden.get("2026-01")?.conversions === 2 && r.maanden.get("2026-01")?.adSpend === 20 && r.maanden.get("2026-01")?.revenue === 42,
    JSON.stringify([...r.maanden]));
  check("een rij zonder leesbare datum valt weg", r.maanden.size === 1);
  check("even ver terug als de client-data-route", HISTORIE_JAREN === 5);
}

console.log("De bedrading van de routes");
{
  const root = join(import.meta.dirname, "..", "..");
  const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const overview = zonderCommentaar(readFileSync(join(root, "app/api/google-ads/overview/route.ts"), "utf8"));
  check("overview: yoy via jaarOpJaar", /jaarOpJaar\(/.test(overview) && /^\s*yoy,\s*$/m.test(overview));
  check("overview: geen som-tegen-som meer", !/prevConv\s*>\s*0/.test(overview) && !/prevSpend/.test(overview));
  check("overview: de vergelijking vanaf het historiebegin", /HISTORIE_JAREN/.test(overview) && /`\$\{vanaf\}-01`/.test(overview));
  const clientData = zonderCommentaar(readFileSync(join(root, "app/api/google-ads/client-data/route.ts"), "utf8"));
  check("client-data: dezelfde historie", /HISTORIE_JAREN/.test(clientData) && !/MAX_HISTORY_YEARS\s*=\s*\d/.test(clientData));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
