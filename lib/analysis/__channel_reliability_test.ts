// F5 fase1.1: reliability-normalisatie voor Meta en LinkedIn.
// Draaien: npx tsx lib/analysis/__channel_reliability_test.ts

import { computeMetaReliability, computeLinkedinReliability } from "./channel-reliability";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

console.log("\n1. Meta: kolomnamen correct genormaliseerd (spend->cost, link_clicks->clicks)");
{
  const accountDaily = [
    { date: "2026-01-05", impressions: 1000, link_clicks: 50, spend: 100, conversions: 5, conversion_value: 500 },
    { date: "2026-01-20", impressions: 1000, link_clicks: 50, spend: 100, conversions: 5, conversion_value: 500 },
    { date: "2026-02-05", impressions: 1200, link_clicks: 60, spend: 120, conversions: 6, conversion_value: 600 },
    { date: "2026-02-20", impressions: 1200, link_clicks: 60, spend: 120, conversions: 6, conversion_value: 600 },
  ];
  const assessment = computeMetaReliability({
    accountDaily,
    campaignDaily: accountDaily,
    conversionLagDays: 0,
    lastCompleteMonth: 2,
    hasKpiTargets: true,
  });
  check("levert een geldige overallConfidence", ["high", "medium", "low", "critical"].includes(assessment.overallConfidence));
  check("geen tracking-flag bij stabiele groei (spend en conversies bewegen samen)", !assessment.flags.some((f) => f.type === "tracking"));
}

console.log("\n2. Meta: tracking-anomalie wordt gedetecteerd via de genormaliseerde kolommen");
{
  const accountDaily = [
    { date: "2026-01-05", impressions: 1000, link_clicks: 50, spend: 100, conversions: 10, conversion_value: 1000 },
    { date: "2026-01-20", impressions: 1000, link_clicks: 50, spend: 100, conversions: 10, conversion_value: 1000 },
    { date: "2026-02-05", impressions: 1000, link_clicks: 50, spend: 100, conversions: 0, conversion_value: 0 },
    { date: "2026-02-20", impressions: 1000, link_clicks: 50, spend: 100, conversions: 0, conversion_value: 0 },
  ];
  const assessment = computeMetaReliability({
    accountDaily,
    campaignDaily: accountDaily,
    conversionLagDays: 0,
    lastCompleteMonth: 2,
    hasKpiTargets: true,
  });
  check("conversies naar 0 na stabiele maand triggert een tracking-flag", assessment.flags.some((f) => f.type === "tracking"), JSON.stringify(assessment.flags));
  check("overallConfidence is critical bij een tracking-break", assessment.overallConfidence === "critical");
}

console.log("\n3. LinkedIn: kolomnamen correct genormaliseerd (spend->cost, one_click_leads->conversions)");
{
  const accountDaily = [
    { date: "2026-01-05", impressions: 500, clicks: 20, spend: 200, one_click_leads: 4, conversion_value: 400 },
    { date: "2026-01-20", impressions: 500, clicks: 20, spend: 200, one_click_leads: 4, conversion_value: 400 },
    { date: "2026-02-05", impressions: 550, clicks: 22, spend: 220, one_click_leads: 5, conversion_value: 500 },
    { date: "2026-02-20", impressions: 550, clicks: 22, spend: 220, one_click_leads: 5, conversion_value: 500 },
  ];
  const assessment = computeLinkedinReliability({
    accountDaily,
    campaignDaily: accountDaily,
    conversionLagDays: 0,
    lastCompleteMonth: 2,
    hasKpiTargets: true,
  });
  check("levert een geldige overallConfidence", ["high", "medium", "low", "critical"].includes(assessment.overallConfidence));
  check("geen tracking-flag bij stabiele lead-groei", !assessment.flags.some((f) => f.type === "tracking"));
}

console.log("\n4. Maand-ceiling geldt ook via de normalisatie (te weinig maanden -> critical)");
{
  const accountDaily = [
    { date: "2026-02-05", impressions: 1000, link_clicks: 50, spend: 100, conversions: 10, conversion_value: 1000 },
  ];
  const assessment = computeMetaReliability({
    accountDaily,
    campaignDaily: accountDaily,
    conversionLagDays: 0,
    lastCompleteMonth: 2,
    hasKpiTargets: true,
  });
  check("1 maand data forceert critical (te weinig om tegen te vergelijken)", assessment.overallConfidence === "critical");
}

console.log("\nRESULTAAT: " + passed + " geslaagd, " + failed + " gefaald\n");
if (failed > 0) process.exit(1);
