// Fixture-test voor lib/linkedin/objective-breakdown.ts. Deterministisch, geen IO.
// Draaien: npx tsx lib/linkedin/__objective_breakdown_test.ts

import { buildLinkedInObjectiveBreakdown, type LinkedInObjectiveDailyRow } from "./objective-breakdown";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
function close(actual: number | null, expected: number, label: string, eps = 0.001): void {
  const ok = actual !== null && Math.abs(actual - expected) < eps;
  assert(ok, `${label} (verwacht ${expected}, kreeg ${actual})`);
}

function row(overrides: Partial<LinkedInObjectiveDailyRow & { campaignUrn: string }>): LinkedInObjectiveDailyRow & { campaignUrn: string } {
  return {
    entityUrn: overrides.campaignUrn ?? "urn:a",
    campaignUrn: "urn:a",
    spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, landingPageClicks: 0,
    oneClickLeadFormOpens: 0, oneClickLeads: 0, externalWebsiteConversions: 0, postClickConversions: 0,
    conversionValue: 0, cpl: 0, formCompletionRate: 0, videoStarts: 0, videoViews: 0, videoCompletions: 0,
    videoCompletionRate: 0, totalEngagements: 0, follows: 0, reactions: 0, comments: 0, shares: 0,
    ...overrides,
  };
}

const campaigns = [
  { urn: "urn:lead_1", name: "Whitepaper campagne", objectiveType: "LEAD_GENERATION" },
  { urn: "urn:lead_2", name: "Demo-aanvraag", objectiveType: "LEAD_GENERATION" },
  { urn: "urn:vid_1", name: "Merkfilm", objectiveType: "VIDEO_VIEWS" },
];

const daily = [
  row({ campaignUrn: "urn:lead_1", spend: 400, oneClickLeads: 20, oneClickLeadFormOpens: 40, impressions: 20000, clicks: 300 }),
  row({ campaignUrn: "urn:lead_1", spend: 100, oneClickLeads: 5, oneClickLeadFormOpens: 10, impressions: 5000, clicks: 60 }),
  row({ campaignUrn: "urn:lead_2", spend: 50, oneClickLeads: 1, oneClickLeadFormOpens: 5, impressions: 2000, clicks: 20 }),
  row({ campaignUrn: "urn:vid_1", spend: 200, videoViews: 8000, videoStarts: 10000, videoCompletions: 3000 }),
];

const groups = buildLinkedInObjectiveBreakdown(campaigns, daily);

const leadGen = groups.find((g) => g.objective === "LEAD_GENERATION");
assert(leadGen !== undefined, "Lead Generation-groep bestaat");
if (leadGen) {
  close(leadGen.spend, 550, "Lead Gen totale spend = 400+100+50");
  close(leadGen.metrics.one_click_leads, 26, "Lead Gen leads = 20+5+1");
  // cpl = spend/leads herberekend uit de sommen, niet gemiddeld over dag-cpl's.
  close(leadGen.metrics.cpl!, 550 / 26, "Lead Gen cpl herberekend uit sommen");
  close(leadGen.metrics.form_completion_rate!, 26 / 55, "form_completion_rate = leads/form_opens uit sommen (40+10+5=55)");
  assert(leadGen.campaigns[0].name === "Whitepaper campagne", "grootste spend eerst binnen Lead Generation");
}

const video = groups.find((g) => g.objective === "VIDEO_VIEWS");
assert(video !== undefined, "Video Views-groep bestaat");
if (video) {
  close(video.metrics.cost_per_view!, 200 / 8000, "cost_per_view = spend/videoViews");
  close(video.metrics.video_completion_rate!, 3000 / 10000, "video_completion_rate = completions/starts");
}

assert(groups.length === 2, "precies twee objective-groepen voor deze fixture");
assert(groups.every((g) => g.objective !== "JOB_APPLICANTS"), "objective zonder campagnes ontbreekt in de uitkomst");
assert(groups[0].objective === "LEAD_GENERATION", "groepen gesorteerd op spend aflopend (550 voor 200)");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
