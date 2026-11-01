// De Google-bron van de demoklanten: wat /api/google-ads/client-data voor GreenTech en de clones
// serveert, en dat de route dat ook echt zo doet.
// Draaien: npx tsx lib/demo/__seeded_demo_bron_test.ts
//
// Waarom. GreenTech kreeg een JS-fixture (lib/demo/greentech-mock.ts) terwijl Meta, LinkedIn,
// Microsoft en het Jaaroverzicht uit de database lazen, en de KPI-band telde die twee werelden op.
// De fixture rekende bovendien "gerealiseerd" op de klok: op 1 november t/m oktober, terwijl de
// geseede data op 26 augustus stopt. Nu komt alles uit de database (seededDemoClientData), met de
// datastand uit dezelfde rijen en het synctijdstip.
//
// De rijen hieronder hebben de vorm en de grenzen van de echte seed (gelezen op 1 november 2026):
// ads_account_monthly 2024-09 t/m 2026-08, weken vanaf 2 maart 2026, zes campagnes, impressieaandeel
// voor drie daarvan in juli en augustus, en een geslaagde sync op 26 augustus 06:44 UTC.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeSupabase } from "../decision/__fake_supabase";
import { seededDemoClientData, isSeededDemo } from "./geoclone-demo-data";
import { DEMO_GREENTECH_ID, buildGreentechClientData } from "./greentech-mock";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const CAMPAGNES = [
  { id: "demo-grt-search-nl", naam: "GRT | Search | NL", type: "SEARCH" },
  { id: "demo-grt-performance-max", naam: "GRT | Performance Max", type: "PERFORMANCE_MAX" },
  { id: "demo-gra-search-us", naam: "GRA | Search | US", type: "SEARCH" },
  { id: "demo-grn-search-na", naam: "GRN | Search | NA", type: "SEARCH" },
  { id: "demo-greentech-brand", naam: "GreenTech | Brand", type: "SEARCH" },
  { id: "demo-greentech-display-prospecting", naam: "GreenTech | Display | Prospecting", type: "DISPLAY" },
];

function maanden(van: string, tot: string): string[] {
  const out: string[] = [];
  let [j, m] = van.split("-").map(Number);
  const [tj, tm] = tot.split("-").map(Number);
  while (j < tj || (j === tj && m <= tm)) {
    out.push(`${j}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; j += 1; }
  }
  return out;
}

function geseed(clientId: string, laatsteSync: string | null): FakeSupabase {
  const sb = new FakeSupabase();
  const mnd = maanden("2024-09", "2026-08");
  sb.seed("ads_account_monthly", mnd.map((k, i) => ({
    client_id: clientId, month: `${k}-01`, impressions: 50_000 + i, clicks: 2_500, cost: 10_000 + 50 * i,
    conversions: 100 + i, conversions_value: 20_000 + 100 * i, ctr: 0.05, avg_cpc: 4, conversion_rate: 0.04,
  })));
  const weken: string[] = [];
  for (let d = new Date(Date.UTC(2026, 2, 2)); d <= new Date(Date.UTC(2026, 7, 24)); d.setUTCDate(d.getUTCDate() + 7)) weken.push(d.toISOString().slice(0, 10));
  sb.seed("ads_account_weekly", weken.map((w) => ({ client_id: clientId, week_start: w, impressions: 1, clicks: 1, cost: 2_500, conversions: 25, conversions_value: 5_000 })));
  sb.seed("ads_campaign_monthly", CAMPAGNES.flatMap((c) => maanden("2025-01", "2026-08").map((k) => ({
    client_id: clientId, campaign_id: c.id, campaign_name: c.naam, campaign_type: c.type, campaign_status: "ENABLED", month: `${k}-01`,
    impressions: 1_000, clicks: 100, cost: 1_000, conversions: 10, conversions_value: 2_000, ctr: 0.1, avg_cpc: 10, conversion_rate: 0.1,
  }))));
  sb.seed("ads_campaign_impression_share", ["2026-07-01", "2026-08-01"].flatMap((month, i) => CAMPAGNES.slice(0, 3).map((c) => ({
    client_id: clientId, campaign_id: c.id, campaign_name: c.naam, campaign_type: c.type, month,
    cost: 4_200 + i, conversions: 26, search_impression_share: 0.55 + i / 100, search_budget_lost_is: 0.28,
    search_rank_lost_is: 0.05, daily_budget: 140, budget_utilization: 0.973,
  }))));
  if (laatsteSync) sb.seed("client_sync_status", [{ client_id: clientId, last_successful_sync_at: laatsteSync }]);
  // Rijen van een andere klant mogen nergens meetellen.
  sb.seed("ads_account_monthly", [{ client_id: "iemand-anders", month: "2026-10-01", cost: 999_999, conversions: 999, conversions_value: 0, impressions: 0, clicks: 0, ctr: 0, avg_cpc: 0, conversion_rate: 0 }]);
  return sb;
}

async function main() {
  console.log("isSeededDemo: GreenTech en de drie clones, verder niemand");
  {
    check("demo-greentech", isSeededDemo("demo-greentech"));
    check("met gads-prefix", isSeededDemo("gads-demo-greentech"));
    check("de clones", ["demo-grt", "demo-gra", "demo-grn"].every((id) => isSeededDemo(id)));
    check("een echte klant niet", !isSeededDemo("8375102493") && !isSeededDemo("gads-8375102493"));
    check("leeg niet", !isSeededDemo(null) && !isSeededDemo(undefined) && !isSeededDemo(""));
  }

  console.log("GreenTech uit de database");
  const api = await seededDemoClientData(geseed(DEMO_GREENTECH_ID, "2026-08-26T06:44:34.346+00:00") as never, DEMO_GREENTECH_ID);
  {
    check("het lopende jaar is het jaar van de nieuwste rij", api.currentYear === 2026, String(api.currentYear));
    // De fixture zei hier op 1 november 10, de kalender 8: augustus loopt maar t/m de 25e.
    check("gerealiseerd t/m juli", api.realizedThroughMonth === 7, String(api.realizedThroughMonth));
    check("de datastand: juli vol, augustus t/m 25 van 31",
      api.dataStand?.laatsteVolleMaand === "2026-07" && api.dataStand?.partieel?.maand === "2026-08"
        && api.dataStand?.partieel?.tmDag === 25 && api.dataStand?.dataTot === "2026-08-25" && api.dataStand?.uitgesloten.length === 0,
      JSON.stringify(api.dataStand));
    check("de maandreeks is die van de database", api.currentYearMonthly.length === 8 && api.currentYearMonthly[0].adSpend === 10_000 + 50 * 16,
      JSON.stringify(api.currentYearMonthly[0]));
    check("geen maand van een andere klant", !api.currentYearMonthly.some((m) => m.month === 10));
    check("historie 2024 en 2025 uit de database", api.historicalYears.map((y) => y.year).join(",") === "2024,2025"
      && api.historicalYears[0].monthly.length === 4, api.historicalYears.map((y) => `${y.year}:${y.monthly.length}`).join(","));
    const namen = new Set(api.campaigns.map((c) => c.campaignName));
    check("de zes campagnes uit de database", namen.size === 6 && namen.has("GRN | Search | NA"), [...namen].join(" / "));
    check("geen campagne uit de fixture", !namen.has("GRN | Search | Canada"));
    const fixture = buildGreentechClientData(DEMO_GREENTECH_ID);
    check("de conversieacties komen uit de fixture (de seed heeft ze niet)",
      JSON.stringify(api.conversionActions) === JSON.stringify(fixture.conversionActions) && api.conversionActions.length > 0);
    check("de verspilde zoektermen ook", JSON.stringify(api.wastefulSearchTerms) === JSON.stringify(fixture.wastefulSearchTerms));
    check("het impressieaandeel uit de database: de nieuwste maand per campagne",
      api.impressionShare.length === 3 && api.impressionShare.every((r) => r.cost === 4_201 && r.searchImpressionShare === 0.56 && r.budgetUtilization === 0.97),
      JSON.stringify(api.impressionShare));
    check("met de campagnenamen van de database",
      api.impressionShare.map((r) => r.campaignName).sort().join(" / ") === "GRA | Search | US / GRT | Performance Max / GRT | Search | NL");
    const typen = new Map(api.accountStructure.campaigns.map((c) => [c.name, c.type]));
    check("het campagnetype uit de database in plaats van overal SEARCH",
      typen.get("GRT | Performance Max") === "PERFORMANCE_MAX" && typen.get("GreenTech | Display | Prospecting") === "DISPLAY", JSON.stringify([...typen]));
    check("de weekreeks valt in het lopende jaar", api.currentYearWeekly.length > 0 && api.currentYearWeekly.every((w) => w.month >= 3 && w.month <= 8));
  }

  console.log("Een clone: dezelfde bron, zonder fixturevelden");
  {
    const clone = await seededDemoClientData(geseed("demo-grt", "2026-08-19T16:28:23.089+00:00") as never, "demo-grt");
    check("de stand komt uit zijn eigen sync", clone.dataStand?.dataTot === "2026-08-18" && clone.realizedThroughMonth === 7, JSON.stringify(clone.dataStand));
    check("geen conversieacties of zoektermen uit de GreenTech-fixture", clone.conversionActions.length === 0 && clone.wastefulSearchTerms.length === 0);
  }

  console.log("Zonder synctijdstip");
  {
    const zonder = await seededDemoClientData(geseed(DEMO_GREENTECH_ID, null) as never, DEMO_GREENTECH_ID);
    check("de maand van de nieuwste rij telt als vol (de oude aanname, alleen als terugval)",
      zonder.dataStand?.laatsteVolleMaand === "2026-08" && zonder.realizedThroughMonth === 8, JSON.stringify(zonder.dataStand));
  }

  console.log("Een leesfout is een fout, geen lege klant");
  {
    for (const tabel of ["ads_account_monthly", "client_sync_status", "ads_campaign_impression_share"]) {
      const kapot = geseed(DEMO_GREENTECH_ID, "2026-08-26T06:44:34Z");
      kapot.faalOp(tabel, "permission denied");
      let fout: unknown = null;
      try { await seededDemoClientData(kapot as never, DEMO_GREENTECH_ID); } catch (e) { fout = e; }
      check(`${tabel} faalt: seededDemoClientData gooit`, fout instanceof Error && fout.message.includes("permission denied"), String(fout));
    }
  }

  // ── De bedrading: de route, de hook en het portfolio gebruiken dit echt ──
  // Brongaranties, geen gedragstest: de route draait niet zonder Next en Google Ads. Ze vangen het
  // terugzetten van precies de regels die hier gerepareerd zijn.
  console.log("De bedrading");
  {
    const root = join(import.meta.dirname, "..", "..");
    const lees = (p: string) => readFileSync(join(root, p), "utf8");
    const zonderCommentaar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const route = zonderCommentaar(lees("app/api/google-ads/client-data/route.ts"));
    check("route: demoklanten via seededDemoClientData", /isSeededDemo\(/.test(route) && /seededDemoClientData\(/.test(route));
    check("route: geen GreenTech-fixture meer", !/buildGreentechClientData\s*\(/.test(route));
    check("route: de conversieselectie komt niet meer uit de browser", !/conversionActionIds/.test(route));
    check("route: maar uit client_settings via dashboardConversionActionIds",
      /from\("client_settings"\)/.test(route) && /dashboardConversionActionIds\(/.test(route));
    check("route: het filter gaat ook naar de campagnecijfers",
      (route.match(/getCampaignMetricsByMonth\([^)]*convActionIds\)/g) ?? []).length === 2);
    check("route: weken per jaar via googleAdsWeeklyByYear, niet op index",
      (route.match(/googleAdsWeeklyByYear\(/g) ?? []).length === 2 && !/allHistoricalWeekly\[i\]/.test(route) && !/googleAdsWeeklyToApiData\(/.test(route));
    check("route: geen klokmaand van de server", !/getMonth\(\)/.test(route) && !/getFullYear\(\)/.test(route));
    check("route: de datastand gaat mee in het antwoord", /liveDataStand\(\)/.test(route) && /^\s*dataStand,\s*$/m.test(route));

    const hook = zonderCommentaar(lees("lib/use-client-data.ts"));
    check("hook: geen localStorage-kopie van de conversieselectie meer", !/localStorage/.test(hook) && !/conversionActionIds/.test(hook));
    check("hook: zet de datastand op de data", /dataStand:\s*apiData\.dataStand/.test(hook));
    check("hook: de cache blijft op clientId", /cache\.set\(clientId,/.test(hook) && /cache\.get\(clientId\)/.test(hook));

    const portfolio = zonderCommentaar(lees("components/portfolio/portfolio-scoreboard.tsx"));
    check("portfolio: de demo-cel via dezelfde route, niet via de fixture",
      !/buildGreentechClientData/.test(portfolio) && /\/api\/google-ads\/client-data\?customerId=\$\{DEMO_GREENTECH_ID\}/.test(portfolio));
    // Op het kalendervenster telden september en oktober als nulmaanden: -31% in plaats van de -7%
    // die het dashboard van de demo laat zien.
    check("portfolio: de demo-cel op het venster van zijn eigen datastand, met een regel die dat zegt",
      /vensterEindMaand\(stand\?\.laatsteVolleMaand\)/.test(portfolio) && /<NaamCel sub=\{overview\?\.periodeNoot\}>/.test(portfolio));
  }

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
