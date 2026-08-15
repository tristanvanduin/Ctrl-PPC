// Test voor de PMax-scorecard (masterplan sectie 5.4). Deterministisch, geen IO.
// Draaien: npx tsx lib/__pmax_scorecard_test.ts

import { computePmaxScorecard, type PmaxScorecardInput } from "./pmax-scorecard";
import type { AssetRegel } from "./pmax/assetdekking";
import type { NetworkRow } from "./pmax/network-split";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function leegInput(): PmaxScorecardInput {
  return { assetRows: [], networkRows: [], placementRows: [], campMonthlyRows: [], pmaxCampaignNames: [] };
}

console.log("Randgeval: geen data");
{
  const out = computePmaxScorecard(leegInput());
  check("Asset Health onbeoordeeld", !out.factors.find((f) => f.name === "Asset Health")!.assessed);
  check("Feed Health ALTIJD onbeoordeeld (geen Merchant Center-sync)", !out.factors.find((f) => f.name === "Feed Health")!.assessed);
  check("Netwerkmix onbeoordeeld", !out.factors.find((f) => f.name === "Netwerkmix")!.assessed);
  check("Placement-efficiëntie onbeoordeeld", !out.factors.find((f) => f.name === "Placement-efficiëntie")!.assessed);
  check("Cannibalisatie onbeoordeeld", !out.factors.find((f) => f.name === "Cannibalisatie met Search/Shopping")!.assessed);
  check("grade is ? (geen basis)", out.grade === "?");
}

console.log("\nFeed Health blijft onbeoordeeld ook als al het andere goed scoort");
{
  const assetRows: AssetRegel[] = [];
  for (let i = 0; i < 3; i++) assetRows.push({ asset_group_name: "Groep A", asset_type: "HEADLINE", performance_label: "GOOD", asset_id: `h${i}`, month: "2026-03-01" });
  for (let i = 0; i < 2; i++) assetRows.push({ asset_group_name: "Groep A", asset_type: "DESCRIPTION", performance_label: "GOOD", asset_id: `d${i}`, month: "2026-03-01" });
  assetRows.push({ asset_group_name: "Groep A", asset_type: "SQUARE_MARKETING_IMAGE", performance_label: "GOOD", asset_id: "sq1", month: "2026-03-01" });
  assetRows.push({ asset_group_name: "Groep A", asset_type: "MARKETING_IMAGE", performance_label: "GOOD", asset_id: "mi1", month: "2026-03-01" });
  assetRows.push({ asset_group_name: "Groep A", asset_type: "LOGO", performance_label: "GOOD", asset_id: "lg1", month: "2026-03-01" });
  assetRows.push({ asset_group_name: "Groep A", asset_type: "LONG_HEADLINE", performance_label: "GOOD", asset_id: "lh1", month: "2026-03-01" });
  assetRows.push({ asset_group_name: "Groep A", asset_type: "YOUTUBE_VIDEO", performance_label: "GOOD", asset_id: "yt1", month: "2026-03-01" });

  const out = computePmaxScorecard({ ...leegInput(), assetRows });
  check("Asset Health hoog (volledige groep)", out.factors.find((f) => f.name === "Asset Health")!.score >= 16);
  check("Feed Health nog steeds onbeoordeeld", !out.factors.find((f) => f.name === "Feed Health")!.assessed);
  check("Feed Health telt niet mee in assessedCount", out.assessedCount === 1);
}

console.log("\nAsset Health: groep met tekorten en zonder video scoort laag");
{
  const assetRows: AssetRegel[] = [
    { asset_group_name: "Groep B", asset_type: "HEADLINE", performance_label: "LOW", asset_id: "h1", month: "2026-03-01" },
  ];
  const out = computePmaxScorecard({ ...leegInput(), assetRows });
  const f = out.factors.find((f) => f.name === "Asset Health")!;
  check("Asset Health beoordeeld", f.assessed);
  check("Asset Health laag (1 groep, 1 tekort)", f.score <= 4, String(f.score));
}

console.log("\nNetwerkmix: Display domineert kosten zonder evenredige conversies");
{
  const networkRows: NetworkRow[] = [
    { networkType: "SEARCH", cost: 200, conversions: 20, conversionsValue: 2000, impressions: 5000, clicks: 300 },
    { networkType: "CONTENT", cost: 1800, conversions: 5, conversionsValue: 200, impressions: 90000, clicks: 900 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), networkRows });
  const f = out.factors.find((f) => f.name === "Netwerkmix")!;
  check("Netwerkmix beoordeeld", f.assessed);
  check("Netwerkmix laag (Display duur)", f.score <= 8, String(f.score));
}

console.log("\nPlacement-efficiëntie: veel spend zonder conversie");
{
  const placementRows = [
    { placement: "app.voorbeeld.nl", cost: 500, conversions: 0, impressions: 40000 },
    { placement: "goed.voorbeeld.nl", cost: 100, conversions: 10, impressions: 5000 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), placementRows });
  const f = out.factors.find((f) => f.name === "Placement-efficiëntie")!;
  check("Placement-efficiëntie beoordeeld", f.assessed);
  check("Placement-efficiëntie laag (83% waste)", f.score <= 8, String(f.score));
}

console.log("\nCannibalisatie: PMax groeit fors terwijl Search/Shopping daalt");
{
  const campMonthlyRows = [
    { campaign_name: "PMax NL", month: "2026-02-01", cost: 1000, conversions: 20 },
    { campaign_name: "Search NL", month: "2026-02-01", cost: 1000, conversions: 40 },
    { campaign_name: "PMax NL", month: "2026-03-01", cost: 1200, conversions: 35 },
    { campaign_name: "Search NL", month: "2026-03-01", cost: 900, conversions: 25 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), campMonthlyRows, pmaxCampaignNames: ["PMax NL"] });
  const f = out.factors.find((f) => f.name === "Cannibalisatie met Search/Shopping")!;
  check("Cannibalisatie beoordeeld", f.assessed);
  check("Cannibalisatie-score laag", f.score <= 10, String(f.score));
}

console.log("\nGeen cannibalisatie: beide kanalen groeien samen");
{
  const campMonthlyRows = [
    { campaign_name: "PMax NL", month: "2026-02-01", cost: 1000, conversions: 20 },
    { campaign_name: "Search NL", month: "2026-02-01", cost: 1000, conversions: 40 },
    { campaign_name: "PMax NL", month: "2026-03-01", cost: 1200, conversions: 24 },
    { campaign_name: "Search NL", month: "2026-03-01", cost: 1100, conversions: 44 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), campMonthlyRows, pmaxCampaignNames: ["PMax NL"] });
  const f = out.factors.find((f) => f.name === "Cannibalisatie met Search/Shopping")!;
  check("Cannibalisatie beoordeeld", f.assessed);
  check("Cannibalisatie-score hoog (geen risico)", f.score === 20, String(f.score));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
