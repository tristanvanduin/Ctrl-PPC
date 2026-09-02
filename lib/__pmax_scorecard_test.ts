// Test voor de PMax-scorecard (masterplan sectie 5.4). Deterministisch, geen IO.
// Draaien: npx tsx lib/__pmax_scorecard_test.ts

import { computePmaxScorecard, type PmaxScorecardInput } from "./pmax-scorecard";
import type { AssetRegel } from "./pmax/assetdekking";
import type { NetworkRow } from "./pmax/network-split";
import { lopendeMaandStart } from "./analysis/db-veilig";
import { lastCompleteMonth, addMonths } from "./period/period-range";

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

console.log("\nNetwerkmix zonder énige conversie: onbeoordeeld, geen groen zonder bewijs");
{
  // Het gat uit de sloop-audit: zonder conversies laat findImbalances elke shareGap op null,
  // dus was er nooit een "duur" netwerk en stond er 20/20 met "geen netwerk kost naar
  // verhouding meer dan het oplevert" — een uitspraak zonder enige conversie om tegen af te
  // wegen.
  const networkRows: NetworkRow[] = [
    { networkType: "SEARCH", cost: 500, conversions: 0, conversionsValue: 0, impressions: 20000, clicks: 800 },
    { networkType: "CONTENT", cost: 1500, conversions: 0, conversionsValue: 0, impressions: 90000, clicks: 900 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), networkRows });
  const f = out.factors.find((f) => f.name === "Netwerkmix")!;
  check("Netwerkmix NIET beoordeeld", !f.assessed);
  check("score is 0, geen gratis 20", f.score === 0, String(f.score));
  check("de tekst legt uit waarom", f.description.includes("Geen conversies om netwerken tegen af te wegen"), f.description);
}

console.log("\nPlacement-efficiëntie: Google publiceert dit niet per placement — altijd eerlijk onbeoordeeld");
{
  // Google levert per PMax-placement uitsluitend vertoningen; kosten en conversies bestaan hier
  // niet en ads_pmax_placements is live bovendien leeg. De oude factor rekende een euro-drempel
  // uit over kolommen die altijd nul zijn en las dat als "geen verspilling".
  const zonderRijen = computePmaxScorecard(leegInput());
  const f0 = zonderRijen.factors.find((f) => f.name === "Placement-efficiëntie")!;
  check("0 rijen: niet beoordeeld", !f0.assessed);
  check("0 rijen: de reden noemt dat Google dit niet publiceert", f0.description.includes("publiceert geen kosten of conversies per PMax-placement"), f0.description);

  const metRijen = computePmaxScorecard({
    ...leegInput(),
    placementRows: [
      { placement: "com.casual.match3", impressions: 41000 },
      { placement: "vakblad-tuinbouw.example", impressions: 16800 },
    ],
  });
  const f1 = metRijen.factors.find((f) => f.name === "Placement-efficiëntie")!;
  check("met vertoningsrijen: nog steeds niet beoordeeld", !f1.assessed);
  check("met vertoningsrijen: score blijft 0", f1.score === 0, String(f1.score));
  check("de tekst toont wat er wél zichtbaar is (2 plaatsingen)", f1.description.includes("2 plaatsingen"), f1.description);
  check("en waarom er geen oordeel is", f1.description.includes("publiceert geen kosten of conversies"), f1.description);
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

console.log("\nCannibalisatie: de lopende deelmaand telt niet mee");
{
  // De maanden dynamisch, zodat deze test blijft kloppen ongeacht wanneer hij draait: twee
  // afgesloten maanden met gezonde gezamenlijke groei, plus de lopende deelmaand waarin PMax
  // schijnbaar explodeert en Search instort — zoals elke deelmaand er halverwege uitziet.
  // Vóór de fix was de deelmaand "de laatste maand" en werd dit een hoog-risico-melding.
  const m1 = `${addMonths(lastCompleteMonth(), -1)}-01`;
  const m2 = `${lastCompleteMonth()}-01`;
  const lopend = lopendeMaandStart();
  const campMonthlyRows = [
    { campaign_name: "PMax NL", month: m1, cost: 1000, conversions: 20 },
    { campaign_name: "Search NL", month: m1, cost: 1000, conversions: 40 },
    { campaign_name: "PMax NL", month: m2, cost: 1100, conversions: 24 },
    { campaign_name: "Search NL", month: m2, cost: 1050, conversions: 44 },
    // De deelmaand: zou als "laatste maand" +46% PMax en -89% Search lezen.
    { campaign_name: "PMax NL", month: lopend, cost: 400, conversions: 35 },
    { campaign_name: "Search NL", month: lopend, cost: 100, conversions: 5 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), campMonthlyRows, pmaxCampaignNames: ["PMax NL"] });
  const f = out.factors.find((f) => f.name === "Cannibalisatie met Search/Shopping")!;
  check("beoordeeld op de afgesloten maanden", f.assessed);
  check("geen cannibalisatie-alarm uit de deelmaand", f.score === 20, `${f.score} — ${f.description}`);
}

console.log("\nCannibalisatie: alléén een deelmaand plus één afgesloten maand is te weinig");
{
  // Na het wegfilteren van de deelmaand blijft er één maand over, en één maand is geen
  // vergelijking: onbeoordeeld, geen oordeel uit een halve maand.
  const m2 = `${lastCompleteMonth()}-01`;
  const lopend = lopendeMaandStart();
  const campMonthlyRows = [
    { campaign_name: "PMax NL", month: m2, cost: 1000, conversions: 20 },
    { campaign_name: "Search NL", month: m2, cost: 1000, conversions: 40 },
    { campaign_name: "PMax NL", month: lopend, cost: 400, conversions: 35 },
    { campaign_name: "Search NL", month: lopend, cost: 100, conversions: 5 },
  ];
  const out = computePmaxScorecard({ ...leegInput(), campMonthlyRows, pmaxCampaignNames: ["PMax NL"] });
  const f = out.factors.find((f) => f.name === "Cannibalisatie met Search/Shopping")!;
  check("niet beoordeeld met één afgesloten maand", !f.assessed, f.description);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
