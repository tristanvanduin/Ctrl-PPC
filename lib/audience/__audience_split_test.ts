// Doelgroeplabels en de hergebruikte splitsingskern. Deterministisch, geen IO.
// Draaien: npx tsx lib/audience/__audience_split_test.ts

import { audienceTypeLabel, buildAudienceSplit, findAudienceImbalances, audienceTotals, type AudienceRow } from "./audience-split";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

check("AFFINITY vertaalt naar Affiniteit", audienceTypeLabel("AFFINITY") === "Affiniteit");
check("in_market (kleine letters) vertaalt ook", audienceTypeLabel("in_market") === "In-market");
check("onbekend type houdt zijn eigen naam", audienceTypeLabel("SOME_NEW_TYPE") === "SOME_NEW_TYPE");

const rows: AudienceRow[] = [
  { networkType: "REMARKETING", cost: 140, conversions: 29, conversionsValue: 0, impressions: 0, clicks: 0 },
  { networkType: "IN_MARKET", cost: 220, conversions: 24, conversionsValue: 0, impressions: 0, clicks: 0 },
  { networkType: "AFFINITY", cost: 190, conversions: 5, conversionsValue: 0, impressions: 0, clicks: 0 },
];
const slices = buildAudienceSplit(rows, { labelOf: audienceTypeLabel });

check("drie doelgroeptypen blijven drie segmenten", slices.length === 3, String(slices.length));
check("segmenten dragen het vertaalde label", slices.some((s) => s.label === "Remarketing"));
check("grootste kostenpost eerst", slices[0].networkType === "IN_MARKET", slices[0].networkType);

const totals = audienceTotals(slices);
check("totale kosten kloppen", totals.cost === 550, String(totals.cost));

const imbalances = findAudienceImbalances(slices);
check("affiniteit valt op als duur segment", imbalances.some((i) => i.slice.networkType === "AFFINITY" && i.kind === "duur"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
