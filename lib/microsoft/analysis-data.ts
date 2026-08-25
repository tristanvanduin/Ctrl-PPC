// Microsoft data-laag entreepunt: knoopt de microsoft_*-tabellen aan de rekenkern en de facts.
// De mappings van DB-rij naar compute-rij zijn puur en los testbaar; de Supabase-fetch en de
// orkestratie zijn LIVE-ONGETEST (pas met een echt Microsoft-account met API-toegang te
// verifieren -- de syncclient bestaat bewust nog niet, zelfde route als Meta destijds).
// Gespiegeld op de Meta- en LinkedIn-analysis-data.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalMetricMap } from "@/lib/analysis/claim-consistency";
import {
  buildMicrosoftStepFacts,
  type MicrosoftBreakdownRow, type MicrosoftCampaignMeta, type MicrosoftImpressionShareRow,
  type MicrosoftKeywordRow, type MicrosoftPreparedInputs, type MicrosoftProfileRow,
  type MicrosoftSearchTermRow, type MicrosoftStepFacts,
} from "./prepared-facts";
import { buildMicrosoftCanonicalMetricMap } from "./canonical-map";
import type { MicrosoftComputeRow } from "./prepared-compute";

type DbRow = Record<string, unknown>;

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function str(value: unknown): string {
  return value == null ? "" : String(value);
}

// Pure mapping: een microsoft_*_daily rij naar een compute-rij. De naam komt uit de aparte
// entiteit-tabel (microsoft_campaigns/microsoft_adgroups) omdat de daily's die niet dragen --
// zelfde patroon als Meta.
export function mapMicrosoftDailyToComputeRow(row: DbRow, name?: string | null): MicrosoftComputeRow {
  return {
    date: row.date == null ? null : String(row.date),
    entityId: row.entity_id == null ? null : String(row.entity_id),
    entityName: name ?? null,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    spend: num(row.spend),
    conversions: num(row.conversions),
    conversion_value: num(row.conversion_value),
  };
}

export function mapMicrosoftBreakdownToComputeRow(row: DbRow): MicrosoftBreakdownRow {
  return {
    date: row.date == null ? null : String(row.date),
    breakdown_type: str(row.breakdown_type),
    breakdown_value: str(row.breakdown_value),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    spend: num(row.spend),
    conversions: num(row.conversions),
  };
}

export function mapMicrosoftKeywordRow(row: DbRow): MicrosoftKeywordRow {
  return {
    keyword_text: str(row.keyword_text),
    match_type: row.match_type == null ? null : String(row.match_type),
    campaign_name: row.campaign_name == null ? null : String(row.campaign_name),
    ad_group_name: row.ad_group_name == null ? null : String(row.ad_group_name),
    month: str(row.month),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    cost: num(row.cost),
    conversions: num(row.conversions),
    quality_score: numOrNull(row.quality_score),
  };
}

export function mapMicrosoftSearchTermRow(row: DbRow): MicrosoftSearchTermRow {
  return {
    search_term: str(row.search_term),
    campaign_name: row.campaign_name == null ? null : String(row.campaign_name),
    ad_group_name: row.ad_group_name == null ? null : String(row.ad_group_name),
    month: str(row.month),
    clicks: num(row.clicks),
    cost: num(row.cost),
    conversions: num(row.conversions),
  };
}

export function mapMicrosoftImpressionShareRow(row: DbRow): MicrosoftImpressionShareRow {
  return {
    campaign_name: str(row.campaign_name),
    month: str(row.month),
    impression_share: numOrNull(row.impression_share),
    budget_lost_is: numOrNull(row.budget_lost_is),
    rank_lost_is: numOrNull(row.rank_lost_is),
  };
}

export function mapMicrosoftProfileRow(row: DbRow): MicrosoftProfileRow {
  return {
    month: str(row.month),
    pivot_type: str(row.pivot_type),
    pivot_value: str(row.pivot_value),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    spend: num(row.spend),
    conversions: num(row.conversions),
  };
}

export function mapMicrosoftCampaignMetaRow(row: DbRow): MicrosoftCampaignMeta {
  return {
    campaign_id: str(row.campaign_id),
    name: str(row.name),
    campaign_type: row.campaign_type == null ? null : String(row.campaign_type),
    daily_budget: numOrNull(row.daily_budget),
    bid_strategy: row.bid_strategy == null ? null : String(row.bid_strategy),
    import_source: row.import_source == null ? null : String(row.import_source),
    serving_status: row.serving_status == null ? null : String(row.serving_status),
  };
}

// Eerste van de maand, 12 maanden voor de periodEnd-maand: 13 maanden aan maandaggregaten.
// Kanaal-eigen kopie, zelfde vorm als Meta en LinkedIn.
export function thirteenMonthStart(periodEnd: string): string {
  const d = new Date(periodEnd + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 12, 1)).toISOString().slice(0, 10);
}

export interface MicrosoftAnalysisData {
  canonicalMetricMap: CanonicalMetricMap;
  stepFacts: MicrosoftStepFacts;
}

// Losse fetchers, ook voor de weekly- en biweekly-routes (zelfde rol als fetchDaily/fetchNameMap
// in lib/meta/analysis-data.ts). select("*") en niet een dynamische kolomlijst: Supabase's
// template-literal-parser kan een string-interpolatie niet typechecken, en de tabellen zijn per
// klant klein.
export async function fetchMicrosoftDaily(supabase: SupabaseClient, clientId: string, table: string, start: string, end: string): Promise<DbRow[]> {
  const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("date", start).lte("date", end);
  return (data ?? []) as DbRow[];
}

export async function fetchMicrosoftMonthly(supabase: SupabaseClient, clientId: string, table: string, start: string, end: string): Promise<DbRow[]> {
  const { data } = await supabase.from(table).select("*").eq("client_id", clientId).gte("month", start).lte("month", end);
  return (data ?? []) as DbRow[];
}

export async function fetchMicrosoftNameMap(supabase: SupabaseClient, clientId: string, table: string, idColumn: string): Promise<Map<string, string>> {
  const { data } = await supabase.from(table).select("*").eq("client_id", clientId);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as DbRow[]) {
    const id = row[idColumn];
    if (id != null && row.name != null) map.set(String(id), String(row.name));
  }
  return map;
}

export async function buildMicrosoftAnalysisData(
  supabase: SupabaseClient,
  clientId: string,
  periodEnd: string,
  options?: { targets?: MicrosoftPreparedInputs["targets"] }
): Promise<MicrosoftAnalysisData> {
  const start = thirteenMonthStart(periodEnd);

  const fetchDaily = (table: string) => fetchMicrosoftDaily(supabase, clientId, table, start, periodEnd);
  const fetchMonthly = (table: string) => fetchMicrosoftMonthly(supabase, clientId, table, start, periodEnd);
  const fetchNameMap = (table: string, idColumn: string) => fetchMicrosoftNameMap(supabase, clientId, table, idColumn);

  const [
    accountRaw, campaignRaw, adgroupRaw, breakdownRaw,
    keywordRaw, searchTermRaw, impressionShareRaw, profileRaw,
    campaignMetaRaw, campaignNames, adgroupNames,
  ] = await Promise.all([
    fetchDaily("microsoft_account_daily"),
    fetchDaily("microsoft_campaign_daily"),
    fetchDaily("microsoft_adgroup_daily"),
    fetchDaily("microsoft_breakdown_daily"),
    fetchMonthly("microsoft_keyword_monthly"),
    fetchMonthly("microsoft_search_terms_monthly"),
    fetchMonthly("microsoft_campaign_impression_share"),
    fetchMonthly("microsoft_profile_monthly"),
    supabase.from("microsoft_campaigns").select("*").eq("client_id", clientId).then((r) => (r.data ?? []) as DbRow[]),
    fetchNameMap("microsoft_campaigns", "campaign_id"),
    fetchNameMap("microsoft_adgroups", "adgroup_id"),
  ]);

  const account = accountRaw.map((r) => mapMicrosoftDailyToComputeRow(r));
  const campaigns = campaignRaw.map((r) => mapMicrosoftDailyToComputeRow(r, campaignNames.get(String(r.entity_id ?? ""))));
  const adgroups = adgroupRaw.map((r) => mapMicrosoftDailyToComputeRow(r, adgroupNames.get(String(r.entity_id ?? ""))));

  const inputs: MicrosoftPreparedInputs = {
    account,
    campaigns,
    adgroups,
    campaignMeta: campaignMetaRaw.map(mapMicrosoftCampaignMetaRow),
    keywords: keywordRaw.map(mapMicrosoftKeywordRow),
    searchTerms: searchTermRaw.map(mapMicrosoftSearchTermRow),
    impressionShare: impressionShareRaw.map(mapMicrosoftImpressionShareRow),
    breakdowns: breakdownRaw.map(mapMicrosoftBreakdownToComputeRow),
    profile: profileRaw.map(mapMicrosoftProfileRow),
    targets: options?.targets,
  };

  return {
    canonicalMetricMap: buildMicrosoftCanonicalMetricMap(campaigns, account),
    stepFacts: buildMicrosoftStepFacts(inputs),
  };
}
