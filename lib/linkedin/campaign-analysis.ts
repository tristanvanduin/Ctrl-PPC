/**
 * LinkedIn Campaign Analysis Engine.
 *
 * Zelfde rol als lib/meta/campaign-analysis.ts, eigen vorm: LinkedIn's objectives zijn nog
 * heterogener dan Meta's (een cost-per-lead, een cost-per-view en "job applicants" waar
 * momenteel geen kolom voor bestaat staan alle drie in dezelfde enum), dus ook hier wordt een
 * baseline alleen BINNEN hetzelfde objective berekend, nooit over het account heen.
 *
 * Consumeert lib/linkedin/campaign-types.ts. Zelf nog geen consument (net als
 * lib/campaign-analysis.ts voor Google en lib/meta/campaign-analysis.ts) -- zie
 * TOEGESTANE_WEZEN in scripts/check-hygiene.mjs en masterplan sectie 16.3.
 */

import {
  type LinkedInObjective,
  OBJECTIVE_LABELS,
  OBJECTIVE_EVAL_CRITERIA,
  getObjectiveFocus,
} from "./campaign-types";
import { trendOver } from "../analysis/trend";
import { formatPercent } from "../forecast-format";

// ── Input-vorm ───────────────────────────────────────────────────────────────

export interface LinkedInCampaignMonthlyMetrics {
  month: number; // 1-12
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  cpm: number;
  landingPageClicks: number;
  oneClickLeadFormOpens: number;
  oneClickLeads: number;
  externalWebsiteConversions: number;
  conversionValue: number;
  cpl: number;
  formCompletionRate: number;
  videoStarts: number;
  videoViews: number;
  videoCompletions: number;
  videoCompletionRate: number;
  totalEngagements: number;
}

export interface LinkedInCampaignData {
  campaignUrn: string;
  campaignName: string;
  objective: LinkedInObjective;
  status: "ACTIVE" | "PAUSED";
  monthly: LinkedInCampaignMonthlyMetrics[];
}

export interface ClientLinkedInCampaignData {
  clientId: string;
  campaigns: LinkedInCampaignData[];
}

// ── Finding-types ────────────────────────────────────────────────────────────

export type LinkedInFindingSeverity = "critical" | "warning" | "positive" | "info";

export type LinkedInFindingCategory =
  | "cpm-inefficiency"
  | "cpc-issue"
  | "cpl-issue"
  | "form-dropoff"
  | "conversion-dropoff"
  | "video-completion-weak"
  | "engagement-decline"
  | "volume-drop"
  | "declining";

export interface LinkedInFinding {
  severity: LinkedInFindingSeverity;
  category: LinkedInFindingCategory;
  campaignName: string;
  objective: LinkedInObjective;
  objectiveLabel: string;
  description: string;
  action: string;
  impactScore: number;
}

export interface ManualCheck {
  campaignName: string;
  objective: LinkedInObjective;
  objectiveLabel: string;
  metric: string;
  label: string;
  why: string;
  howToCheck: string;
}

export interface LinkedInCampaignSummary {
  name: string;
  objective: LinkedInObjective;
  objectiveLabel: string;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalLeads: number;
  totalConversions: number;
  avgCpm: number;
  avgCpc: number;
  avgCtr: number;
  avgCpl: number;
  avgFormCompletionRate: number;
  avgVideoCompletionRate: number;
  spendShare: number;
  spendTrend: number;
  clicksTrend: number;
  leadsTrend: number;
  conversionTrend: number;
  engagementTrend: number;
}

export interface LinkedInAccountAnalysis {
  findings: LinkedInFinding[];
  manualChecks: ManualCheck[];
  topSpenders: LinkedInCampaignSummary[];
  accountTotals: { totalSpend: number; totalImpressions: number; totalClicks: number };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
function pct(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
}
const pct1 = (v: number): string => formatPercent(v, 1);

function avg(values: number[]): number {
  const nonZero = values.filter((v) => v > 0);
  return nonZero.length > 0 ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;
}

export function summarizeLinkedInCampaign(campaign: LinkedInCampaignData, totalSpend: number): LinkedInCampaignSummary {
  const months = campaign.monthly;
  const spend = months.reduce((s, m) => s + m.spend, 0);
  const impressions = months.reduce((s, m) => s + m.impressions, 0);
  const clicks = months.reduce((s, m) => s + m.clicks, 0);
  const leads = months.reduce((s, m) => s + m.oneClickLeads, 0);
  const conversions = months.reduce((s, m) => s + m.externalWebsiteConversions, 0);

  return {
    name: campaign.campaignName,
    objective: campaign.objective,
    objectiveLabel: OBJECTIVE_LABELS[campaign.objective],
    totalSpend: spend,
    totalImpressions: impressions,
    totalClicks: clicks,
    totalLeads: leads,
    totalConversions: conversions,
    avgCpm: avg(months.map((m) => m.cpm)),
    avgCpc: avg(months.map((m) => m.cpc)),
    avgCtr: avg(months.map((m) => m.ctr)),
    avgCpl: avg(months.map((m) => m.cpl)),
    avgFormCompletionRate: avg(months.map((m) => m.formCompletionRate)),
    avgVideoCompletionRate: avg(months.map((m) => m.videoCompletionRate)),
    spendShare: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
    spendTrend: trendOver(months.map((m) => m.spend)),
    clicksTrend: trendOver(months.map((m) => m.clicks)),
    leadsTrend: trendOver(months.map((m) => m.oneClickLeads)),
    conversionTrend: trendOver(months.map((m) => m.externalWebsiteConversions)),
    engagementTrend: trendOver(months.map((m) => m.totalEngagements)),
  };
}

// ── Main analysis ────────────────────────────────────────────────────────────

export function analyzeLinkedInCampaigns(campaignData: ClientLinkedInCampaignData): LinkedInAccountAnalysis {
  const campaigns = campaignData.campaigns.filter((c) => c.status === "ACTIVE");
  const totalSpend = campaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.spend, 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.impressions, 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.clicks, 0), 0);

  const summaries = campaigns.map((c) => summarizeLinkedInCampaign(c, totalSpend));
  const topSpenders = [...summaries].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);

  // Baseline per objective, zelfde reden als in lib/meta/campaign-analysis.ts.
  const cplByObjective = avg(summaries.filter((s) => s.objective === "LEAD_GENERATION").map((s) => s.avgCpl));

  const findings: LinkedInFinding[] = [];
  const manualChecks: ManualCheck[] = [];

  for (const campaign of campaigns) {
    const s = summarizeLinkedInCampaign(campaign, totalSpend);
    const months = campaign.monthly;
    if (months.length < 2) continue;
    const objective = campaign.objective;
    const objectiveLabel = OBJECTIVE_LABELS[objective];
    const criteria = OBJECTIVE_EVAL_CRITERIA[objective];

    for (const criterion of criteria) {
      if (!criterion.available && criterion.checkInAds) {
        manualChecks.push({
          campaignName: campaign.campaignName, objective, objectiveLabel,
          metric: criterion.metric, label: criterion.label, why: criterion.why, howToCheck: criterion.checkInAds,
        });
      }
    }

    // ── CPM (bekendheid) ──
    if (objective === "BRAND_AWARENESS" && s.avgCpm > 40) {
      findings.push({
        severity: s.avgCpm > 70 ? "warning" : "info",
        category: "cpm-inefficiency", campaignName: s.name, objective, objectiveLabel,
        description: `CPM van ${fmt(s.avgCpm)} is hoog — LinkedIn's zakelijke doelgroepen zijn duurder dan op consumentenkanalen, maar dit is boven het gebruikelijke bereik.`,
        action: "Verbreed de doelgroep (job function/seniority) of test een breder targetingsegment.",
        impactScore: s.avgCpm * s.spendShare * 0.3,
      });
    }

    // ── CPC (websitebezoek) ──
    if (objective === "WEBSITE_VISITS" && s.spendTrend > 0 && s.clicksTrend < 0) {
      findings.push({
        severity: "info",
        category: "cpc-issue", campaignName: s.name, objective, objectiveLabel,
        description: `Besteding stijgt terwijl paginakliks dalen — duurdere kliks voor hetzelfde resultaat.`,
        action: "Check of de doelgroep uitgeput raakt (kleine LinkedIn-doelgroepen verzadigen sneller dan op Meta) en verbreed indien nodig.",
        impactScore: s.spendShare * 0.3,
      });
    }

    // ── CPL-issue (leadgeneratie) ──
    if (objective === "LEAD_GENERATION" && s.avgCpl > 0 && cplByObjective > 0) {
      if (s.avgCpl > cplByObjective * 1.5 && s.totalSpend > totalSpend * 0.05) {
        findings.push({
          severity: s.avgCpl > cplByObjective * 2 ? "critical" : "warning",
          category: "cpl-issue", campaignName: s.name, objective, objectiveLabel,
          description: `Kosten per lead ${fmt(s.avgCpl)} vs. gemiddelde ${fmt(cplByObjective)} voor Leadgeneratie-campagnes.`,
          action: "Check formulier-voltooiingspercentage — vaak zit het probleem in het formulier (te lang, te veel velden), niet in de targeting.",
          impactScore: (s.avgCpl - cplByObjective) * s.totalLeads,
        });
      }
      // ── Formulier drop-off ──
      if (s.avgFormCompletionRate > 0 && s.avgFormCompletionRate < 0.2) {
        findings.push({
          severity: s.avgFormCompletionRate < 0.1 ? "warning" : "info",
          category: "form-dropoff", campaignName: s.name, objective, objectiveLabel,
          description: `Formulier-voltooiingspercentage ${pct1(s.avgFormCompletionRate)} — veel geopende formulieren worden niet afgemaakt.`,
          action: "Kort het formulier in tot alleen essentiele velden, of maak het aanbod concreter zichtbaar vóór het formulier wordt geopend.",
          impactScore: (0.2 - s.avgFormCompletionRate) * s.totalSpend,
        });
      }
    }

    // ── Conversie-dropoff (websiteconversies) ──
    if (objective === "WEBSITE_CONVERSIONS") {
      const clicksTotal = months.reduce((sum, m) => sum + m.landingPageClicks, 0);
      const convTotal = months.reduce((sum, m) => sum + m.externalWebsiteConversions, 0);
      if (clicksTotal > 0 && convTotal > 0 && convTotal / clicksTotal < 0.02) {
        findings.push({
          severity: "info",
          category: "conversion-dropoff", campaignName: s.name, objective, objectiveLabel,
          description: `Slechts ${pct1(convTotal / clicksTotal)} van paginakliks leidt tot een conversie.`,
          action: "Check de landingspagina (laadtijd, aanbod-duidelijkheid) en de conversietracking zelf voordat de targeting wordt bijgesteld.",
          impactScore: (clicksTotal - convTotal) * 0.3,
        });
      }
      if (s.conversionTrend < -20 && s.totalSpend > totalSpend * 0.05) {
        findings.push({
          severity: s.conversionTrend < -35 ? "warning" : "info",
          category: "declining", campaignName: s.name, objective, objectiveLabel,
          description: `Websiteconversies dalen ${pct(s.conversionTrend)}.`,
          action: `Analyseer: ${getObjectiveFocus(objective)}.`,
          impactScore: Math.abs(s.conversionTrend) * s.spendShare,
        });
      }
    }

    // ── Video-voltooiing (video-views) ──
    if (objective === "VIDEO_VIEWS" && s.avgVideoCompletionRate > 0 && s.avgVideoCompletionRate < 0.15) {
      findings.push({
        severity: s.avgVideoCompletionRate < 0.08 ? "warning" : "info",
        category: "video-completion-weak", campaignName: s.name, objective, objectiveLabel,
        description: `Video-voltooiingspercentage ${pct1(s.avgVideoCompletionRate)} — de meeste kijkers haken vroeg af.`,
        action: "Verkort de video of verplaats de kernboodschap naar de eerste 5 seconden.",
        impactScore: (0.15 - s.avgVideoCompletionRate) * s.totalSpend,
      });
    }

    // ── Interactie-daling ──
    if (objective === "ENGAGEMENT" && s.engagementTrend < -20) {
      findings.push({
        severity: "warning",
        category: "engagement-decline", campaignName: s.name, objective, objectiveLabel,
        description: `Interacties dalen ${pct(s.engagementTrend)}.`,
        action: "Ververs de content; dezelfde doelgroep zag de post-boosts te vaak.",
        impactScore: Math.abs(s.engagementTrend) * s.spendShare,
      });
    }

    // ── Volumedaling (breed) ──
    if (trendOver(months.map((m) => m.impressions)) < -20 && s.totalImpressions > 1000) {
      findings.push({
        severity: "info",
        category: "volume-drop", campaignName: s.name, objective, objectiveLabel,
        description: `Vertoningen dalen — LinkedIn's kleinere doelgroepen raken sneller uitgeput dan op Meta.`,
        action: `Focus op: ${getObjectiveFocus(objective)}.`,
        impactScore: s.spendShare * 0.4,
      });
    }
  }

  const seen = new Map<string, LinkedInFinding>();
  for (const f of findings) {
    const key = `${f.campaignName}|${f.category}`;
    const existing = seen.get(key);
    if (!existing || f.impactScore > existing.impactScore) seen.set(key, f);
  }
  const deduped = Array.from(seen.values()).sort((a, b) => b.impactScore - a.impactScore);

  const seenChecks = new Set<string>();
  const uniqueChecks = manualChecks.filter((c) => {
    const key = `${c.campaignName}|${c.metric}`;
    if (seenChecks.has(key)) return false;
    seenChecks.add(key);
    return true;
  });

  return {
    findings: deduped,
    manualChecks: uniqueChecks,
    topSpenders,
    accountTotals: { totalSpend, totalImpressions, totalClicks },
  };
}
