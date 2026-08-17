/**
 * Meta Campaign Analysis Engine.
 *
 * Het Meta-equivalent van lib/campaign-analysis.ts (Google), maar geen kopie: Meta's
 * objectives zijn onderling minder vergelijkbaar dan Google's purposes. Een cost-per-lead
 * en een cost-per-purchase zijn geen twee punten op dezelfde schaal, dus dit bestand
 * middelt CPA/ROAS alleen BINNEN hetzelfde objective (avgCpaPerObjective), nooit over het
 * hele account heen zoals Google's avgCpaNonBrand dat wel mag (daar is "generic"/"category"/
 * "shopping" wél onderling vergelijkbaar — allemaal omzet-gedreven acquisitie).
 *
 * Consumeert lib/meta/campaign-types.ts (objective-taxonomie + eval-criteria). Zelf nog geen
 * consument (net als lib/campaign-analysis.ts voor Google) -- zie TOEGESTANE_WEZEN in
 * scripts/check-hygiene.mjs en masterplan sectie 16.3.
 */

import {
  type MetaObjective,
  OBJECTIVE_LABELS,
  OBJECTIVE_EVAL_CRITERIA,
  isRoasRelevant,
  getObjectiveFocus,
} from "./campaign-types";
import { trendOver } from "../analysis/trend";
import { formatPercent } from "../forecast-format";

// ── Input-vorm ───────────────────────────────────────────────────────────────

export interface MetaCampaignMonthlyMetrics {
  month: number; // 1-12
  impressions: number;
  reach: number;
  frequency: number;
  linkClicks: number;
  spend: number;
  cpm: number;
  cpcLink: number;
  ctrLink: number;
  conversions: number;
  conversionValue: number;
  purchaseRoas: number;
  cpa: number;
  leads: number;
  addToCart: number;
  initiateCheckout: number;
  landingPageViews: number;
  videoThruplay: number;
  hookRate: number;
  holdRate: number;
  postEngagement: number;
}

export interface MetaCampaignData {
  campaignId: string;
  campaignName: string;
  objective: MetaObjective;
  status: "ACTIVE" | "PAUSED";
  monthly: MetaCampaignMonthlyMetrics[];
}

export interface ClientMetaCampaignData {
  clientId: string;
  campaigns: MetaCampaignData[];
}

// ── Finding-types ────────────────────────────────────────────────────────────

export type MetaFindingSeverity = "critical" | "warning" | "positive" | "info";

export type MetaFindingCategory =
  | "cpm-inefficiency"
  | "frequency-fatigue"
  | "hook-weak"
  | "ctr-issue"
  | "ctr-fatigue"
  | "cpc-rising"
  | "roas-bleeder"
  | "cpl-issue"
  | "funnel-dropoff"
  | "engagement-decline"
  | "volume-drop"
  | "declining";

export interface MetaFinding {
  severity: MetaFindingSeverity;
  category: MetaFindingCategory;
  campaignName: string;
  objective: MetaObjective;
  objectiveLabel: string;
  description: string;
  action: string;
  impactScore: number;
}

export interface ManualCheck {
  campaignName: string;
  objective: MetaObjective;
  objectiveLabel: string;
  metric: string;
  label: string;
  why: string;
  howToCheck: string;
}

export interface MetaCampaignSummary {
  name: string;
  objective: MetaObjective;
  objectiveLabel: string;
  totalSpend: number;
  totalImpressions: number;
  totalLinkClicks: number;
  totalConversions: number;
  totalLeads: number;
  avgCpm: number;
  avgCtrLink: number;
  /** Meest recente maand, niet gemiddeld — verzadiging is een huidige toestand, geen jaargemiddelde. */
  recentFrequency: number;
  /** Meest recente maand, zelfde reden als recentFrequency. */
  recentHookRate: number;
  avgPurchaseRoas: number;
  avgCpa: number | null;
  spendShare: number;
  spendTrend: number;
  cpmTrend: number;
  ctrTrend: number;
  frequencyTrend: number;
  conversionTrend: number;
  hookTrend: number;
  postEngagementTrend: number;
}

export interface MetaAccountAnalysis {
  findings: MetaFinding[];
  manualChecks: ManualCheck[];
  topSpenders: MetaCampaignSummary[];
  accountTotals: { totalSpend: number; totalImpressions: number; totalLinkClicks: number };
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

export function summarizeMetaCampaign(campaign: MetaCampaignData, totalSpend: number): MetaCampaignSummary {
  const months = campaign.monthly;
  const spend = months.reduce((s, m) => s + m.spend, 0);
  const impressions = months.reduce((s, m) => s + m.impressions, 0);
  const linkClicks = months.reduce((s, m) => s + m.linkClicks, 0);
  const conversions = months.reduce((s, m) => s + m.conversions, 0);
  const leads = months.reduce((s, m) => s + m.leads, 0);
  const latest = months[months.length - 1];

  return {
    name: campaign.campaignName,
    objective: campaign.objective,
    objectiveLabel: OBJECTIVE_LABELS[campaign.objective],
    totalSpend: spend,
    totalImpressions: impressions,
    totalLinkClicks: linkClicks,
    totalConversions: conversions,
    totalLeads: leads,
    avgCpm: avg(months.map((m) => m.cpm)),
    avgCtrLink: avg(months.map((m) => m.ctrLink)),
    recentFrequency: latest?.frequency ?? 0,
    recentHookRate: latest?.hookRate ?? 0,
    avgPurchaseRoas: avg(months.map((m) => m.purchaseRoas)),
    // Null bij geen conversies -- zelfde reden als Google's campaign-analysis.ts: een dure CPA
    // is iets anders dan een afwezige, en die twee door elkaar halen verstopt precies de
    // campagnes die de meeste aandacht nodig hebben.
    avgCpa: conversions > 0 ? spend / conversions : null,
    spendShare: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
    spendTrend: trendOver(months.map((m) => m.spend)),
    cpmTrend: trendOver(months.map((m) => m.cpm)),
    ctrTrend: trendOver(months.map((m) => m.ctrLink)),
    frequencyTrend: trendOver(months.map((m) => m.frequency)),
    conversionTrend: trendOver(months.map((m) => m.conversions)),
    hookTrend: trendOver(months.map((m) => m.hookRate)),
    postEngagementTrend: trendOver(months.map((m) => m.postEngagement)),
  };
}

// ── Main analysis ────────────────────────────────────────────────────────────

export function analyzeMetaCampaigns(campaignData: ClientMetaCampaignData): MetaAccountAnalysis {
  const campaigns = campaignData.campaigns.filter((c) => c.status === "ACTIVE");
  const totalSpend = campaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.spend, 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.impressions, 0), 0);
  const totalLinkClicks = campaigns.reduce((s, c) => s + c.monthly.reduce((ms, m) => ms + m.linkClicks, 0), 0);

  const summaries = campaigns.map((c) => summarizeMetaCampaign(c, totalSpend));
  const topSpenders = [...summaries].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);

  // Baseline per objective, niet over het hele account -- zie de toelichting bovenaan het
  // bestand over waarom een cost-per-lead en een cost-per-purchase niet gemiddeld mogen worden.
  const cpaByObjective = new Map<MetaObjective, number>();
  for (const objective of new Set(summaries.map((s) => s.objective))) {
    const inObjective = summaries.filter((s) => s.objective === objective && s.avgCpa !== null);
    const spendSum = inObjective.reduce((s, c) => s + c.totalSpend, 0);
    const convSum = inObjective.reduce((s, c) => s + c.totalConversions, 0);
    if (convSum > 0) cpaByObjective.set(objective, spendSum / convSum);
  }

  const findings: MetaFinding[] = [];
  const manualChecks: ManualCheck[] = [];

  for (const campaign of campaigns) {
    const s = summarizeMetaCampaign(campaign, totalSpend);
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

    // ── CPM-efficiency (bekendheid/interactie) ──
    if ((objective === "OUTCOME_AWARENESS" || objective === "OUTCOME_ENGAGEMENT") && s.avgCpm > 15) {
      findings.push({
        severity: s.avgCpm > 25 ? "warning" : "info",
        category: "cpm-inefficiency", campaignName: s.name, objective, objectiveLabel,
        description: `CPM van ${fmt(s.avgCpm)} is hoog voor ${objectiveLabel.toLowerCase()}.`,
        action: "Verbreed doelgroep, test andere plaatsingen, of verlaag biedingen. Vergelijk met branche-benchmark.",
        impactScore: s.avgCpm * s.totalSpend / 1000,
      });
    }

    // ── Frequentie-verzadiging (bekendheid/interactie/verkoop-retargeting) ──
    // Op de MEEST RECENTE maand, niet een gemiddelde: een spike in de lopende maand die door
    // eerdere, lagere maanden wordt weggemiddeld is precies de verzadiging die deze check moet
    // vangen, niet verhullen.
    if (s.recentFrequency > 5) {
      findings.push({
        severity: s.recentFrequency > 8 ? "warning" : "info",
        category: "frequency-fatigue", campaignName: s.name, objective, objectiveLabel,
        description: `Frequentie ${s.recentFrequency.toFixed(1)}x deze maand — dezelfde mensen zien de ad herhaaldelijk in plaats van dat er nieuw bereik bijkomt.`,
        action: "Verbreed de doelgroep of ververs de creative; frequentie boven de 5-8x per maand is geld dat aan bekende kijkers wordt herhaald.",
        impactScore: s.recentFrequency * s.spendShare,
      });
    }

    // ── Hook-rate (video-zware objectives) ──
    if ((objective === "OUTCOME_AWARENESS" || objective === "OUTCOME_ENGAGEMENT") && s.recentHookRate > 0 && s.recentHookRate < 0.15) {
      findings.push({
        severity: s.recentHookRate < 0.08 ? "warning" : "info",
        category: "hook-weak", campaignName: s.name, objective, objectiveLabel,
        description: `Hook rate ${pct1(s.recentHookRate)} deze maand — de eerste drie seconden grijpen niet vast, ongeacht de rest van de creative.`,
        action: "Test een andere opening: directe vraag, beweging in het eerste frame, of een ander eerste shot.",
        impactScore: (0.15 - s.recentHookRate) * s.totalSpend,
      });
    }

    // ── CTR (link) ──
    if (s.avgCtrLink > 0 && s.avgCtrLink < 0.008 && s.totalImpressions > 500) {
      findings.push({
        severity: s.avgCtrLink < 0.004 ? "warning" : "info",
        category: "ctr-issue", campaignName: s.name, objective, objectiveLabel,
        description: `CTR van ${pct1(s.avgCtrLink)} is laag voor ${objectiveLabel.toLowerCase()}.`,
        action: "Creative sluit niet aan op de doelgroep. Test nieuwe visuals of copy.",
        impactScore: s.totalSpend * (0.008 - s.avgCtrLink) / 0.008,
      });
    }
    if (s.ctrTrend < -15 && s.totalImpressions > 500) {
      findings.push({
        severity: "info",
        category: "ctr-fatigue", campaignName: s.name, objective, objectiveLabel,
        description: `CTR daalt ${pct(s.ctrTrend)} — creative-vermoeidheid.`,
        action: "Ververs de creative-set; dalende CTR bij gelijkblijvende targeting is bijna altijd een creative-signaal, geen targeting-signaal.",
        impactScore: Math.abs(s.ctrTrend) * s.spendShare * 0.5,
      });
    }

    // ── CPC (verkeer) stijgend ──
    if (objective === "OUTCOME_TRAFFIC" && s.spendTrend > 0 && s.ctrTrend < 0) {
      findings.push({
        severity: "info",
        category: "cpc-rising", campaignName: s.name, objective, objectiveLabel,
        description: `Besteding stijgt terwijl CTR daalt (${pct(s.ctrTrend)}) — duidere klikken voor hetzelfde resultaat.`,
        action: "Check kwaliteitsclassificatie in Ads Manager; een lagere klassering duwt de kosten per klik omhoog los van de bieding.",
        impactScore: s.spendShare * Math.abs(s.ctrTrend) * 0.3,
      });
    }

    // ── ROAS-bleeder (verkoop) ──
    if (objective === "OUTCOME_SALES" && isRoasRelevant(objective)) {
      const accountRoas = avg(summaries.filter((x) => x.objective === "OUTCOME_SALES").map((x) => x.avgPurchaseRoas));
      if (accountRoas > 0 && s.avgPurchaseRoas < accountRoas * 0.7 && s.totalSpend > totalSpend * 0.05) {
        findings.push({
          severity: s.avgPurchaseRoas < accountRoas * 0.4 ? "critical" : "warning",
          category: "roas-bleeder", campaignName: s.name, objective, objectiveLabel,
          description: `Purchase ROAS ${s.avgPurchaseRoas.toFixed(2)} vs. gemiddelde ${accountRoas.toFixed(2)} voor Verkoop-campagnes. ${fmt(s.totalSpend)} besteed (${Math.round(s.spendShare)}%).`,
          action: "Verlaag budget of pauzeer, tenzij de funnel-cijfers (add_to_cart/initiate_checkout) een tijdelijke oorzaak laten zien.",
          impactScore: s.totalSpend * (1 - s.avgPurchaseRoas / Math.max(accountRoas, 0.1)),
        });
      }
    }

    // ── CPL-issue (leads) ──
    if (objective === "OUTCOME_LEADS" && s.avgCpa !== null) {
      const baseline = cpaByObjective.get("OUTCOME_LEADS");
      if (baseline && s.avgCpa > baseline * 1.5 && s.totalSpend > totalSpend * 0.05) {
        findings.push({
          severity: s.avgCpa > baseline * 2 ? "critical" : "warning",
          category: "cpl-issue", campaignName: s.name, objective, objectiveLabel,
          description: `Kosten per lead ${fmt(s.avgCpa)} vs. gemiddelde ${fmt(baseline)} voor Leads-campagnes.`,
          action: "Check formulier-voltooiingspercentage in Ads Manager — vaak zit het probleem in het formulier, niet in de targeting.",
          impactScore: (s.avgCpa - baseline) * s.totalConversions,
        });
      }
    }

    // ── Funnel-dropoff (verkoop) ──
    if (objective === "OUTCOME_SALES") {
      const addToCart = months.reduce((sum, m) => sum + m.addToCart, 0);
      const initiateCheckout = months.reduce((sum, m) => sum + m.initiateCheckout, 0);
      const conv = months.reduce((sum, m) => sum + m.conversions, 0);
      if (addToCart > 0 && initiateCheckout > 0 && initiateCheckout / addToCart < 0.4) {
        findings.push({
          severity: "info",
          category: "funnel-dropoff", campaignName: s.name, objective, objectiveLabel,
          description: `Slechts ${pct1(initiateCheckout / addToCart)} van winkelwagens leidt tot een gestarte checkout.`,
          action: "Check verzendkosten, betaalopties en het aantal stappen in het checkoutproces — dit is een sitesignaal, geen advertentiesignaal.",
          impactScore: (addToCart - initiateCheckout) * 0.5,
        });
      }
      if (initiateCheckout > 0 && conv > 0 && conv / initiateCheckout < 0.3) {
        findings.push({
          severity: "info",
          category: "funnel-dropoff", campaignName: s.name, objective, objectiveLabel,
          description: `Slechts ${pct1(conv / initiateCheckout)} van gestarte checkouts wordt afgerond.`,
          action: "Check betaalfouten, verrassingskosten laat in de flow, of een te lang formulier.",
          impactScore: (initiateCheckout - conv) * 0.5,
        });
      }
    }

    // ── Engagement-daling (interactie) ──
    if (objective === "OUTCOME_ENGAGEMENT" && s.postEngagementTrend < -20) {
      findings.push({
        severity: "warning",
        category: "engagement-decline", campaignName: s.name, objective, objectiveLabel,
        description: `Interacties dalen ${pct(s.postEngagementTrend)}.`,
        action: "Ververs de creative-set; interactie-campagnes verslijten sneller dan verkoop-campagnes omdat dezelfde doelgroep herhaaldelijk wordt getarget.",
        impactScore: Math.abs(s.postEngagementTrend) * s.spendShare,
      });
    }

    // ── Volumedaling (breed, alle objectives) ──
    if (trendOver(months.map((m) => m.impressions)) < -20 && s.totalImpressions > 1000) {
      findings.push({
        severity: "info",
        category: "volume-drop", campaignName: s.name, objective, objectiveLabel,
        description: `Vertoningen dalen — budget te laag, doelgroep uitgeput, of markt krimpt.`,
        action: `Focus op: ${getObjectiveFocus(objective)}.`,
        impactScore: s.spendShare * 0.4,
      });
    }

    // ── Conversietrend-daling (breed) ──
    if (s.conversionTrend < -20 && s.totalSpend > totalSpend * 0.03) {
      findings.push({
        severity: s.conversionTrend < -35 && s.spendShare > 10 ? "critical" : "warning",
        category: "declining", campaignName: s.name, objective, objectiveLabel,
        description: `Conversies dalen ${pct(s.conversionTrend)}. ${Math.round(s.spendShare)}% van het budget.`,
        action: `Analyseer: ${getObjectiveFocus(objective)}.`,
        impactScore: Math.abs(s.conversionTrend) * s.spendShare,
      });
    }
  }

  // Dedupliceer op campagne+categorie, hoogste impact wint.
  const seen = new Map<string, MetaFinding>();
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
    accountTotals: { totalSpend, totalImpressions, totalLinkClicks },
  };
}

