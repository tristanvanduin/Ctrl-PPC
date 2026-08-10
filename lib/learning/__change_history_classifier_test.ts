// Test voor de ads_change_history-naar-ChangeEvent-classificatie. Deterministisch, geen IO.
// De voorbeeldpayloads zijn letterlijk uit de live database gehaald (10 augustus 2026), niet
// verzonnen.
// Draaien: npx tsx lib/learning/__change_history_classifier_test.ts

import { classificeerChangeHistory, type RawChangeHistoryRow } from "./change-history-classifier";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const basis = (overrides: Partial<RawChangeHistoryRow>): RawChangeHistoryRow => ({
  resource_type: null,
  change_type: null,
  campaign_name: "Campagne X",
  change_datetime: "2026-04-07 14:33:20.245135+00",
  old_value: null,
  new_value: null,
  ...overrides,
});

console.log("Budget-wijziging");
{
  const rij = basis({
    resource_type: "CAMPAIGN_BUDGET",
    change_type: "UPDATE",
    old_value: '{"campaignBudget":{"amountMicros":"50000000"}}',
    new_value: '{"campaignBudget":{"amountMicros":"78000000"}}',
  });
  const events = classificeerChangeHistory([rij]);
  check("een budgetwijziging wordt herkend als type budget", events.length === 1 && events[0].type === "budget");
  check("de campagnenaam en datum reizen mee", events[0].entity === "Campagne X" && events[0].date === "2026-04-07");
}

console.log("\nBod-wijziging (targetRoas)");
{
  const rij = basis({
    resource_type: "CAMPAIGN",
    change_type: "UPDATE",
    old_value: '{"campaign":{"maximizeConversionValue":{"targetRoas":2.2}}}',
    new_value: '{"campaign":{"maximizeConversionValue":{"targetRoas":2.3}}}',
  });
  check("een targetRoas-wijziging is een bod-event", classificeerChangeHistory([rij])[0]?.type === "bid");
}

console.log("\nCampagne op pauze");
{
  const rij = basis({
    resource_type: "CAMPAIGN",
    change_type: "UPDATE",
    old_value: '{"campaign":{"status":"ENABLED"}}',
    new_value: '{"campaign":{"status":"PAUSED"}}',
  });
  check("een campagne die PAUSED wordt is een status_paused-event", classificeerChangeHistory([rij])[0]?.type === "status_paused");
}

console.log("\nAd-group-criterion status (keyword aan/uit)");
{
  const rij = basis({
    resource_type: "AD_GROUP_CRITERION",
    change_type: "UPDATE",
    old_value: '{"adGroupCriterion":{"status":"PAUSED"}}',
    new_value: '{"adGroupCriterion":{"status":"ENABLED"}}',
  });
  // ENABLED is geen PAUSED: dit is geen status_paused-event, en er is geen keyword-veld, dus
  // ook geen keyword_added/excluded. Terecht ongeclassificeerd.
  check("terugzetten naar ENABLED wordt niet als status_paused geclassificeerd", classificeerChangeHistory([rij]).length === 0);
}

console.log("\nIP-block-uitsluiting: GEEN keyword-veld, dus terecht ongeclassificeerd");
{
  const rij = basis({
    resource_type: "CAMPAIGN_CRITERION",
    change_type: "REMOVE",
    old_value: '{"campaignCriterion":{"ipBlock":{"ipAddress":"1.2.3.4"},"negative":true}}',
    new_value: '{"campaignCriterion":{}}',
  });
  check("een IP-block-criterion is geen keyword, en levert dus geen ChangeEvent op", classificeerChangeHistory([rij]).length === 0);
}

console.log("\nEcht zoekwoord uitgesloten");
{
  const rij = basis({
    resource_type: "CAMPAIGN_CRITERION",
    change_type: "CREATE",
    new_value: '{"campaignCriterion":{"keyword":{"text":"gratis"},"negative":true}}',
  });
  check("een negatief zoekwoord dat wordt aangemaakt is keyword_excluded", classificeerChangeHistory([rij])[0]?.type === "keyword_excluded");
}

console.log("\nEcht zoekwoord toegevoegd (niet negatief)");
{
  const rij = basis({
    resource_type: "AD_GROUP_CRITERION",
    change_type: "CREATE",
    new_value: '{"adGroupCriterion":{"keyword":{"text":"schoenen kopen"}}}',
  });
  check("een niet-negatief zoekwoord dat wordt aangemaakt is keyword_added", classificeerChangeHistory([rij])[0]?.type === "keyword_added");
}

console.log("\nRandgevallen");
{
  check("ontbrekende campagnenaam levert geen event op", classificeerChangeHistory([basis({ resource_type: "CAMPAIGN_BUDGET", new_value: '{"campaignBudget":{"amountMicros":"1"}}', campaign_name: null })]).length === 0);
  check("kapotte JSON crasht niet en levert geen event op", classificeerChangeHistory([basis({ resource_type: "CAMPAIGN_BUDGET", new_value: "{niet geldig" })]).length === 0);
  check("lege lijst levert lege lijst", classificeerChangeHistory([]).length === 0);
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
