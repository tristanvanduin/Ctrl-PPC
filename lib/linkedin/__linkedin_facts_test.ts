// Test voor de LinkedIn facts-assemblage (L2). Deterministisch, geen IO.
// F5 fase3: 6 pijlers (was 9 losse stappen). Zie lib/analysis/adapters/linkedin-ads.ts voor de mapping.
// Draaien: npx tsx lib/linkedin/__linkedin_facts_test.ts

import { buildLinkedinStepFacts, type LinkedInPreparedInputs } from "./prepared-facts";
import type { LinkedInComputeRow } from "./prepared-compute";
import type { LinkedInDemographicRow } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

function row(date: string, urn: string, impressions: number, clicks: number, spend: number, leads: number, form_opens: number, name?: string): LinkedInComputeRow {
  return { date, entityUrn: urn, entityName: name, impressions, clicks, spend, leads, form_opens, conversions: 0, conversion_value: 0 };
}
function demo(urn: string, spend: number | null, leads: number, coverage: number | null = null): LinkedInDemographicRow {
  return { date: "2026-03-15", level: "CAMPAIGN", entityUrn: "urn:li:sponsoredCampaign:1", pivotType: "MEMBER_JOB_FUNCTION", pivotValueUrn: urn, impressions: 0, clicks: 0, spend, leads, conversions: 0, coveragePct: coverage };
}

// Account: twee maanden, met leads en CPL-verbetering
const account: LinkedInComputeRow[] = [
  row("2026-02-10", "acct", 5000, 100, 400, 5, 25),
  row("2026-02-20", "acct", 5000, 100, 400, 5, 25),
  row("2026-03-10", "acct", 6000, 150, 300, 10, 50),
  row("2026-03-20", "acct", 6000, 150, 300, 10, 50),
];
// Campagnes in maart: c1 sterk (lage CPL), c2 zwak (hoge CPL)
const campaigns: LinkedInComputeRow[] = [
  row("2026-03-10", "urn:li:sponsoredCampaign:1", 6000, 120, 240, 16, 40, "Sterke campagne"),
  row("2026-03-10", "urn:li:sponsoredCampaign:2", 6000, 180, 360, 4, 60, "Zwakke campagne"),
];
// Creatives in maart met formats, met genoeg dagen voor CTR-verval
const creatives: LinkedInComputeRow[] = [];
for (let d = 1; d <= 14; d++) {
  const day = `2026-03-${String(d).padStart(2, "0")}`;
  const decayCtr = d <= 7 ? 200 : 100; // clicks daalt in de tweede week
  creatives.push(row(day, "urn:li:sponsoredCreative:a", 10000, decayCtr, 100, 5, 20));
  creatives.push(row(day, "urn:li:sponsoredCreative:b", 10000, 50, 100, 1, 10));
}
const demographics: LinkedInDemographicRow[] = [
  demo("urn:li:function:4", 300, 8),   // in ICP
  demo("urn:li:function:8", 200, 4),   // in ICP
  demo("urn:li:function:13", 250, 2),  // niet-ICP
  demo("TOTAL", 750, 14, 0.8),
];
const inputs: LinkedInPreparedInputs = {
  account, campaigns, creatives, demographics,
  campaignMeta: [
    { entityUrn: "urn:li:sponsoredCampaign:1", name: "Sterke campagne", objective: "LEAD_GENERATION", cost_type: "CPC", bid_strategy: "MANUAL", audience_count: 25000 },
    { entityUrn: "urn:li:sponsoredCampaign:2", name: "Zwakke campagne", objective: "LEAD_GENERATION", cost_type: "CPM", bid_strategy: "MAX_DELIVERY", audience_count: 8000 },
  ],
  creativeMeta: [
    { entityUrn: "urn:li:sponsoredCreative:a", format: "single_image" },
    { entityUrn: "urn:li:sponsoredCreative:b", format: "video" },
  ],
  icp: { job_functions: ["urn:li:function:4", "urn:li:function:8"], seniorities: [], industries: [], company_sizes: [] },
  targets: { cplTarget: 40 },
};

const facts = buildLinkedinStepFacts(inputs);
assert(Object.keys(facts).length === 6, "zes pijlers geassembleerd");

// Pijler 1: MoM-keten en CPL-target-gap
const p1 = facts[1] as { mom_chain: { metric: string }[]; target_gap: { status: string; cpl: number } | null; latest_month: string };
assert(p1.latest_month === "2026-03", "pijler 1 laatste maand");
assert(p1.mom_chain[0].metric === "Leads", "pijler 1 keten begint met Leads");
// Maart account-CPL = 600/20 = 30, target 40 -> OP SCHEMA
assert(p1.target_gap?.cpl === 30 && p1.target_gap?.status === "OP SCHEMA", "pijler 1 CPL-target-gap OP SCHEMA");

// Pijler 2 (Structuur, Budget & Bidding): campagnes versus accountgemiddelde, en bidding uit metadata.
const p2 = facts[2] as { campagnes: { entities: { entity: string; cpl: { position: string }; cost_type: string | null }[] }; bidding: { available: boolean; campaigns: { cost_type: string | null }[] } };
assert(p2.campagnes.entities.length === 2, "pijler 2: twee campagnes");
const c1 = p2.campagnes.entities.find((e) => e.entity === "urn:li:sponsoredCampaign:1");
const c2 = p2.campagnes.entities.find((e) => e.entity === "urn:li:sponsoredCampaign:2");
assert(c1?.cpl.position === "onder", "pijler 2: sterke campagne CPL onder accountgemiddelde");
assert(c2?.cpl.position === "boven", "pijler 2: zwakke campagne CPL boven accountgemiddelde");
assert(c1?.cost_type === "CPC", "pijler 2: campagne-metadata (cost_type) meegenomen");
assert(p2.bidding.available && p2.bidding.campaigns.length === 2, "pijler 2: bidding uit metadata");

// Pijler 2 bidding degradeert zonder metadata, maar campagnes blijft gewoon gevuld.
const noBidding = buildLinkedinStepFacts({ ...inputs, campaignMeta: undefined })[2] as { campagnes: { entities: unknown[] }; bidding: { available: boolean } };
assert(noBidding.bidding.available === false, "pijler 2: bidding degradeert netjes zonder metadata");
assert(noBidding.campagnes.entities.length === 2, "pijler 2: campagnes blijft gevuld ook als bidding degradeert");

// Pijler 3 (Creative Performance): creatives per format met label en CTR-verval.
const p3 = facts[3] as { creatives: { creative: string; format: string; label: string; ctr_decay: { decline_pct: number } | null }[] };
const creativeA = p3.creatives.find((c) => c.creative === "urn:li:sponsoredCreative:a");
assert(creativeA?.format === "single_image", "pijler 3: creative-format uit metadata");
assert(creativeA?.ctr_decay != null && creativeA.ctr_decay.decline_pct < 0, "pijler 3: CTR-verval gedetecteerd (dalend)");

// Pijler 4 (Doelgroep: ICP-fit & Verzadiging): ICP-fit en audience/verzadiging in hetzelfde blok.
const p4 = facts[4] as { icp_fit: { available: boolean; degraded: boolean; pivots: { spendInIcpPct: number | null }[] }; audience_verzadiging: { cpm_trend_3m: string; saturation_signal: boolean; audience_sizes: unknown[]; saturation_proxy_30d: { available: boolean } } };
assert(p4.icp_fit.available && !p4.icp_fit.degraded, "pijler 4: ICP-fit beschikbaar en niet gedegradeerd");
assert(p4.icp_fit.pivots[0].spendInIcpPct != null && p4.icp_fit.pivots[0].spendInIcpPct > 0.6, "pijler 4: ICP spend-aandeel berekend (500/750)");
assert(typeof p4.audience_verzadiging.saturation_signal === "boolean", "pijler 4: verzadigingssignaal aanwezig");
assert(p4.audience_verzadiging.audience_sizes.length === 2, "pijler 4: audience-omvang uit metadata");
assert(typeof p4.audience_verzadiging.saturation_proxy_30d.available === "boolean", "pijler 4: proxy-veld aanwezig op de gedeelde fixture");

// Pijler 4 ICP-fit degradeert bij lege ICP, audience_verzadiging blijft onafhankelijk gevuld.
const emptyIcpFacts = buildLinkedinStepFacts({ ...inputs, icp: { job_functions: [], seniorities: [], industries: [], company_sizes: [] } })[4] as { icp_fit: { degraded: boolean }; audience_verzadiging: { audience_sizes: unknown[] } };
assert(emptyIcpFacts.icp_fit.degraded === true, "pijler 4: ICP-fit degradeert bij lege ICP");
assert(emptyIcpFacts.audience_verzadiging.audience_sizes.length === 2, "pijler 4: audience_verzadiging blijft onafhankelijk gevuld");

// Pijler 5 (Lead Gen Funnel).
const p5 = facts[5] as { has_leadgen: boolean; completion_rate_pct: number | null };
assert(p5.has_leadgen === true, "pijler 5 detecteert leadgen");
assert(p5.completion_rate_pct === 20, "pijler 5: completion rate = 20/100 = 20%");

// Pijler 6: synthese-marker.
const p6 = facts[6] as { note: string; account_months: number };
assert(p6.account_months === 2 && /synthese/i.test(p6.note), "pijler 6 synthese-marker");

// F5 fase2.6: verzadigingsproxy op een losse 60-dagen fixture (dag 1-30 = prior, dag 31-60 = recent).
function isoDate(dayOffset: number): string {
  const d = new Date(Date.UTC(2026, 0, 1) + dayOffset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function buildSixtyDayAccount(recentClicksPerDay: number): LinkedInComputeRow[] {
  const rows: LinkedInComputeRow[] = [];
  // Dag 0-29 (prior 30 dagen): CPM = 20/1000*1000 = 20, 50 clicks/dag.
  for (let d = 0; d < 30; d++) rows.push(row(isoDate(d), "acct", 1000, 50, 20, 0, 0));
  // Dag 30-59 (recent 30 dagen): spend omhoog -> CPM = 25 (25% stijging, > 20%-drempel).
  for (let d = 30; d < 60; d++) rows.push(row(isoDate(d), "acct", 1000, recentClicksPerDay, 25, 0, 0));
  return rows;
}

// Sterke CPM-stijging + vlakke klikgroei (0%) -> verzadigingsproxy vlagt.
const stagnantAccount = buildSixtyDayAccount(50);
const stagnantFacts = (buildLinkedinStepFacts({ ...inputs, account: stagnantAccount })[4] as { audience_verzadiging: {
  saturation_signal: boolean;
  saturation_proxy_30d: { available: boolean; cpm_delta_pct: number; click_delta_pct: number; strong_cpm_rise: boolean; click_stagnation: boolean; saturation_signal_30d: boolean };
} }).audience_verzadiging;
assert(stagnantFacts.saturation_proxy_30d.available === true, "proxy beschikbaar met 60 dagen historie");
assert(stagnantFacts.saturation_proxy_30d.cpm_delta_pct === 25, "CPM-delta 25% (20 -> 25)");
assert(stagnantFacts.saturation_proxy_30d.click_delta_pct === 0, "click-delta 0% (vlak)");
assert(stagnantFacts.saturation_proxy_30d.strong_cpm_rise === true, "sterke CPM-stijging boven de 20%-drempel");
assert(stagnantFacts.saturation_proxy_30d.click_stagnation === true, "klikstagnatie gedetecteerd (0% <= 5%)");
assert(stagnantFacts.saturation_proxy_30d.saturation_signal_30d === true, "30-dagen verzadigingssignaal true");
assert(stagnantFacts.saturation_signal === true, "pijler 4: saturation_signal volgt de 30-dagen proxy ook zonder 3-maands trend");

// Sterke CPM-stijging maar sterke klikgroei (80%) -> geen verzadiging, ondanks de CPM-stijging.
const growingAccount = buildSixtyDayAccount(90);
const growingFacts = (buildLinkedinStepFacts({ ...inputs, account: growingAccount })[4] as { audience_verzadiging: {
  saturation_proxy_30d: { click_delta_pct: number; click_stagnation: boolean; saturation_signal_30d: boolean };
} }).audience_verzadiging;
assert(growingFacts.saturation_proxy_30d.click_delta_pct === 80, "click-delta 80% (50 -> 90)");
assert(growingFacts.saturation_proxy_30d.click_stagnation === false, "geen klikstagnatie bij 80% groei");
assert(growingFacts.saturation_proxy_30d.saturation_signal_30d === false, "geen verzadigingssignaal bij groeiende klikken, ondanks CPM-stijging");

// Alleen recente rijen (dag 50-59), niets in de voorgaande-30-dagen-vensterperiode -> degradeert netjes.
const sparseAccount: LinkedInComputeRow[] = [];
for (let d = 50; d < 60; d++) sparseAccount.push(row(isoDate(d), "acct", 1000, 50, 20, 0, 0));
const sparseFacts = (buildLinkedinStepFacts({ ...inputs, account: sparseAccount })[4] as { audience_verzadiging: { saturation_proxy_30d: { available: boolean; note?: string } } }).audience_verzadiging;
assert(sparseFacts.saturation_proxy_30d.available === false, "proxy degradeert zonder voorgaande-30-dagen historie");
assert(typeof sparseFacts.saturation_proxy_30d.note === "string", "proxy geeft een note bij degradatie");

// Geen accountdata -> degradeert netjes (geen crash).
const noAccountFacts = (buildLinkedinStepFacts({ ...inputs, account: [] })[4] as { audience_verzadiging: { saturation_proxy_30d: { available: boolean } } }).audience_verzadiging;
assert(noAccountFacts.saturation_proxy_30d.available === false, "proxy degradeert bij lege accountdata");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
