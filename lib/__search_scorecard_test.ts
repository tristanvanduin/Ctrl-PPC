// Test voor de Search-scorecard (masterplan sectie 5.4). Deterministisch, geen IO.
// Draaien: npx tsx lib/__search_scorecard_test.ts

import { computeSearchScorecard, type SearchImpressionShareRow } from "./search-scorecard";
import type { KeywordQsRow } from "./analysis/metric-cross-checks";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rij(o: Partial<SearchImpressionShareRow> & { month: string }): SearchImpressionShareRow {
  return {
    campaignId: "c1", cost: 1000, conversions: 20, clicks: 500, impressions: 5000,
    searchImpressionShare: 0.7, searchBudgetLostIS: 0.1, searchRankLostIS: 0.1,
    ...o,
  };
}

console.log("Randgeval: geen data");
{
  const out = computeSearchScorecard([], []);
  check("alle vijf factoren onbeoordeeld", out.factors.every((f) => !f.assessed));
  check("grade is ? (geen basis)", out.grade === "?");
}

console.log("\nSterk account: hoge IS, goede QS, verbeterende trends");
{
  const rows: SearchImpressionShareRow[] = [
    rij({ month: "2026-01-01", cost: 1000, conversions: 15, clicks: 400, impressions: 5000, searchImpressionShare: 0.75 }),
    rij({ month: "2026-02-01", cost: 1000, conversions: 18, clicks: 450, impressions: 5000, searchImpressionShare: 0.80 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 25, clicks: 550, impressions: 5000, searchImpressionShare: 0.85 }), // CPA daalt, CTR stijgt, CPC daalt
  ];
  const keywords: KeywordQsRow[] = [{ cost: 1000, quality_score: 9 }];
  const out = computeSearchScorecard(rows, keywords);
  check("Impression Share hoog (>=16)", out.factors.find((f) => f.name === "Impression Share")!.score >= 16);
  check("Search Quality hoog (QS 9 -> 20pt)", out.factors.find((f) => f.name === "Search Quality")!.score === 20);
  check("Conversion Efficiency hoog (CPA daalt)", out.factors.find((f) => f.name === "Conversion Efficiency")!.score >= 16);
  check("Demand Capture hoog (CTR stijgt)", out.factors.find((f) => f.name === "Demand Capture")!.score >= 14);
  check("alle vijf beoordeeld", out.assessedCount === 5);
  check("grade A of B", out.grade === "A" || out.grade === "B", out.grade);
}

console.log("\nZwak account: lage IS, matige QS, verslechterende trends");
{
  const rows: SearchImpressionShareRow[] = [
    rij({ month: "2026-01-01", cost: 1000, conversions: 40, clicks: 600, impressions: 6000, searchImpressionShare: 0.30 }),
    rij({ month: "2026-02-01", cost: 1000, conversions: 25, clicks: 500, impressions: 6000, searchImpressionShare: 0.20 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 12, clicks: 350, impressions: 6000, searchImpressionShare: 0.15 }), // CPA stijgt, CTR daalt, CPC stijgt
  ];
  const keywords: KeywordQsRow[] = [{ cost: 1000, quality_score: 3 }];
  const out = computeSearchScorecard(rows, keywords);
  check("Impression Share laag (<=4)", out.factors.find((f) => f.name === "Impression Share")!.score <= 4);
  check("Search Quality laag (QS 3 -> 4pt)", out.factors.find((f) => f.name === "Search Quality")!.score === 4);
  check("Conversion Efficiency laag (CPA stijgt fors)", out.factors.find((f) => f.name === "Conversion Efficiency")!.score <= 4);
  check("Demand Capture laag (CTR daalt fors)", out.factors.find((f) => f.name === "Demand Capture")!.score <= 8);
  check("grade D of F", out.grade === "D" || out.grade === "F", out.grade);
}

console.log("\nGeen quality-score-data: Search Quality blijft eerlijk onbeoordeeld, de rest niet");
{
  const rows: SearchImpressionShareRow[] = [
    rij({ month: "2026-02-01", cost: 1000, conversions: 20 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 22 }),
  ];
  const out = computeSearchScorecard(rows, []);
  check("Search Quality niet beoordeeld", !out.factors.find((f) => f.name === "Search Quality")!.assessed);
  check("Search Quality score is 0, niet gegokt", out.factors.find((f) => f.name === "Search Quality")!.score === 0);
  check("Impression Share wel beoordeeld", out.factors.find((f) => f.name === "Impression Share")!.assessed);
  check("assessedCount is 4 (vijf min Search Quality)", out.assessedCount === 4);
}

console.log("\nDe keywordmaand staat in de factortekst, zodat veroudering zichtbaar is");
{
  // Live loopt ads_keyword_performance_monthly maanden achter op de IS-tabel; de route geeft
  // daarom de maand mee waar de quality-score-data werkelijk vandaan komt. Zonder dat label
  // leest een quality score van april als een van nu.
  const rows: SearchImpressionShareRow[] = [
    rij({ month: "2026-07-01", cost: 1000, conversions: 20 }),
    rij({ month: "2026-08-01", cost: 1000, conversions: 22 }),
  ];
  const keywords: KeywordQsRow[] = [{ cost: 1000, quality_score: 7 }];
  const out = computeSearchScorecard(rows, keywords, "2026-04");
  const factor = out.factors.find((f) => f.name === "Search Quality")!;
  check("beoordeeld met keyworddata", factor.assessed);
  check("de maand van de keyworddata staat in de tekst", factor.description.includes("2026-04"), factor.description);

  const zonderMaand = computeSearchScorecard(rows, keywords);
  check(
    "zonder maandlabel geen loze haakjes",
    !zonderMaand.factors.find((f) => f.name === "Search Quality")!.description.includes("("),
    zonderMaand.factors.find((f) => f.name === "Search Quality")!.description
  );
}

console.log("\nMeerdere campagnes in dezelfde maand: spend-gewogen, niet simpel gemiddeld");
{
  const rows: SearchImpressionShareRow[] = [
    rij({ campaignId: "groot", month: "2026-03-01", cost: 9000, searchImpressionShare: 0.20, conversions: 100, clicks: 4000, impressions: 40000 }),
    rij({ campaignId: "klein", month: "2026-03-01", cost: 1000, searchImpressionShare: 0.90, conversions: 10, clicks: 400, impressions: 4000 }),
  ];
  const out = computeSearchScorecard(rows, []);
  // Spend-gewogen: (0.20*9000 + 0.90*1000) / 10000 = 0.27 -- dicht bij de grote campagne, niet
  // het simpele gemiddelde van 0.55.
  check(
    "Impression Share-beschrijving trekt naar de grote (duurdere) campagne, niet naar het simpele gemiddelde",
    out.factors.find((f) => f.name === "Impression Share")!.description.includes("27%"),
    out.factors.find((f) => f.name === "Impression Share")!.description
  );
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
