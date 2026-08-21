// Fixture-test voor lib/meta/objective-breakdown.ts. Deterministisch, geen IO.
// Draaien: npx tsx lib/meta/__objective_breakdown_test.ts

import { buildMetaObjectiveBreakdown, type MetaObjectiveDailyRow } from "./objective-breakdown";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function close(actual: number | null, expected: number, label: string, eps = 0.001): void {
  const ok = actual !== null && Math.abs(actual - expected) < eps;
  assert(ok, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

function row(overrides: Partial<MetaObjectiveDailyRow & { campaignId: string }>): MetaObjectiveDailyRow & { campaignId: string } {
  return {
    entityId: overrides.campaignId ?? "c",
    campaignId: "c",
    spend: 0, impressions: 0, reach: 0, frequency: 0, linkClicks: 0, cpm: 0, cpcLink: 0,
    ctrLink: 0, conversions: 0, conversionValue: 0, purchaseRoas: 0, cpa: 0, roas: 0, leads: 0,
    addToCart: 0, initiateCheckout: 0, landingPageViews: 0, videoThruplay: 0, postEngagement: 0,
    hookRate: 0, holdRate: 0,
    ...overrides,
  };
}

// Twee Sales-campagnes, twee dagen elk: spend/conversions/conversionValue moeten sommeren,
// cpa/roas moeten uit de sommen herberekend worden (niet uit een gemiddelde van dag-ratio's).
const campaigns = [
  { id: "camp_a", name: "Zomer sale", objective: "OUTCOME_SALES" },
  { id: "camp_b", name: "Winter sale", objective: "OUTCOME_SALES" },
  { id: "camp_c", name: "Merkbekendheid Q3", objective: "OUTCOME_AWARENESS" },
];

const daily = [
  row({ campaignId: "camp_a", spend: 100, impressions: 10000, linkClicks: 200, conversions: 10, conversionValue: 500 }),
  row({ campaignId: "camp_a", spend: 200, impressions: 20000, linkClicks: 300, conversions: 5, conversionValue: 250 }),
  row({ campaignId: "camp_b", spend: 50, impressions: 5000, linkClicks: 100, conversions: 2, conversionValue: 100 }),
  row({ campaignId: "camp_c", spend: 300, impressions: 100000, reach: 40000, frequency: 2.5, hookRate: 0.3, holdRate: 0.2 }),
];

const groups = buildMetaObjectiveBreakdown(campaigns, daily);

const sales = groups.find((g) => g.objective === "OUTCOME_SALES");
assert(sales !== undefined, "Sales-groep bestaat");
if (sales) {
  close(sales.spend, 350, "Sales totale spend = 100+200+50");
  close(sales.metrics.conversions, 17, "Sales conversies = 10+5+2");
  close(sales.metrics.conversion_value, 850, "Sales conversiewaarde = 500+250+100");
  // cpa = spend/conversions = 350/17, NIET het gemiddelde van de losse dag-cpa's.
  close(sales.metrics.cpa!, 350 / 17, "Sales cpa herberekend uit sommen");
  close(sales.metrics.roas!, 850 / 350, "Sales roas herberekend uit sommen");
  assert(sales.campaigns.length === 2, "Sales-groep bevat twee campagnes");
  assert(sales.campaigns[0].name === "Zomer sale", "grootste spend eerst (Zomer sale voor Winter sale)");
}

const awareness = groups.find((g) => g.objective === "OUTCOME_AWARENESS");
assert(awareness !== undefined, "Awareness-groep bestaat");
if (awareness) {
  close(awareness.metrics.cpm!, 300 / (100000 / 1000), "Awareness cpm herberekend uit spend/impressies");
  close(awareness.metrics.reach!, 40000, "Awareness reach is de som (bovengrens, geen dedupe)");
  close(awareness.metrics.frequency!, 2.5, "Awareness frequency (enkele dag = zichzelf als gewogen gemiddelde)");
}

// Objective zonder enige campagne (bv. App Promotion) hoort NIET in de uitkomst -- geen lege
// tab voor iets wat deze klant niet voert.
assert(groups.every((g) => g.objective !== "OUTCOME_APP_PROMOTION"), "objective zonder campagnes ontbreekt in de uitkomst");
assert(groups.length === 2, "precies twee objective-groepen voor deze fixture");

// Sorteer op spend aflopend: Sales (350) voor Awareness (300).
assert(groups[0].objective === "OUTCOME_SALES", "groepen gesorteerd op spend aflopend");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
