/**
 * Groepeert Meta-campagnes per objective en rekent de OBJECTIVE_EVAL_CRITERIA-metrics uit
 * lib/meta/campaign-types.ts uit tegen echte data.
 *
 * Twee soorten metrics, verschillend behandeld:
 * - Optelbare grootheden (spend, impressions, conversies, ...) worden gesommeerd over dagen
 *   én over de campagnes van het objective.
 * - Verhoudingen die uit twee optelbare componenten zijn af te leiden (cpm, ctr_link, cpa,
 *   roas, ...) worden NA het optellen herberekend uit de sommen -- niet als gemiddelde van de
 *   dagelijkse verhoudingen, want dat weegt een dag met 10 impressies even zwaar als een dag
 *   met 10.000.
 * - Verhoudingen zonder optelbare componenten in dit schema (frequency, hook_rate, hold_rate,
 *   purchase_roas) krijgen een spend-gewogen gemiddelde: de minst verkeerde benadering zonder
 *   de brondata (bijv. het aantal hooks) apart op te slaan.
 *
 * `reach` is een uitzondering die eerlijk blijft staan als wat hij is: een som over dagen,
 * dus een bovengrens op werkelijk uniek bereik (dezelfde persoon op twee dagen telt twee keer).
 * Meta's eigen periode-bereik zou dat deduperen; die cijfers staan niet in meta_campaign_daily.
 */

import { detectMetaObjective, type MetaObjective, OBJECTIVE_LABELS } from "./campaign-types";

export interface MetaObjectiveDailyRow {
  entityId: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  linkClicks: number;
  cpm: number;
  cpcLink: number;
  ctrLink: number;
  conversions: number;
  conversionValue: number;
  purchaseRoas: number;
  cpa: number;
  roas: number;
  leads: number;
  addToCart: number;
  initiateCheckout: number;
  landingPageViews: number;
  videoThruplay: number;
  postEngagement: number;
  hookRate: number;
  holdRate: number;
}

export interface MetaCampaignMeta {
  id: string;
  name: string;
  objective: string | null;
}

export interface ObjectiveCampaignSummary {
  id: string;
  name: string;
  spend: number;
  conversions: number;
  primaryValue: number;
}

export interface MetaObjectiveGroup {
  objective: MetaObjective;
  label: string;
  campaigns: ObjectiveCampaignSummary[];
  spend: number;
  /** Uitgerekende waarde per metric-key uit OBJECTIVE_EVAL_CRITERIA; null = niet te berekenen. */
  metrics: Record<string, number | null>;
}

function sum(rows: MetaObjectiveDailyRow[], pick: (r: MetaObjectiveDailyRow) => number): number {
  return rows.reduce((t, r) => t + (Number.isFinite(pick(r)) ? pick(r) : 0), 0);
}

function weightedAvg(rows: MetaObjectiveDailyRow[], pick: (r: MetaObjectiveDailyRow) => number): number | null {
  const weighted = rows.filter((r) => r.spend > 0 && Number.isFinite(pick(r)));
  const totalWeight = weighted.reduce((t, r) => t + r.spend, 0);
  if (totalWeight <= 0) return null;
  return weighted.reduce((t, r) => t + pick(r) * r.spend, 0) / totalWeight;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Rekent de volledige metric-set uit voor één groep dagrijen (alle campagnes van één objective). */
function computeMetrics(rows: MetaObjectiveDailyRow[]): Record<string, number | null> {
  const spend = sum(rows, (r) => r.spend);
  const impressions = sum(rows, (r) => r.impressions);
  const linkClicks = sum(rows, (r) => r.linkClicks);
  const conversions = sum(rows, (r) => r.conversions);
  const conversionValue = sum(rows, (r) => r.conversionValue);
  const leads = sum(rows, (r) => r.leads);

  return {
    cpm: div(spend, impressions / 1000),
    reach: sum(rows, (r) => r.reach),
    frequency: weightedAvg(rows, (r) => r.frequency),
    hook_rate: weightedAvg(rows, (r) => r.hookRate),
    hold_rate: weightedAvg(rows, (r) => r.holdRate),
    video_thruplay: sum(rows, (r) => r.videoThruplay),
    ctr_link: div(linkClicks, impressions),
    cpc_link: div(spend, linkClicks),
    link_clicks: linkClicks,
    landing_page_views: sum(rows, (r) => r.landingPageViews),
    post_engagement: sum(rows, (r) => r.postEngagement),
    leads,
    cpa: div(spend, conversions),
    roas: div(conversionValue, spend),
    purchase_roas: weightedAvg(rows, (r) => r.purchaseRoas),
    conversion_value: conversionValue,
    conversions,
    add_to_cart: sum(rows, (r) => r.addToCart),
    initiate_checkout: sum(rows, (r) => r.initiateCheckout),
  };
}

/**
 * Groepeert per objective en rekent per groep de metrics uit. Alleen objectives met minstens
 * één campagne komen in de uitkomst -- geen lege tabs met een "niet te berekenen"-bord voor een
 * objective dat deze klant helemaal niet voert.
 */
export function buildMetaObjectiveBreakdown(
  campaigns: MetaCampaignMeta[],
  daily: (MetaObjectiveDailyRow & { campaignId: string })[],
): MetaObjectiveGroup[] {
  const objectiveByCampaign = new Map<string, MetaObjective>();
  for (const c of campaigns) {
    const objective = detectMetaObjective(c.objective, c.name);
    if (objective) objectiveByCampaign.set(c.id, objective);
  }

  const byObjective = new Map<MetaObjective, string[]>();
  for (const [campaignId, objective] of objectiveByCampaign) {
    if (!byObjective.has(objective)) byObjective.set(objective, []);
    byObjective.get(objective)!.push(campaignId);
  }

  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const rowsByCampaign = new Map<string, MetaObjectiveDailyRow[]>();
  for (const row of daily) {
    if (!rowsByCampaign.has(row.campaignId)) rowsByCampaign.set(row.campaignId, []);
    rowsByCampaign.get(row.campaignId)!.push(row);
  }

  const groups: MetaObjectiveGroup[] = [];
  for (const [objective, campaignIds] of byObjective) {
    const rows = campaignIds.flatMap((id) => rowsByCampaign.get(id) ?? []);
    const campaignSummaries: ObjectiveCampaignSummary[] = campaignIds.map((id) => {
      const campRows = rowsByCampaign.get(id) ?? [];
      return {
        id,
        name: nameById.get(id) ?? id,
        spend: sum(campRows, (r) => r.spend),
        conversions: sum(campRows, (r) => r.conversions),
        primaryValue: sum(campRows, (r) => r.conversions) || sum(campRows, (r) => r.leads) || sum(campRows, (r) => r.linkClicks),
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
