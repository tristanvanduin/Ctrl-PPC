// Test voor de Meta campagne-analyse. Deterministisch, geen IO.
// Draaien: npx tsx lib/meta/__meta_campaign_analysis_test.ts

import { analyzeMetaCampaigns, summarizeMetaCampaign, type MetaCampaignData, type MetaCampaignMonthlyMetrics } from "./campaign-analysis";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function maand(m: number, o: Partial<MetaCampaignMonthlyMetrics> = {}): MetaCampaignMonthlyMetrics {
  return {
    month: m, impressions: 0, reach: 0, frequency: 0, linkClicks: 0, spend: 0, cpm: 0, cpcLink: 0,
    ctrLink: 0, conversions: 0, conversionValue: 0, purchaseRoas: 0, cpa: 0, leads: 0, addToCart: 0,
    initiateCheckout: 0, landingPageViews: 0, videoThruplay: 0, hookRate: 0, holdRate: 0, postEngagement: 0,
    ...o,
  };
}

function campagne(monthly: MetaCampaignMonthlyMetrics[], o: Partial<MetaCampaignData> = {}): MetaCampaignData {
  return { campaignId: "1", campaignName: "Test", objective: "OUTCOME_SALES", status: "ACTIVE", monthly, ...o };
}

// ── summarize: CPA is null bij nul conversies, niet de besteding ───────────

console.log("summarizeMetaCampaign");
{
  const c = campagne([
    maand(1, { spend: 500, impressions: 10000, linkClicks: 100 }),
    maand(2, { spend: 500, impressions: 10000, linkClicks: 100 }),
  ]);
  const s = summarizeMetaCampaign(c, 1000);
  check("avgCpa is null zonder conversies", s.avgCpa === null, `${s.avgCpa}`);
  check("totalSpend telt op", s.totalSpend === 1000, `${s.totalSpend}`);
  check("spendShare klopt", s.spendShare === 100, `${s.spendShare}`);
}
{
  const c = campagne([maand(1, { spend: 300, conversions: 3 }), maand(2, { spend: 300, conversions: 3 })]);
  const s = summarizeMetaCampaign(c, 600);
  check("avgCpa berekent besteding/conversies", s.avgCpa === 100, `${s.avgCpa}`);
}

// ── analyzeMetaCampaigns: frequentie-verzadiging vuurt, ongeacht objective ─

console.log("analyzeMetaCampaigns: frequentie-verzadiging");
{
  const data = {
    clientId: "test", campaigns: [
      campagne(
        [maand(1, { frequency: 3.0, impressions: 5000, spend: 300 }), maand(2, { frequency: 6.5, impressions: 5000, spend: 300 })],
        { objective: "OUTCOME_AWARENESS" },
      ),
    ],
  };
  const result = analyzeMetaCampaigns(data);
  const finding = result.findings.find((f) => f.category === "frequency-fatigue");
  check("frequentie-verzadiging gevonden bij freq > 5", !!finding, JSON.stringify(result.findings));
}

// ── ROAS-baseline zit binnen het objective, niet over het account heen ─────

console.log("analyzeMetaCampaigns: ROAS-baseline per objective");
{
  const salesGezond = campagne(
    [maand(1, { spend: 400, purchaseRoas: 5, conversions: 5 }), maand(2, { spend: 400, purchaseRoas: 5, conversions: 5 })],
    { campaignId: "sales-gezond", campaignName: "Sales gezond", objective: "OUTCOME_SALES" },
  );
  const salesZwak = campagne(
    [maand(1, { spend: 400, purchaseRoas: 1, conversions: 2 }), maand(2, { spend: 400, purchaseRoas: 1, conversions: 2 })],
    { campaignId: "sales-zwak", campaignName: "Sales zwak", objective: "OUTCOME_SALES" },
  );
  // Een Leads-campagne met een lage "purchaseRoas" (betekenisloos voor Leads) mag de Sales-
  // baseline niet beinvloeden -- dat is precies de fout die dit bestand vermijdt.
  const leads = campagne(
    [maand(1, { spend: 200, purchaseRoas: 0, leads: 3 }), maand(2, { spend: 200, purchaseRoas: 0, leads: 3 })],
    { campaignId: "leads", campaignName: "Leads", objective: "OUTCOME_LEADS" },
  );
  const result = analyzeMetaCampaigns({ clientId: "test", campaigns: [salesGezond, salesZwak, leads] });
  const bleeder = result.findings.find((f) => f.category === "roas-bleeder");
  check("roas-bleeder wijst naar de zwakke Sales-campagne", bleeder?.campaignName === "Sales zwak", JSON.stringify(bleeder));
  check("de gezonde Sales-campagne krijgt geen roas-bleeder", !result.findings.some((f) => f.campaignName === "Sales gezond" && f.category === "roas-bleeder"));
}

// ── App Promotion: geen data beschikbaar => alleen manualChecks, geen crash ─

console.log("analyzeMetaCampaigns: App Promotion zonder dekking");
{
  const c = campagne(
    [maand(1, { spend: 300, impressions: 5000 }), maand(2, { spend: 300, impressions: 5000 })],
    { objective: "OUTCOME_APP_PROMOTION" },
  );
  const result = analyzeMetaCampaigns({ clientId: "test", campaigns: [c] });
  check("App Promotion levert manualChecks op", result.manualChecks.some((m) => m.objective === "OUTCOME_APP_PROMOTION"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
