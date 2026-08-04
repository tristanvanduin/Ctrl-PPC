/**
 * Typed query helpers for dimensional tables.
 *
 * Each function fetches data from a specific dimensional table
 * and returns typed results. These are the building blocks for
 * later analysis code to consume dimensional data safely.
 *
 * All functions:
 * - Accept supabase client, clientId, and optional date range
 * - Return typed arrays (empty on error or no data)
 * - Are safe to call even if the table is empty
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KeywordPerformanceMonthly,
  SearchTermMonthly,
  ProductPerformanceMonthly,
  DevicePerformanceMonthly,
  GeoPerformanceMonthly,
  NetworkPerformanceMonthly,
  CreativePerformance,
  AssetGroupPerformanceMonthly,
  AudiencePerformanceMonthly,
  AdSchedulePerformance,
} from "../types/dimensional";

// ── Shared types ───────────────────────────────────────────────────────────

interface DateRange {
  startMonth?: string;  // YYYY-MM-DD, first of month
  endMonth?: string;    // YYYY-MM-DD, first of month
}

// ── Query helpers ──────────────────────────────────────────────────────────

export async function fetchKeywordPerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { limit?: number }
): Promise<KeywordPerformanceMonthly[]> {
  let query = supabase
    .from("ads_keyword_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data } = await query;
  return (data ?? []) as KeywordPerformanceMonthly[];
}

export async function fetchSearchTermsMonthly(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { limit?: number; minClicks?: number }
): Promise<SearchTermMonthly[]> {
  let query = supabase
    .from("ads_search_terms_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.minClicks) query = query.gte("clicks", opts.minClicks);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data } = await query;
  return (data ?? []) as SearchTermMonthly[];
}

export async function fetchProductPerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { limit?: number; campaignType?: string }
): Promise<ProductPerformanceMonthly[]> {
  let query = supabase
    .from("ads_product_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.campaignType) query = query.eq("campaign_type", opts.campaignType);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data } = await query;
  return (data ?? []) as ProductPerformanceMonthly[];
}

export async function fetchDevicePerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { level?: "account" | "campaign" }
): Promise<DevicePerformanceMonthly[]> {
  let query = supabase
    .from("ads_device_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("month", { ascending: true });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.level) query = query.eq("level", opts.level);

  const { data } = await query;
  return (data ?? []) as DevicePerformanceMonthly[];
}

export async function fetchGeoPerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { limit?: number }
): Promise<GeoPerformanceMonthly[]> {
  let query = supabase
    .from("ads_geo_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data } = await query;
  return (data ?? []) as GeoPerformanceMonthly[];
}

export async function fetchNetworkPerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange
): Promise<NetworkPerformanceMonthly[]> {
  let query = supabase
    .from("ads_network_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("month", { ascending: true });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);

  const { data } = await query;
  return (data ?? []) as NetworkPerformanceMonthly[];
}

export async function fetchCreativePerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { limit?: number }
): Promise<CreativePerformance[]> {
  let query = supabase
    .from("ads_creative_performance")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data } = await query;
  return (data ?? []) as CreativePerformance[];
}

export async function fetchAssetGroupPerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange
): Promise<AssetGroupPerformanceMonthly[]> {
  let query = supabase
    .from("ads_asset_group_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);

  const { data } = await query;
  return (data ?? []) as AssetGroupPerformanceMonthly[];
}

export async function fetchAudiencePerformance(
  supabase: SupabaseClient,
  clientId: string,
  opts?: DateRange & { limit?: number }
): Promise<AudiencePerformanceMonthly[]> {
  let query = supabase
    .from("ads_audience_performance_monthly")
    .select("*")
    .eq("client_id", clientId)
    .order("cost", { ascending: false });

  if (opts?.startMonth) query = query.gte("month", opts.startMonth);
  if (opts?.endMonth) query = query.lte("month", opts.endMonth);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data } = await query;
  return (data ?? []) as AudiencePerformanceMonthly[];
}

/**
 * Uurstaat van de laatste dertig dagen.
 *
 * Als enige helper hier GEEN periodefilter, en dat is geen omissie. Deze tabel wordt per sync
 * met replaceBatch geschreven: alle rijen van de klant eruit, de nieuwe momentopname erin. Er
 * staat dus per klant precies één period_start, en een `.gte("period_start", …)` zou filteren op
 * een kolom met één waarde — een controle die niets controleert.
 *
 * Dat het zo blijft is een bewuste keuze, niet een detail dat toevallig zo uitpakt: opeenvolgende
 * periodes van dertig dagen overlappen, dus stapelen zou dubbeltellen. Zie de sectie "Bewust NIET
 * aangeraakt" in scripts/pending-migration-history-accumulation.sql. Verandert dat ooit, dan moet
 * hier een filter op de nieuwste period_start bij — niet een venster, want twee vensters optellen
 * is precies de fout die de tabel nu vermijdt.
 *
 * Wat wél te winnen viel: de kolommen bij naam in plaats van select("*"), zodat id en synced_at
 * niet meereizen.
 */
export async function fetchAdSchedulePerformance(
  supabase: SupabaseClient,
  clientId: string
): Promise<AdSchedulePerformance[]> {
  const { data } = await supabase
    .from("ads_ad_schedule_performance")
    .select("client_id, period_start, period_end, campaign_id, campaign_name, day_of_week, hour_of_day, impressions, clicks, cost, conversions, conversions_value")
    .eq("client_id", clientId)
    .order("day_of_week", { ascending: true })
    .order("hour_of_day", { ascending: true });

  return (data ?? []) as AdSchedulePerformance[];
}
