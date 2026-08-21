/**
 * Groepeert LinkedIn-campagnes per objective en rekent de OBJECTIVE_EVAL_CRITERIA-metrics uit
 * lib/linkedin/campaign-types.ts uit tegen echte data.
 *
 * Zelfde aanpak als lib/meta/objective-breakdown.ts: optelbare grootheden sommeren, verhoudingen
 * met optelbare componenten herberekenen uit de sommen (niet middelen over dagen), en de paar
 * derived-only metrics (cost_per_engagement, cost_per_view, cost_per_conversion) rechtstreeks
 * uit spend/totaal afleiden -- in linkedin_campaign_daily staan die niet als losse kolom, maar
 * de componenten waaruit ze bestaan wel.
 */

import { detectLinkedInObjective, type LinkedInObjective, OBJECTIVE_LABELS } from "./campaign-types";

export interface LinkedInObjectiveDailyRow {
  entityUrn: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  landingPageClicks: number;
  oneClickLeadFormOpens: number;
  oneClickLeads: number;
  externalWebsiteConversions: number;
  postClickConversions: number;
  conversionValue: number;
  cpl: number;
  formCompletionRate: number;
  videoStarts: number;
  videoViews: number;
  videoCompletions: number;
  videoCompletionRate: number;
  totalEngagements: number;
  follows: number;
  reactions: number;
  comments: number;
  shares: number;
}

export interface LinkedInCampaignMeta {
  urn: string;
  name: string;
  objectiveType: string | null;
}

export interface ObjectiveCampaignSummary {
  urn: string;
  name: string;
  spend: number;
  primaryValue: number;
}

export interface LinkedInObjectiveGroup {
  objective: LinkedInObjective;
  label: string;
  campaigns: ObjectiveCampaignSummary[];
  spend: number;
  metrics: Record<string, number | null>;
}

function sum(rows: LinkedInObjectiveDailyRow[], pick: (r: LinkedInObjectiveDailyRow) => number): number {
  return rows.reduce((t, r) => t + (Number.isFinite(pick(r)) ? pick(r) : 0), 0);
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

function computeMetrics(rows: LinkedInObjectiveDailyRow[]): Record<string, number | null> {
  const spend = sum(rows, (r) => r.spend);
  const impressions = sum(rows, (r) => r.impressions);
  const clicks = sum(rows, (r) => r.clicks);
  const landingPageClicks = sum(rows, (r) => r.landingPageClicks);
  const oneClickLeads = sum(rows, (r) => r.oneClickLeads);
  const oneClickLeadFormOpens = sum(rows, (r) => r.oneClickLeadFormOpens);
  const externalWebsiteConversions = sum(rows, (r) => r.externalWebsiteConversions);
  const totalEngagements = sum(rows, (r) => r.totalEngagements);
  const videoViews = sum(rows, (r) => r.videoViews);
  const videoStarts = sum(rows, (r) => r.videoStarts);
  const videoCompletions = sum(rows, (r) => r.videoCompletions);

  return {
    cpm: div(spend, impressions / 1000),
    impressions,
    ctr: div(clicks, impressions),
    total_engagements: totalEngagements,
    reactions: sum(rows, (r) => r.reactions),
    comments: sum(rows, (r) => r.comments),
    shares: sum(rows, (r) => r.shares),
    follows: sum(rows, (r) => r.follows),
    cost_per_engagement: div(spend, totalEngagements),
    clicks,
    cpc: div(spend, clicks),
    landing_page_clicks: landingPageClicks,
    one_click_leads: oneClickLeads,
    cpl: div(spend, oneClickLeads),
    one_click_lead_form_opens: oneClickLeadFormOpens,
    form_completion_rate: div(oneClickLeads, oneClickLeadFormOpens),
    external_website_conversions: externalWebsiteConversions,
    conversion_value: sum(rows, (r) => r.conversionValue),
    post_click_conversions: sum(rows, (r) => r.postClickConversions),
    cost_per_conversion: div(spend, externalWebsiteConversions),
    video_views: videoViews,
    video_completion_rate: div(videoCompletions, videoStarts),
    video_completions: videoCompletions,
    cost_per_view: div(spend, videoViews),
    video_starts_dropoff: div(videoViews, videoStarts),
    // job_applicants/cost_per_applicant hebben geen kolom in dit schema (zie campaign-types.ts) --
    // geen sleutel hier, de UI toont voor die twee de checkInAds-tekst uit de criteria zelf.
  };
}

export function buildLinkedInObjectiveBreakdown(
  campaigns: LinkedInCampaignMeta[],
  daily: (LinkedInObjectiveDailyRow & { campaignUrn: string })[],
): LinkedInObjectiveGroup[] {
  const objectiveByCampaign = new Map<string, LinkedInObjective>();
  for (const c of campaigns) {
    const objective = detectLinkedInObjective(c.objectiveType, c.name);
    if (objective) objectiveByCampaign.set(c.urn, objective);
  }

  const byObjective = new Map<LinkedInObjective, string[]>();
  for (const [urn, objective] of objectiveByCampaign) {
    if (!byObjective.has(objective)) byObjective.set(objective, []);
    byObjective.get(objective)!.push(urn);
  }

  const nameByUrn = new Map(campaigns.map((c) => [c.urn, c.name]));
  const rowsByCampaign = new Map<string, LinkedInObjectiveDailyRow[]>();
  for (const row of daily) {
    if (!rowsByCampaign.has(row.campaignUrn)) rowsByCampaign.set(row.campaignUrn, []);
    rowsByCampaign.get(row.campaignUrn)!.push(row);
  }

  const groups: LinkedInObjectiveGroup[] = [];
  for (const [objective, urns] of byObjective) {
    const rows = urns.flatMap((urn) => rowsByCampaign.get(urn) ?? []);
    const campaignSummaries: ObjectiveCampaignSummary[] = urns.map((urn) => {
      const campRows = rowsByCampaign.get(urn) ?? [];
      return {
        urn,
        name: nameByUrn.get(urn) ?? urn,
        spend: sum(campRows, (r) => r.spend),
        primaryValue: sum(campRows, (r) => r.externalWebsiteConversions) || sum(campRows, (r) => r.oneClickLeads) || sum(campRows, (r) => r.totalEngagements) || sum(campRows, (r) => r.clicks),
      };
    }).sort((a, b) => b.spend - a.spend);

    groups.push({
      objective,
      label: OBJECTIVE_LABELS[objective],
      campaigns: campaignSummaries,
      spend: sum(rows, (r) => r.spend),
      metrics: computeMetrics(rows),
    });
  }

  return groups.sort((a, b) => b.spend - a.spend);
}
