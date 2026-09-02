// Test voor de Display-scorecard (masterplan sectie 5.4). Deterministisch, geen IO.
// Draaien: npx tsx lib/__display_scorecard_test.ts

import { computeDisplayScorecard, type DisplayCampaignMonthlyRow, type DisplayAudienceRow } from "./display-scorecard";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rij(o: Partial<DisplayCampaignMonthlyRow> & { month: string }): DisplayCampaignMonthlyRow {
  return { campaign_name: "GRN | Display | Canada", cost: 1000, conversions: 10, clicks: 500, impressions: 100000, ...o };
}

console.log("Randgeval: geen data");
{
  const out = computeDisplayScorecard([], []);
  check("alle vijf factoren onbeoordeeld", out.factors.every((f) => !f.assessed));
  check("grade is ? (geen basis)", out.grade === "?");
}

console.log("\nViewability is altijd onbeoordeeld, ongeacht de rest van de data");
{
  const rows: DisplayCampaignMonthlyRow[] = [
    rij({ month: "2026-02-01", cost: 1000, conversions: 10 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 12 }),
  ];
  const out = computeDisplayScorecard(rows, []);
  check("Viewability niet beoordeeld", !out.factors.find((f) => f.name === "Viewability")!.assessed);
  check("Viewability score is 0, niet gegokt", out.factors.find((f) => f.name === "Viewability")!.score === 0);
}

console.log("\nSterk account: dalende CPA/CPM, stijgende CTR");
{
  // CPM = cost/impressions -- bij gelijke cost daalt CPM als impressions STIJGEN, niet dalen.
  const rows: DisplayCampaignMonthlyRow[] = [
    rij({ month: "2026-01-01", cost: 1000, conversions: 8, clicks: 320, impressions: 80000 }),
    rij({ month: "2026-02-01", cost: 1000, conversions: 10, clicks: 450, impressions: 100000 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 15, clicks: 650, impressions: 130000 }), // CPA/CPM dalen, CTR stijgt
  ];
  const out = computeDisplayScorecard(rows, []);
  check("Conversion Efficiency hoog (CPA daalt)", out.factors.find((f) => f.name === "Conversion Efficiency")!.score >= 16);
  check("Engagement-trend hoog (CTR stijgt)", out.factors.find((f) => f.name === "Engagement-trend")!.score >= 14);
  check("CPM-trend hoog (CPM daalt)", out.factors.find((f) => f.name === "CPM-trend")!.score >= 16);
}

console.log("\nZwak account: stijgende CPA/CPM, dalende CTR");
{
  const rows: DisplayCampaignMonthlyRow[] = [
    rij({ month: "2026-01-01", cost: 1000, conversions: 20, clicks: 800, impressions: 80000 }),
    rij({ month: "2026-02-01", cost: 1000, conversions: 14, clicks: 600, impressions: 90000 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 8, clicks: 350, impressions: 110000 }), // CPA/CPM stijgen, CTR daalt
  ];
  const out = computeDisplayScorecard(rows, []);
  check("Conversion Efficiency laag (CPA stijgt fors)", out.factors.find((f) => f.name === "Conversion Efficiency")!.score <= 4);
  check("Engagement-trend laag (CTR daalt fors)", out.factors.find((f) => f.name === "Engagement-trend")!.score <= 8);
}

console.log("\nDoelgroep-mix: een segment ver onder het gemiddelde wordt herkend");
{
  const audience: DisplayAudienceRow[] = [
    { audience_type: "IN_MARKET", cost: 4000, conversions: 40, conversions_value: 16000 }, // ROAS 4
    { audience_type: "AFFINITY", cost: 4000, conversions: 40, conversions_value: 16000 },  // ROAS 4
    { audience_type: "REMARKETING", cost: 4000, conversions: 4, conversions_value: 1600 }, // ROAS 0.4 -- ver onder de helft van het gemiddelde, 33% van de spend
  ];
  const out = computeDisplayScorecard([], audience);
  const factor = out.factors.find((f) => f.name === "Doelgroep-mix")!;
  check("doelgroepdata wordt beoordeeld", factor.assessed);
  check("het zwakke segment wordt genoemd", factor.description.includes("REMARKETING"), factor.description);
  check("score laag door het dure segment", factor.score <= 8, `${factor.score}`);
}

console.log("\nLead-gen (conversiewaarde overal 0): beoordeeld op conversies per euro, geen gratis 20/20");
{
  // Het vals-groen-gat uit de sloop-audit: zonder conversiewaarde was elke segment-ROAS 0 en
  // kon geen segment ooit "duur" zijn — gegarandeerd 20/20. Met conversies als basis moet het
  // niet-converterende segment gewoon herkend worden.
  const audience: DisplayAudienceRow[] = [
    { audience_type: "IN_MARKET", cost: 4000, conversions: 40, conversions_value: 0 },
    { audience_type: "AFFINITY", cost: 4000, conversions: 40, conversions_value: 0 },
    { audience_type: "REMARKETING", cost: 4000, conversions: 0, conversions_value: 0 }, // 33% van de spend, nul conversies
  ];
  const out = computeDisplayScorecard([], audience);
  const factor = out.factors.find((f) => f.name === "Doelgroep-mix")!;
  check("wordt beoordeeld (er zijn conversies)", factor.assessed);
  check("NIET de volle 20 punten", factor.score < 20, `${factor.score}`);
  check("het niet-converterende segment wordt genoemd", factor.description.includes("REMARKETING"), factor.description);
  check("de tekst zegt dat er op conversies is beoordeeld", factor.description.includes("conversies per euro"), factor.description);
  check("score laag door het dure segment (33% spend)", factor.score <= 8, `${factor.score}`);
}

console.log("\nLead-gen zonder énige conversie: geen basis, dus onbeoordeeld — niet 20/20");
{
  const audience: DisplayAudienceRow[] = [
    { audience_type: "IN_MARKET", cost: 4000, conversions: 0, conversions_value: 0 },
    { audience_type: "AFFINITY", cost: 2000, conversions: 0, conversions_value: 0 },
  ];
  const out = computeDisplayScorecard([], audience);
  const factor = out.factors.find((f) => f.name === "Doelgroep-mix")!;
  check("niet beoordeeld zonder conversiebasis", !factor.assessed);
  check("score is 0, niet gegokt", factor.score === 0, `${factor.score}`);
  check("de tekst legt uit waarom", factor.description.includes("geen conversies of conversiewaarde"), factor.description);
}

console.log("\nGeen doelgroepdata: Doelgroep-mix blijft eerlijk onbeoordeeld, de rest niet");
{
  const rows: DisplayCampaignMonthlyRow[] = [
    rij({ month: "2026-02-01", cost: 1000, conversions: 10 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 12 }),
  ];
  const out = computeDisplayScorecard(rows, []);
  check("Doelgroep-mix niet beoordeeld", !out.factors.find((f) => f.name === "Doelgroep-mix")!.assessed);
  check("assessedCount is 3 (vijf min Doelgroep-mix en Viewability)", out.assessedCount === 3, `${out.assessedCount}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
