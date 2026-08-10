// Zet ruwe ads_change_history-rijen om naar ChangeEvent[] voor detectExecutionAccountWide.
// Pure classificatie op resource_type, change_type en de JSON-payload, geen IO.
//
// EERLIJKE BEPERKING: Google Ads' CAMPAIGN_CRITERION- en AD_GROUP_CRITERION-resources dekken
// veel meer dan zoekwoorden (IP-blocks, plaatsingen, locaties, apparaten). Alleen rijen met een
// echt keyword-veld in de payload worden als keyword_added/keyword_excluded geclassificeerd; de
// rest blijft ongeclassificeerd (geen ChangeEvent) in plaats van een gok. Live nagemeten op de
// database (10 augustus 2026): van de acht voorkomende resource_type/change_type-combinaties
// zijn CAMPAIGN_BUDGET (budget), CAMPAIGN met een biedveld of status (bid/status_paused) en
// AD_GROUP/AD_GROUP_CRITERION met een status (status_paused) de betrouwbaar herkenbare gevallen.

import type { ChangeEvent } from "./hypothesis-evaluator";

export interface RawChangeHistoryRow {
  resource_type: string | null;
  change_type: string | null;
  campaign_name: string | null;
  change_datetime: string | null;
  old_value: string | null;
  new_value: string | null;
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const BID_VELDEN = [
  "maximizeConversionValue", "maximizeConversions", "targetCpa", "targetRoas",
  "manualCpc", "manualCpm", "biddingStrategyType", "targetSpend",
];

function classificeerType(row: RawChangeHistoryRow): string | null {
  const resourceType = row.resource_type ?? "";
  const changeType = row.change_type ?? "";
  const oud = parseJson(row.old_value);
  const nieuw = parseJson(row.new_value);

  if (resourceType === "CAMPAIGN_BUDGET") {
    const oudBudget = oud?.campaignBudget as Record<string, unknown> | undefined;
    const nieuwBudget = nieuw?.campaignBudget as Record<string, unknown> | undefined;
    if (oudBudget?.amountMicros !== undefined || nieuwBudget?.amountMicros !== undefined) return "budget";
  }

  if (resourceType === "CAMPAIGN") {
    const campagne = (nieuw?.campaign ?? oud?.campaign) as Record<string, unknown> | undefined;
    if (campagne) {
      if (BID_VELDEN.some((v) => v in campagne)) return "bid";
      if (campagne.status === "PAUSED") return "status_paused";
    }
  }

  if (resourceType === "AD_GROUP") {
    const adGroup = (nieuw?.adGroup ?? oud?.adGroup) as Record<string, unknown> | undefined;
    if (adGroup?.status === "PAUSED") return "status_paused";
  }

  if (resourceType === "AD_GROUP_CRITERION") {
    const criterion = (nieuw?.adGroupCriterion ?? oud?.adGroupCriterion) as Record<string, unknown> | undefined;
    if (criterion?.status === "PAUSED") return "status_paused";
  }

  if (resourceType === "CAMPAIGN_CRITERION" || resourceType === "AD_GROUP_CRITERION") {
    const veld = resourceType === "CAMPAIGN_CRITERION" ? "campaignCriterion" : "adGroupCriterion";
    const bron = (changeType === "REMOVE" ? oud : nieuw)?.[veld] as Record<string, unknown> | undefined;
    if (bron && "keyword" in bron && changeType === "CREATE") {
      return bron.negative === true ? "keyword_excluded" : "keyword_added";
    }
  }

  return null;
}

export function classificeerChangeHistory(rows: RawChangeHistoryRow[]): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  for (const row of rows) {
    const type = classificeerType(row);
    if (!type || !row.campaign_name || !row.change_datetime) continue;
    events.push({ type, entity: row.campaign_name, date: row.change_datetime.slice(0, 10) });
  }
  return events;
}
