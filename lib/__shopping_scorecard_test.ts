// Test voor de Shopping-scorecard (masterplan sectie 5.4). Deterministisch, geen IO.
// Draaien: npx tsx lib/__shopping_scorecard_test.ts

import { computeShoppingScorecard, type ShoppingCampaignMonthlyRow, type ShoppingProductRow } from "./shopping-scorecard";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function rij(o: Partial<ShoppingCampaignMonthlyRow> & { month: string }): ShoppingCampaignMonthlyRow {
  return { campaign_name: "GreenTech | Shopping | Merchandise", cost: 1000, conversions: 20, clicks: 500, impressions: 20000, ...o };
}

console.log("Randgeval: geen data");
{
  const out = computeShoppingScorecard([], []);
  check("alle vijf factoren onbeoordeeld", out.factors.every((f) => !f.assessed));
  check("grade is ? (geen basis)", out.grade === "?");
}

console.log("\nFeed Health is altijd onbeoordeeld, ongeacht de rest van de data");
{
  const rows: ShoppingCampaignMonthlyRow[] = [
    rij({ month: "2026-02-01", cost: 1000, conversions: 20 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 25 }),
  ];
  const out = computeShoppingScorecard(rows, []);
  check("Feed Health niet beoordeeld", !out.factors.find((f) => f.name === "Feed Health")!.assessed);
  check("Feed Health score is 0, niet gegokt", out.factors.find((f) => f.name === "Feed Health")!.score === 0);
}

console.log("\nSterk account: dalende CPA/CPC, stijgende CTR");
{
  const rows: ShoppingCampaignMonthlyRow[] = [
    rij({ month: "2026-01-01", cost: 1000, conversions: 15, clicks: 400, impressions: 20000 }),
    rij({ month: "2026-02-01", cost: 1000, conversions: 20, clicks: 450, impressions: 20000 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 30, clicks: 550, impressions: 20000 }), // CPA/CPC dalen, CTR stijgt
  ];
  const out = computeShoppingScorecard(rows, []);
  check("Conversion Efficiency hoog (CPA daalt)", out.factors.find((f) => f.name === "Conversion Efficiency")!.score >= 16);
  check("Demand Capture hoog (CTR stijgt)", out.factors.find((f) => f.name === "Demand Capture")!.score >= 14);
  check("Auction Pressure hoog (CPC daalt)", out.factors.find((f) => f.name === "Auction Pressure")!.score >= 16);
}

console.log("\nZwak account: stijgende CPA/CPC, dalende CTR");
{
  const rows: ShoppingCampaignMonthlyRow[] = [
    rij({ month: "2026-01-01", cost: 1000, conversions: 40, clicks: 600, impressions: 20000 }),
    rij({ month: "2026-02-01", cost: 1000, conversions: 25, clicks: 500, impressions: 20000 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 12, clicks: 350, impressions: 20000 }), // CPA/CPC stijgen, CTR daalt
  ];
  const out = computeShoppingScorecard(rows, []);
  check("Conversion Efficiency laag (CPA stijgt fors)", out.factors.find((f) => f.name === "Conversion Efficiency")!.score <= 4);
  check("Auction Pressure laag (CPC stijgt fors)", out.factors.find((f) => f.name === "Auction Pressure")!.score <= 4);
}

console.log("\nProduct-efficiëntie: producten met spend zonder conversie tellen als waste");
{
  const products: ShoppingProductRow[] = [
    { product_title: "Bestseller", cost: 800, clicks: 300, conversions: 40, impressions: 8000 },
    { product_title: "Dooie voorraad", cost: 200, clicks: 60, conversions: 0, impressions: 4000 },
  ];
  const out = computeShoppingScorecard([], products);
  const factor = out.factors.find((f) => f.name === "Product-efficiëntie")!;
  check("productdata wordt beoordeeld", factor.assessed);
  check("het zwakke product wordt genoemd in de beschrijving", factor.description.includes("1 product") || factor.description.includes("20%"), factor.description);
}

console.log("\nGeen productdata: Product-efficiëntie blijft eerlijk onbeoordeeld, de rest niet");
{
  const rows: ShoppingCampaignMonthlyRow[] = [
    rij({ month: "2026-02-01", cost: 1000, conversions: 20 }),
    rij({ month: "2026-03-01", cost: 1000, conversions: 25 }),
  ];
  const out = computeShoppingScorecard(rows, []);
  check("Product-efficiëntie niet beoordeeld", !out.factors.find((f) => f.name === "Product-efficiëntie")!.assessed);
  check("assessedCount is 3 (vijf min Product-efficiëntie en Feed Health)", out.assessedCount === 3, `${out.assessedCount}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
