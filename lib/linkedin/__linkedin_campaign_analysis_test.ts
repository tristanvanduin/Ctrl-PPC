// Test voor de LinkedIn campagne-analyse. Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__linkedin_campaign_analysis_test.ts

import { analyzeLinkedInCampaigns, summarizeLinkedInCampaign, type LinkedInCampaignData, type LinkedInCampaignMonthlyMetrics } from "./campaign-analysis";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function maand(m: number, o: Partial<LinkedInCampaignMonthlyMetrics> = {}): LinkedInCampaignMonthlyMetrics {
  return {
    month: m, impressions: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0, landingPageClicks: 0,
    oneClickLeadFormOpens: 0, oneClickLeads: 0, externalWebsiteConversions: 0, conversionValue: 0,
    cpl: 0, formCompletionRate: 0, videoStarts: 0, videoViews: 0, videoCompletions: 0,
    videoCompletionRate: 0, totalEngagements: 0, ...o,
  };
}

function campagne(monthly: LinkedInCampaignMonthlyMetrics[], o: Partial<LinkedInCampaignData> = {}): LinkedInCampaignData {
  return { campaignUrn: "urn:li:sponsoredCampaign:1", campaignName: "Test", objective: "LEAD_GENERATION", status: "ACTIVE", monthly, ...o };
}

// ── summarize ────────────────────────────────────────────────────────────

console.log("summarizeLinkedInCampaign");
{
  const c = campagne([maand(1, { spend: 400, oneClickLeads: 4 }), maand(2, { spend: 400, oneClickLeads: 4 })]);
  const s = summarizeLinkedInCampaign(c, 800);
  check("totalLeads telt op", s.totalLeads === 8, `${s.totalLeads}`);
  check("spendShare is 100 bij enige campagne", s.spendShare === 100, `${s.spendShare}`);
}

// ── CPL-baseline zit binnen Leadgeneratie, niet over het account heen ──────

console.log("analyzeLinkedInCampaigns: CPL-baseline per objective");
{
  const leadsGezond = campagne(
    [maand(1, { spend: 200, cpl: 40, oneClickLeads: 5 }), maand(2, { spend: 200, cpl: 40, oneClickLeads: 5 })],
    { campaignUrn: "urn:1", campaignName: "Leads gezond", objective: "LEAD_GENERATION" },
  );
  const leadsZwak = campagne(
    [maand(1, { spend: 300, cpl: 150, oneClickLeads: 2 }), maand(2, { spend: 300, cpl: 150, oneClickLeads: 2 })],
    { campaignUrn: "urn:2", campaignName: "Leads zwak", objective: "LEAD_GENERATION" },
  );
  // Een Video-campagne met een dure "cpl" (betekenisloos voor Video Views) mag de Leads-
  // baseline niet beinvloeden.
  const video = campagne(
    [maand(1, { spend: 200, cpl: 500, videoViews: 100, videoCompletionRate: 0.3 }), maand(2, { spend: 200, cpl: 500, videoViews: 100, videoCompletionRate: 0.3 })],
    { campaignUrn: "urn:3", campaignName: "Video", objective: "VIDEO_VIEWS" },
  );
  const result = analyzeLinkedInCampaigns({ clientId: "test", campaigns: [leadsGezond, leadsZwak, video] });
  const issue = result.findings.find((f) => f.category === "cpl-issue");
  check("cpl-issue wijst naar de zwakke Leads-campagne", issue?.campaignName === "Leads zwak", JSON.stringify(issue));
  check("de gezonde Leads-campagne krijgt geen cpl-issue", !result.findings.some((f) => f.campaignName === "Leads gezond" && f.category === "cpl-issue"));
}

// ── Job Applicants: geen data beschikbaar => alleen manualChecks, geen crash ─

console.log("analyzeLinkedInCampaigns: Job Applicants zonder dekking");
{
  const c = campagne(
    [maand(1, { spend: 300, clicks: 40 }), maand(2, { spend: 300, clicks: 40 })],
    { objective: "JOB_APPLICANTS" },
  );
  const result = analyzeLinkedInCampaigns({ clientId: "test", campaigns: [c] });
  check("Job Applicants levert manualChecks op", result.manualChecks.some((m) => m.objective === "JOB_APPLICANTS"));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
