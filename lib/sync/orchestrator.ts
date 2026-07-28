/**
 * Google Ads → Supabase sync orchestrator.
 *
 * Central sync layer that:
 * - Fetches all required datasets from Google Ads API
 * - Writes them into Supabase tables
 * - Tracks sync status and freshness
 * - Updates dimension availability
 * - Handles partial failures safely
 *
 * Used by:
 * - /api/sync route (manual per-client sync)
 * - CLI backfill script (bulk sync)
 * - Future: scheduled sync
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getCampaignImpressionShareByMonth,
  getAdGroupPerformanceByMonth,
  getWastefulSearchTermsByMonth,
  getChangeHistory,
  getCampaignMetadata,
  getKeywordPerformanceByMonth,
  getSearchTermsByMonth,
  getProductPerformanceByMonth,
  getDevicePerformanceByMonth,
  getGeoPerformanceByMonth,
  getNetworkPerformanceByMonth,
  getCreativePerformanceByMonth,
  getAssetGroupPerformanceByMonth,
  getAudiencePerformanceByMonth,
  getAdSchedulePerformance,
  getCheckoutFunnelByMonth,
  getRsaAssetMetricsByMonth,
  getAdMeta,
  getAdGroupNegatives,
  getCampaignNegatives,
  getSharedSetNegatives,
  getPmaxAssetPerformanceByMonth,
  getPmaxNetworkBreakdownByMonth,
  getPmaxPlacementsByMonth,
  getVideoPlacementsByMonth,
  getPmaxPlacementViewByMonth,
  getPmaxSearchCategoriesByMonth,
  type GoogleAdsCredentials,
} from "../api/google-ads";
import { addYears } from "../analysis/helpers";
import { rsaAssetToDbRow, adMetaToDbRow } from "../api/google-ads-rsa-transform";
// De zoekterm-query splitst rijen per match-type (segments.search_term_match_type); de
// dedup verderop kent dat segment niet en zou een van de rijen weggooien MET zijn metrics.
// Eerst optellen, dan pas dedupliceren.
import { aggregateSearchTermsByMonth } from "../api/google-ads-search-term-aggregate";
import { negativesToDbRows } from "../api/google-ads-negatives-transform";
import { syncMerchantProductSnapshots } from "../api/merchant-products";
import { logger } from "@/lib/logger";
import { withFetchFailures, hasFetchFailure } from "../api/fetch-failures";

// ── Types ──────────────────────────────────────────────────────────────────

export type SyncType = "manual" | "scheduled" | "pre_analysis" | "backfill";
export type SyncStatus = "running" | "success" | "partial" | "failed";

export interface DatasetResult {
  name: string;
  rows: number;
  success: boolean;
  error?: string;
}

export interface SyncResult {
  runId: string | null;
  clientId: string;
  status: SyncStatus;
  startedAt: string;
  finishedAt: string;
  datasetsAttempted: number;
  datasetsSucceeded: number;
  datasetsFailed: number;
  totalRowsWritten: number;
  datasetResults: DatasetResult[];
  dateRangeStart: string;
  dateRangeEnd: string;
  errorSummary: string | null;
}

export interface SyncOptions {
  supabase: SupabaseClient;
  credentials: GoogleAdsCredentials;
  clientId: string;
  customerId: string;
  syncType: SyncType;
  triggeredBy?: string;
  /** Override date range (default: 13 months) */
  startDate?: string;
  endDate?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  // Use local date parts to avoid UTC timezone shift
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getDateRange13Months(): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Go 14 months back to ensure we have 13 complete months + current partial
  const startMonth = now.getMonth() + 1 - 14; // can be negative
  const startYear = now.getFullYear() + Math.floor((startMonth - 1) / 12);
  const startMon = ((startMonth - 1 + 120) % 12) + 1; // normalize to 1-12
  const startDate = `${startYear}-${String(startMon).padStart(2, "0")}-01`;
  return { startDate, endDate };
}

function roas(value: number, cost: number): number {
  return cost > 0 ? parseFloat((value / cost).toFixed(4)) : 0;
}

function normalizeOfferId(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^online:/, "");
}

/** Deduplicate rows by composite key before upserting */
export function dedup(rows: Record<string, unknown>[], keyColumns: string[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = keyColumns.map((c) => String(row[c] ?? "")).join("|||");
    seen.set(key, row);
  }
  return Array.from(seen.values());
}

export async function upsertBatch(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictColumns: string
): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let written = 0;
  const fouten: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictColumns, ignoreDuplicates: false });
    if (error) {
      logger.error(`[sync] ${table} chunk error:`, error.message);
      fouten.push(error.message);
    } else {
      written += chunk.length;
    }
  }
  // Een mislukte chunk werd alleen gelogd, waarna de dataset alsnog als geslaagd werd geboekt.
  // De logregel leest niemand; de statusregel in de UI wel. Die moet de waarheid vertellen.
  if (fouten.length > 0) throw new Error(`${table}: ${fouten.length} van de ${Math.ceil(rows.length / CHUNK)} chunk(s) mislukt — ${fouten[0]}`);
  return written;
}

/**
 * Vervangt alle rijen van een klant in één tabel.
 *
 * DE VOLGORDE HIER IS HET HELE PUNT. Eerst werd er verwijderd en dáárna gekeken of er iets te
 * schrijven viel. Dat maakte van elke tijdelijke API-storing een wisser: de 24 getters in
 * lib/api/google-ads.ts eindigen allemaal op `catch { return []; }`, dus een netwerkfout, een
 * quota-limiet of een verlopen token levert een lege array op. Die ging hier naar binnen, alles
 * werd verwijderd, er kwam niets voor terug — en omdat syncDataset alleen op een throw let, werd
 * de run als geslaagd geregistreerd. Stille, permanente historie-verlies op zeventien tabellen,
 * waaronder ads_country_monthly.
 *
 * Niets binnengekregen betekent nu: niets aanraken. De prijs is dat een klant die écht naar nul
 * gaat (laatste negatieve zoekwoord verwijderd) zijn oude rijen houdt tot de volgende sync met
 * inhoud. Verouderde data is hinderlijk; gewiste historie is niet terug te halen.
 */
export async function replaceBatch(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  clientId: string
): Promise<number> {
  if (rows.length === 0) {
    logger.warn(`[sync] ${table}: geen rijen ontvangen, bestaande data blijft staan`);
    return 0;
  }
  await supabase.from(table).delete().eq("client_id", clientId);
  const CHUNK = 500;
  let written = 0;
  const fouten: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) { logger.error(`[sync] ${table} chunk error:`, error.message); fouten.push(error.message); }
    else written += chunk.length;
  }
  // Hier is al verwijderd, dus een mislukte schrijfactie laat de tabel leeg achter. Dat mag niet
  // als "geslaagd" de logs in: gooien zodat syncDataset het als mislukt registreert.
  if (fouten.length > 0) throw new Error(`${table}: ${fouten.length} chunk(s) mislukt — ${fouten[0]}`);
  return written;
}

/**
 * Postgres meldt met deze code dat er geen unieke sleutel is die bij de ON CONFLICT past.
 * Zie https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const GEEN_UNIEKE_SLEUTEL = "42P10";

/**
 * Schrijft weg zonder de bestaande historie te wissen.
 *
 * Het verschil met replaceBatch is wat er met oudere rijen gebeurt. replaceBatch verwijdert
 * eerst alles van de klant, waardoor de tabel nooit meer kan bevatten dan wat de laatste sync
 * ophaalde — veertien maanden. Deze functie werkt bij en laat staan wat er al was, zodat de
 * tabel elke maand een maand langer wordt. Dat is precies wat je wilt voor tijdreeksen: Google
 * bewaart zoektermdata niet onbeperkt, en wat daar uit het venster loopt is definitief weg
 * tenzij wij het zelf hebben bewaard.
 *
 * Alleen voor tabellen waar dat KLOPT. Een tabel die de huidige toestand beschrijft — de
 * uitsluitingenlijst bijvoorbeeld — hoort wel gewist te worden, anders blijft een verwijderde
 * uitsluiting eeuwig staan. Zie de opmerking onderaan
 * scripts/pending-migration-history-accumulation.sql.
 *
 * Valt terug op replaceBatch zolang de unieke sleutel er nog niet is. Zonder die terugval zou
 * deze wijziging de sync breken op elke omgeving waar de migratie nog niet is gedraaid; met de
 * terugval verandert er daar niets en begint het aangroeien vanzelf zodra de sleutels er zijn.
 */
export async function appendBatch(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictColumns: string,
  clientId: string
): Promise<number> {
  if (rows.length === 0) {
    logger.warn(`[sync] ${table}: geen rijen ontvangen, bestaande data blijft staan`);
    return 0;
  }
  const CHUNK = 500;
  let written = 0;
  const fouten: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictColumns, ignoreDuplicates: false });
    if (error) {
      if ((error as { code?: string }).code === GEEN_UNIEKE_SLEUTEL) {
        logger.warn(
          `[sync] ${table}: nog geen unieke sleutel op (${conflictColumns}), dus terug naar vervangen. ` +
          "Historie ouder dan het syncvenster gaat hierbij verloren; draai " +
          "scripts/pending-migration-history-accumulation.sql om dat te stoppen."
        );
        return replaceBatch(supabase, table, rows, clientId);
      }
      logger.error(`[sync] ${table} chunk error:`, error.message);
      fouten.push(error.message);
    } else written += chunk.length;
  }
  if (fouten.length > 0) throw new Error(`${table}: ${fouten.length} chunk(s) mislukt — ${fouten[0]}`);
  return written;
}


// Welke getter voedt welke dataset. Expliciet, want dit is de enige plek waar de koppeling
// tussen "de API-call faalde" en "deze tabel is niet bijgewerkt" wordt gelegd — en die koppeling
// moet je kunnen nalezen zonder de dertig-voudige Promise.all te ontrafelen.
//
// Zonder dit werd een mislukte ophaal een lege array, en een lege array een geslaagde dataset met
// nul rijen. De statusregel zei dan "geslaagd" terwijl er niets was opgehaald, en de analyse
// meldde vervolgens "geen data beschikbaar" in plaats van "de sync faalt".
const FETCH_SOURCE_BY_DATASET: Record<string, string[]> = {
  ads_account_monthly: ["getAccountMetricsByMonth"],
  ads_account_weekly: ["getAccountMetricsByWeek"],
  ads_campaign_monthly: ["getCampaignMetricsByMonth"],
  ads_campaign_impression_share: ["getCampaignImpressionShareByMonth"],
  ads_adgroup_monthly: ["getAdGroupPerformanceByMonth"],
  ads_search_terms_wasteful: ["getWastefulSearchTermsByMonth"],
  ads_change_history: ["getChangeHistory"],
  ads_campaign_metadata: ["getCampaignMetadata"],
  ads_keyword_performance_monthly: ["getKeywordPerformanceByMonth"],
  ads_search_terms_monthly: ["getSearchTermsByMonth"],
  ads_device_performance_monthly: ["getDevicePerformanceByMonth"],
  ads_network_performance_monthly: ["getNetworkPerformanceByMonth"],
  ads_creative_performance: ["getCreativePerformanceByMonth"],
  ads_asset_group_performance_monthly: ["getAssetGroupPerformanceByMonth"],
  ads_product_performance_monthly: ["getProductPerformanceByMonth"],
  ads_geo_performance_monthly: ["getGeoPerformanceByMonth"],
  ads_audience_performance_monthly: ["getAudiencePerformanceByMonth"],
  ads_ad_schedule_performance: ["getAdSchedulePerformance"],
  google_ads_product_performance: ["getProductPerformanceByMonth"],
  google_ads_checkout_funnel: ["getCheckoutFunnelByMonth"],
  ads_pmax_asset_performance: ["getPmaxAssetPerformanceByMonth"],
  ads_pmax_network_breakdown: ["getPmaxNetworkBreakdownByMonth"],
  ads_pmax_placements: ["getPmaxPlacementsByMonth"],
  ads_video_placements: ["getVideoPlacementsByMonth", "getPmaxPlacementViewByMonth"],
  ads_pmax_search_categories: ["getPmaxSearchCategoriesByMonth"],
  // De landtabellen worden uit geoRaw afgeleid, dus ze delen die bron.
  ads_campaign_country_monthly: ["getGeoPerformanceByMonth"],
  ads_country_monthly: ["getGeoPerformanceByMonth"],
  ads_country_yoy: ["getGeoPerformanceByMonth"],
  ads_country_impression_share: ["getGeoPerformanceByMonth"],
  google_ads_rsa_assets: ["getRsaAssetMetricsByMonth"],
  google_ads_ad_meta: ["getAdMeta"],
  ads_negative_keywords: ["getAdGroupNegatives", "getCampaignNegatives", "getSharedSetNegatives"],
};

// ── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Synchroniseert één klant. De hele run draait binnen een ophaal-fout-verzamelaar: de getters in
 * lib/api/google-ads.ts vangen hun eigen fouten af en geven [] terug (nodig, want dertig calls in
 * één Promise.all mogen niet door één throw omvallen), maar ze noteren die fout nu wél. Daardoor
 * kan syncDataset het verschil zien tussen "deze klant heeft geen zoekwoorden" en "de zoekwoord-
 * call is mislukt" — twee dingen die tot vandaag identiek uit de sync kwamen.
 */
export async function syncClient(opts: SyncOptions): Promise<SyncResult> {
  const { result } = await withFetchFailures(() => syncClientRun(opts));
  return result;
}

async function syncClientRun(opts: SyncOptions): Promise<SyncResult> {
  const { supabase, credentials, clientId, customerId, syncType, triggeredBy } = opts;
  const { startDate, endDate } = opts.startDate && opts.endDate
    ? { startDate: opts.startDate, endDate: opts.endDate }
    : getDateRange13Months();

  const now = new Date().toISOString();
  const datasetResults: DatasetResult[] = [];

  // Create sync run record
  const { data: runRow } = await supabase
    .from("sync_runs")
    .insert({
      client_id: clientId,
      google_ads_customer_id: customerId,
      sync_type: syncType,
      status: "running",
      date_range_start: startDate,
      date_range_end: endDate,
      triggered_by: triggeredBy ?? "api",
    })
    .select("id")
    .single();

  const runId = runRow?.id ?? null;

  // Get conversion action filter
  const { data: settingsData } = await supabase
    .from("client_settings")
    .select("conversion_actions, checkout_action_map")
    .eq("client_id", clientId)
    .maybeSingle();

  let convActionIds: string[] | undefined;
  if (settingsData?.conversion_actions && Array.isArray(settingsData.conversion_actions)) {
    const included = (settingsData.conversion_actions as Array<{ id: string; includedInDashboard?: boolean }>)
      .filter((a) => a.includedInDashboard)
      .map((a) => a.id);
    if (included.length > 0) convActionIds = included;
  }
  const checkoutActionMap = (settingsData?.checkout_action_map as Partial<Record<"add_to_cart" | "begin_checkout" | "purchase", string>> | null) ?? undefined;

  // ── Fetch all data in parallel ──

  let monthlyRaw: Awaited<ReturnType<typeof getAccountMetricsByMonth>> = [];
  let weeklyRaw: Awaited<ReturnType<typeof getAccountMetricsByWeek>> = [];
  let campaignsRaw: Awaited<ReturnType<typeof getCampaignMetricsByMonth>> = [];
  let isRaw: Awaited<ReturnType<typeof getCampaignImpressionShareByMonth>> = [];
  let agRaw: Awaited<ReturnType<typeof getAdGroupPerformanceByMonth>> = [];
  let stRaw: Awaited<ReturnType<typeof getWastefulSearchTermsByMonth>> = [];
  let chRaw: Awaited<ReturnType<typeof getChangeHistory>> = [];
  let metaRaw: Awaited<ReturnType<typeof getCampaignMetadata>> = [];
  let kwRaw: Awaited<ReturnType<typeof getKeywordPerformanceByMonth>> = [];
  let stFullRaw: Awaited<ReturnType<typeof getSearchTermsByMonth>> = [];
  let prodRaw: Awaited<ReturnType<typeof getProductPerformanceByMonth>> = [];
  let deviceRaw: Awaited<ReturnType<typeof getDevicePerformanceByMonth>> = [];
  let geoRaw: Awaited<ReturnType<typeof getGeoPerformanceByMonth>> = [];
  let networkRaw: Awaited<ReturnType<typeof getNetworkPerformanceByMonth>> = [];
  let creativeRaw: Awaited<ReturnType<typeof getCreativePerformanceByMonth>> = [];
  let assetRaw: Awaited<ReturnType<typeof getAssetGroupPerformanceByMonth>> = [];
  let audienceRaw: Awaited<ReturnType<typeof getAudiencePerformanceByMonth>> = [];
  let scheduleRaw: Awaited<ReturnType<typeof getAdSchedulePerformance>> = [];
  let checkoutRaw: Awaited<ReturnType<typeof getCheckoutFunnelByMonth>> = [];
  // PMAX-specific
  let pmaxAssetsRaw: Awaited<ReturnType<typeof getPmaxAssetPerformanceByMonth>> = [];
  let pmaxNetworkRaw: Awaited<ReturnType<typeof getPmaxNetworkBreakdownByMonth>> = [];
  let pmaxPlacementsRaw: Awaited<ReturnType<typeof getPmaxPlacementsByMonth>> = [];
  let pmaxSearchCatsRaw: Awaited<ReturnType<typeof getPmaxSearchCategoriesByMonth>> = [];
  // YouTube-placements: waar de videoadvertenties daadwerkelijk landden (kanaal, video, app).
  let videoPlacementsRaw: Awaited<ReturnType<typeof getVideoPlacementsByMonth>> = [];
  // PMax adverteert ook met video op YouTube; die plaatsingen horen in hetzelfde beeld.
  let pmaxPlacementViewRaw: Awaited<ReturnType<typeof getPmaxPlacementViewByMonth>> = [];
  let rsaAssetsRaw: Awaited<ReturnType<typeof getRsaAssetMetricsByMonth>> = [];
  let adMetaRaw: Awaited<ReturnType<typeof getAdMeta>> = [];
  let adGroupNegRaw: Awaited<ReturnType<typeof getAdGroupNegatives>> = [];
  let campaignNegRaw: Awaited<ReturnType<typeof getCampaignNegatives>> = [];
  let sharedNegRaw: Awaited<ReturnType<typeof getSharedSetNegatives>> = [];

  try {
    [
      monthlyRaw, weeklyRaw, campaignsRaw, isRaw,
      agRaw, stRaw, chRaw, metaRaw,
      kwRaw, stFullRaw, prodRaw, deviceRaw,
      geoRaw, networkRaw, creativeRaw, assetRaw,
      audienceRaw, scheduleRaw,
      checkoutRaw,
      pmaxAssetsRaw, pmaxNetworkRaw, pmaxPlacementsRaw, pmaxSearchCatsRaw,
      videoPlacementsRaw, pmaxPlacementViewRaw,
      rsaAssetsRaw, adMetaRaw,
      adGroupNegRaw, campaignNegRaw, sharedNegRaw,
    ] = await Promise.all([
      getAccountMetricsByMonth(credentials, customerId, startDate, endDate, convActionIds),
      getAccountMetricsByWeek(credentials, customerId, startDate, endDate),
      getCampaignMetricsByMonth(credentials, customerId, startDate, endDate, convActionIds),
      getCampaignImpressionShareByMonth(credentials, customerId, startDate, endDate),
      getAdGroupPerformanceByMonth(credentials, customerId, startDate, endDate),
      getWastefulSearchTermsByMonth(credentials, customerId, startDate, endDate),
      getChangeHistory(credentials, customerId),
      getCampaignMetadata(credentials, customerId),
      getKeywordPerformanceByMonth(credentials, customerId, startDate, endDate),
      getSearchTermsByMonth(credentials, customerId, startDate, endDate),
      getProductPerformanceByMonth(credentials, customerId, startDate, endDate),
      getDevicePerformanceByMonth(credentials, customerId, startDate, endDate),
      getGeoPerformanceByMonth(credentials, customerId, startDate, endDate),
      getNetworkPerformanceByMonth(credentials, customerId, startDate, endDate),
      getCreativePerformanceByMonth(credentials, customerId, startDate, endDate),
      getAssetGroupPerformanceByMonth(credentials, customerId, startDate, endDate),
      getAudiencePerformanceByMonth(credentials, customerId, startDate, endDate),
      getAdSchedulePerformance(credentials, customerId, startDate, endDate),
      getCheckoutFunnelByMonth(credentials, customerId, startDate, endDate, checkoutActionMap),
      // PMAX intelligence
      getPmaxAssetPerformanceByMonth(credentials, customerId, startDate, endDate),
      getPmaxNetworkBreakdownByMonth(credentials, customerId, startDate, endDate),
      getPmaxPlacementsByMonth(credentials, customerId, startDate, endDate),
      getPmaxSearchCategoriesByMonth(credentials, customerId, startDate, endDate),
      // YouTube-placements (video/Demand Gen) — de basis voor uitsluitingsvoorstellen.
      getVideoPlacementsByMonth(credentials, customerId, startDate, endDate),
      getPmaxPlacementViewByMonth(credentials, customerId, startDate, endDate),
      // RSA-assets plus ad-meta (migratie 020, het RSA/W1-duo)
      getRsaAssetMetricsByMonth(credentials, customerId, startDate, endDate),
      getAdMeta(credentials, customerId),
      // Negatives (migratie 022, categorie G). Drie niveaus, want een checker die er een
      // mist geeft valse geruststelling. Elke fetch heeft zijn eigen catch die [] geeft,
      // dus een veld dat niet bestaat maakt hooguit deze dataset leeg.
      getAdGroupNegatives(credentials, customerId),
      getCampaignNegatives(credentials, customerId),
      getSharedSetNegatives(credentials, customerId),
    ]);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("sync_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_summary: `API fetch failed: ${errMsg}`,
      }).eq("id", runId);
    }
    return {
      runId, clientId, status: "failed",
      startedAt: now, finishedAt: new Date().toISOString(),
      datasetsAttempted: 18, datasetsSucceeded: 0, datasetsFailed: 18,
      totalRowsWritten: 0, datasetResults: [],
      dateRangeStart: startDate, dateRangeEnd: endDate,
      errorSummary: `API fetch failed: ${errMsg}`,
    };
  }

  const merchantSync = await syncMerchantProductSnapshots({
    supabase,
    clientId,
    credentials,
  });
  const merchantByOfferId = new Map(
    merchantSync.products.map((product) => [normalizeOfferId(product.offer_id), product] as const)
  );

  // ── Transform + write ──

  async function syncDataset(
    name: string,
    fn: () => Promise<number>
  ): Promise<DatasetResult> {
    // Faalde de ophaal? Dan is er niets om weg te schrijven en is "geslaagd met nul rijen" een
    // leugen. Niet schrijven, wél als mislukt registreren.
    const bronnen = FETCH_SOURCE_BY_DATASET[name] ?? [];
    const gefaald = bronnen.filter((b) => hasFetchFailure(b));
    if (gefaald.length > 0) {
      const result = { name, rows: 0, success: false, error: `ophalen mislukt: ${gefaald.join(", ")}` };
      datasetResults.push(result);
      return result;
    }
    try {
      const rows = await fn();
      const result = { name, rows, success: true };
      datasetResults.push(result);
      return result;
    } catch (err) {
      const result = { name, rows: 0, success: false, error: err instanceof Error ? err.message : String(err) };
      datasetResults.push(result);
      return result;
    }
  }

  // Core tables
  await Promise.all([
    syncDataset("ads_account_monthly", () => upsertBatch(supabase, "ads_account_monthly",
      monthlyRaw.map((m) => ({ client_id: clientId, month: m.date, impressions: m.impressions, clicks: m.clicks, cost: m.cost, conversions: m.conversions, conversions_value: m.conversionsValue, ctr: m.ctr, avg_cpc: m.avgCpc, cost_per_conversion: m.costPerConversion, conversion_rate: m.conversionRate, roas: roas(m.conversionsValue, m.cost) })),
      "client_id,month")),
    syncDataset("ads_account_weekly", () => upsertBatch(supabase, "ads_account_weekly",
      weeklyRaw.map((m) => ({ client_id: clientId, week_start: m.date, impressions: m.impressions, clicks: m.clicks, cost: m.cost, conversions: m.conversions, conversions_value: m.conversionsValue, ctr: m.ctr, avg_cpc: m.avgCpc, cost_per_conversion: m.costPerConversion, conversion_rate: m.conversionRate, roas: roas(m.conversionsValue, m.cost) })),
      "client_id,week_start")),
    syncDataset("ads_campaign_monthly", () => upsertBatch(supabase, "ads_campaign_monthly",
      campaignsRaw.map((c) => ({ client_id: clientId, campaign_id: c.campaignId, campaign_name: c.campaignName, campaign_status: c.campaignStatus, campaign_type: c.campaignType, month: c.date, impressions: c.impressions, clicks: c.clicks, cost: c.cost, conversions: c.conversions, conversions_value: c.conversionsValue, ctr: c.ctr, avg_cpc: c.avgCpc, cost_per_conversion: c.costPerConversion, conversion_rate: c.conversionRate, roas: roas(c.conversionsValue, c.cost), avg_cpm: c.avgCpm, video_views: c.videoViews, avg_cpv: c.avgCpv, video_view_rate: c.videoViewRate, video_quartile_p25: c.videoQuartileP25, video_quartile_p50: c.videoQuartileP50, video_quartile_p75: c.videoQuartileP75, video_quartile_p100: c.videoQuartileP100 })),
      "client_id,campaign_id,month")),
    syncDataset("ads_campaign_impression_share", () => upsertBatch(supabase, "ads_campaign_impression_share",
      isRaw.map((is) => ({ client_id: clientId, campaign_id: is.campaignId, campaign_name: is.campaignName, campaign_type: is.campaignType, month: is.date, impressions: is.impressions, clicks: is.clicks, cost: is.cost, conversions: is.conversions, search_impression_share: is.searchImpressionShare, search_budget_lost_is: is.searchBudgetLostIS, search_rank_lost_is: is.searchRankLostIS, daily_budget: is.dailyBudget, budget_utilization: is.budgetUtilization })),
      "client_id,campaign_id,month")),
    syncDataset("ads_adgroup_monthly", () => upsertBatch(supabase, "ads_adgroup_monthly",
      agRaw.map((ag) => ({ client_id: clientId, campaign_name: ag.campaignName, ad_group_id: ag.adGroupId, ad_group_name: ag.adGroupName, month: ag.date, impressions: ag.impressions, clicks: ag.clicks, cost: ag.cost, conversions: ag.conversions, conversions_value: ag.conversionsValue, cpa: ag.cpa, roas: ag.roas })),
      "client_id,ad_group_id,month")),
    syncDataset("ads_search_terms_wasteful", () => appendBatch(supabase, "ads_search_terms_wasteful",
      dedup(stRaw.map((st) => ({ client_id: clientId, week_start: st.date, search_term: st.searchTerm, campaign_name: st.campaignName, ad_group_name: st.adGroupName, impressions: st.impressions, clicks: st.clicks, cost: st.cost, term_status: st.status })), ["client_id", "week_start", "search_term"]),
      "client_id,week_start,search_term", clientId)),
    syncDataset("ads_change_history", () => appendBatch(supabase, "ads_change_history",
      chRaw.map((ch) => ({ client_id: clientId, change_datetime: ch.changeDateTime, resource_type: ch.resourceType, change_resource_name: ch.changeResourceName, campaign_name: ch.campaignName, change_type: ch.changeType, old_value: ch.oldValue, new_value: ch.newValue, user_email: ch.userEmail })),
      "client_id,change_datetime,change_resource_name,change_type", clientId)),
    syncDataset("ads_campaign_metadata", () => upsertBatch(supabase, "ads_campaign_metadata",
      metaRaw.map((cm) => ({ client_id: clientId, campaign_id: cm.campaignId, campaign_name: cm.campaignName, campaign_type: cm.campaignType, bidding_strategy: cm.biddingStrategy, bidding_strategy_target: cm.biddingStrategyTarget, budget_amount: cm.budgetAmount, budget_type: cm.budgetType, serving_status: cm.servingStatus, updated_at: new Date().toISOString() })),
      "client_id,campaign_id")),
  ]);

  // Dimensional tables
  await Promise.all([
    syncDataset("ads_keyword_performance_monthly", () => upsertBatch(supabase, "ads_keyword_performance_monthly",
      dedup(kwRaw.map((k) => ({ client_id: clientId, month: k.date, campaign_id: k.campaignId, campaign_name: k.campaignName, ad_group_id: k.adGroupId, ad_group_name: k.adGroupName, keyword_id: k.keywordId, keyword_text: k.keywordText, match_type: k.matchType, impressions: k.impressions, clicks: k.clicks, cost: k.cost, conversions: k.conversions, conversions_value: k.conversionsValue, ctr: k.ctr, avg_cpc: k.avgCpc, conversion_rate: k.conversionRate, cost_per_conversion: k.costPerConversion, quality_score: k.qualityScore, synced_at: now })), ["client_id", "keyword_id", "month"]),
      "client_id,keyword_id,month")),
    syncDataset("ads_search_terms_monthly", () => upsertBatch(supabase, "ads_search_terms_monthly",
      dedup(aggregateSearchTermsByMonth(stFullRaw).map((st) => ({ client_id: clientId, month: st.date, campaign_id: st.campaignId, campaign_name: st.campaignName, ad_group_id: st.adGroupId, ad_group_name: st.adGroupName, search_term: st.searchTerm, match_type: st.matchType, impressions: st.impressions, clicks: st.clicks, cost: st.cost, conversions: st.conversions, conversions_value: st.conversionsValue, ctr: st.clicks > 0 && st.impressions > 0 ? st.clicks / st.impressions : 0, conversion_rate: st.clicks > 0 ? st.conversions / st.clicks : 0, synced_at: now })), ["client_id", "search_term", "campaign_name", "ad_group_name", "month"]),
      "client_id,search_term,campaign_name,ad_group_name,month")),
    syncDataset("ads_device_performance_monthly", () => appendBatch(supabase, "ads_device_performance_monthly",
      deviceRaw.map((d) => ({ client_id: clientId, month: d.date, device: d.device, level: d.campaignId ? "campaign" : "account", campaign_id: d.campaignId, campaign_name: d.campaignName, impressions: d.impressions, clicks: d.clicks, cost: d.cost, conversions: d.conversions, conversions_value: d.conversionsValue, ctr: d.impressions > 0 ? d.clicks / d.impressions : 0, avg_cpc: d.clicks > 0 ? d.cost / d.clicks : 0, conversion_rate: d.clicks > 0 ? d.conversions / d.clicks : 0, cost_per_conversion: d.conversions > 0 ? d.cost / d.conversions : 0, synced_at: now })),
      "client_id,month,device,level,campaign_id", clientId)),
    syncDataset("ads_network_performance_monthly", () => appendBatch(supabase, "ads_network_performance_monthly",
      networkRaw.map((n) => ({ client_id: clientId, month: n.date, network_type: n.networkType, campaign_id: n.campaignId, campaign_name: n.campaignName, impressions: n.impressions, clicks: n.clicks, cost: n.cost, conversions: n.conversions, conversions_value: n.conversionsValue, ctr: n.impressions > 0 ? n.clicks / n.impressions : 0, conversion_rate: n.clicks > 0 ? n.conversions / n.clicks : 0, synced_at: now })),
      "client_id,month,network_type,campaign_id", clientId)),
    syncDataset("ads_creative_performance", () => upsertBatch(supabase, "ads_creative_performance",
      dedup(creativeRaw.map((cr) => ({ client_id: clientId, month: cr.date, campaign_id: cr.campaignId, campaign_name: cr.campaignName, ad_group_id: cr.adGroupId, ad_group_name: cr.adGroupName, ad_id: cr.adId, ad_type: cr.adType, headlines: JSON.stringify(cr.headlines), descriptions: JSON.stringify(cr.descriptions), final_urls: JSON.stringify(cr.finalUrls), impressions: cr.impressions, clicks: cr.clicks, cost: cr.cost, conversions: cr.conversions, conversions_value: cr.conversionsValue, ctr: cr.impressions > 0 ? cr.clicks / cr.impressions : 0, conversion_rate: cr.clicks > 0 ? cr.conversions / cr.clicks : 0, synced_at: now })), ["client_id", "ad_id", "month"]),
      "client_id,ad_id,month")),
    syncDataset("ads_asset_group_performance_monthly", () => upsertBatch(supabase, "ads_asset_group_performance_monthly",
      dedup(assetRaw.map((ag) => ({ client_id: clientId, month: ag.date, campaign_id: ag.campaignId, campaign_name: ag.campaignName, asset_group_id: ag.assetGroupId, asset_group_name: ag.assetGroupName, asset_group_status: ag.assetGroupStatus, impressions: ag.impressions, clicks: ag.clicks, cost: ag.cost, conversions: ag.conversions, conversions_value: ag.conversionsValue, synced_at: now })), ["client_id", "asset_group_id", "month"]),
      "client_id,asset_group_id,month")),
    syncDataset("ads_product_performance_monthly", () => upsertBatch(supabase, "ads_product_performance_monthly",
      dedup(prodRaw.map((p) => ({ client_id: clientId, month: p.date, campaign_name: p.campaignName, campaign_type: p.campaignType, product_title: p.productTitle, product_id: p.productId || null, impressions: p.impressions, clicks: p.clicks, cost: p.cost, conversions: p.conversions, conversions_value: p.conversionsValue, ctr: p.impressions > 0 ? p.clicks / p.impressions : 0, roas: roas(p.conversionsValue, p.cost), cost_per_conversion: p.conversions > 0 ? p.cost / p.conversions : 0, synced_at: now })), ["client_id", "product_title", "campaign_name", "month"]),
      "client_id,product_title,campaign_name,month")),
    syncDataset("ads_geo_performance_monthly", () => appendBatch(supabase, "ads_geo_performance_monthly",
      dedup(geoRaw.map((g) => ({ client_id: clientId, month: g.date, campaign_id: g.campaignId, campaign_name: g.campaignName, country_code: g.countryCode || null, region_name: g.regionName || null, city_name: null, geo_target_id: g.geoTargetId || null, impressions: Number(g.impressions), clicks: Number(g.clicks), cost: g.cost, conversions: g.conversions, conversions_value: g.conversionsValue, ctr: g.impressions > 0 ? g.clicks / g.impressions : 0, conversion_rate: g.clicks > 0 ? g.conversions / g.clicks : 0, synced_at: now })), ["client_id", "geo_target_id", "campaign_id", "month"]),
      "client_id,month,campaign_id,geo_target_id,country_code", clientId)),
    syncDataset("ads_audience_performance_monthly", () => appendBatch(supabase, "ads_audience_performance_monthly",
      audienceRaw.map((a) => ({ client_id: clientId, month: a.date, campaign_id: a.campaignId, campaign_name: a.campaignName, ad_group_id: a.adGroupId, ad_group_name: a.adGroupName, audience_id: a.audienceId, audience_name: a.audienceName, audience_type: null, impressions: a.impressions, clicks: a.clicks, cost: a.cost, conversions: a.conversions, conversions_value: a.conversionsValue, ctr: a.impressions > 0 ? a.clicks / a.impressions : 0, conversion_rate: a.clicks > 0 ? a.conversions / a.clicks : 0, synced_at: now })),
      "client_id,month,campaign_id,ad_group_id,audience_id", clientId)),
    syncDataset("ads_ad_schedule_performance", () => replaceBatch(supabase, "ads_ad_schedule_performance",
      scheduleRaw.map((s) => ({ client_id: clientId, period_start: startDate, period_end: endDate, campaign_id: s.campaignId, campaign_name: s.campaignName, day_of_week: s.dayOfWeek, hour_of_day: s.hourOfDay, impressions: s.impressions, clicks: s.clicks, cost: s.cost, conversions: s.conversions, conversions_value: s.conversionsValue, synced_at: now })),
      clientId)),
    syncDataset("google_ads_product_performance", () => upsertBatch(supabase, "google_ads_product_performance",
      dedup(prodRaw.map((p) => {
        const merchant = merchantByOfferId.get(normalizeOfferId(p.productId));
        const pricePayload = (merchant?.source_payload_jsonb?.price || merchant?.source_payload_jsonb?.salePrice || {}) as Record<string, unknown>;
        const salePricePayload = (merchant?.source_payload_jsonb?.salePrice || merchant?.source_payload_jsonb?.sale_price || {}) as Record<string, unknown>;
        const readPrice = (payload: Record<string, unknown>): number | null => {
          const raw = payload.amountMicros ?? payload.amount_micros ?? payload.amount;
          if (typeof raw === "number") return raw > 1000 ? raw / 1_000_000 : raw;
          if (typeof raw === "string" && raw.trim()) {
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? (parsed > 1000 ? parsed / 1_000_000 : parsed) : null;
          }
          return null;
        };
        return {
          client_id: clientId,
          date: p.date,
          campaign_id: p.campaignId || null,
          campaign_name: p.campaignName,
          ad_group_id: p.adGroupId || null,
          ad_group_name: p.adGroupName || null,
          product_item_id: p.productId || p.productTitle,
          product_title: p.productTitle || merchant?.title || null,
          product_type_l1: p.productTypeL1 || merchant?.product_type_l1 || null,
          product_type_l2: p.productTypeL2 || merchant?.product_type_l2 || null,
          product_type_l3: p.productTypeL3 || merchant?.product_type_l3 || null,
          product_type_l4: p.productTypeL4 || merchant?.product_type_l4 || null,
          product_type_l5: p.productTypeL5 || merchant?.product_type_l5 || null,
          product_brand: merchant?.brand || null,
          custom_label_0: p.customLabel0 || merchant?.custom_label_0 || null,
          custom_label_1: p.customLabel1 || merchant?.custom_label_1 || null,
          custom_label_2: p.customLabel2 || merchant?.custom_label_2 || null,
          custom_label_3: p.customLabel3 || merchant?.custom_label_3 || null,
          custom_label_4: p.customLabel4 || merchant?.custom_label_4 || null,
          mc_availability: merchant?.availability || null,
          mc_price: readPrice(pricePayload),
          mc_sale_price: readPrice(salePricePayload),
          mc_condition: typeof merchant?.source_payload_jsonb?.condition === "string" ? merchant.source_payload_jsonb.condition as string : null,
          impressions: p.impressions,
          clicks: p.clicks,
          cost: Number(p.cost.toFixed(2)),
          conversions: p.conversions,
          conversion_value: p.conversionsValue,
        };
      }), ["client_id", "date", "campaign_id", "ad_group_id", "product_item_id"]),
      "client_id,date,campaign_id,ad_group_id,product_item_id")),
    syncDataset("google_ads_checkout_funnel", () => upsertBatch(supabase, "google_ads_checkout_funnel",
      dedup(checkoutRaw.map((row) => ({
        client_id: clientId,
        date: row.date,
        campaign_id: row.campaignId,
        campaign_name: row.campaignName,
        device: row.device,
        sessions: null,
        add_to_cart_count: row.addToCartCount,
        add_to_cart_value: row.addToCartValue,
        begin_checkout_count: row.beginCheckoutCount,
        begin_checkout_value: row.beginCheckoutValue,
        purchase_count: row.purchaseCount,
        purchase_value: row.purchaseValue,
      })), ["client_id", "date", "campaign_id", "device"]),
      "client_id,date,campaign_id,device")),
  ]);

  // PMAX Intelligence tables
  await Promise.all([
    syncDataset("ads_pmax_asset_performance", () => replaceBatch(supabase, "ads_pmax_asset_performance",
      pmaxAssetsRaw.map((a) => ({ client_id: clientId, month: a.date, campaign_id: a.campaignId, campaign_name: a.campaignName, asset_group_id: a.assetGroupId, asset_group_name: a.assetGroupName, asset_id: a.assetId, asset_type: a.assetType, asset_text: a.assetText || null, asset_url: a.assetUrl || null, performance_label: a.performanceLabel, synced_at: now })),
      clientId)),
    syncDataset("ads_pmax_network_breakdown", () => replaceBatch(supabase, "ads_pmax_network_breakdown",
      pmaxNetworkRaw.map((n) => ({ client_id: clientId, month: n.date, campaign_id: n.campaignId, campaign_name: n.campaignName, asset_group_id: n.assetGroupId, asset_group_name: n.assetGroupName, network_type: n.networkType, impressions: n.impressions, clicks: n.clicks, cost: n.cost, conversions: n.conversions, conversions_value: n.conversionsValue, synced_at: now })),
      clientId)),
    syncDataset("ads_pmax_placements", () => replaceBatch(supabase, "ads_pmax_placements",
      pmaxPlacementsRaw.map((p) => ({ client_id: clientId, month: startDate, campaign_id: p.campaignId, campaign_name: p.campaignName, placement: p.placement, placement_type: p.placementType, impressions: p.impressions, clicks: p.clicks, cost: p.cost, conversions: p.conversions, conversions_value: p.conversionsValue, synced_at: now })),
      clientId)),
    // YouTube-placements: waar de videoadvertenties landden. Voedt de uitsluitingsvoorstellen.
    syncDataset("ads_video_placements", () => replaceBatch(supabase, "ads_video_placements",
      [...videoPlacementsRaw, ...pmaxPlacementViewRaw].map((p) => ({ client_id: clientId, month: startDate, campaign_id: p.campaignId, campaign_name: p.campaignName, placement: p.placement, display_name: p.displayName, placement_type: p.placementType, target_url: p.targetUrl, impressions: p.impressions, clicks: p.clicks, cost: p.cost, conversions: p.conversions, conversions_value: p.conversionsValue, video_views: p.videoViews, metrics_complete: p.metricsComplete, source: p.source, synced_at: now })),
      clientId)),
    syncDataset("ads_pmax_search_categories", () => replaceBatch(supabase, "ads_pmax_search_categories",
      pmaxSearchCatsRaw.map((sc) => ({ client_id: clientId, month: sc.date, campaign_id: sc.campaignId, campaign_name: sc.campaignName, category_label: sc.categoryLabel, impressions: sc.impressions, clicks: sc.clicks, cost: sc.cost, conversions: sc.conversions, conversions_value: sc.conversionsValue, synced_at: now })),
      clientId)),
  ]);

  // ── Country aggregation tables ──
  // Derive from geoRaw (in memory) — no extra API calls needed.

  // Step 1: Aggregate geo data by campaign + country + month
  const campaignCountryMap = new Map<string, {
    campaignId: string; campaignName: string; countryCode: string; month: string;
    impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number;
  }>();

  for (const g of geoRaw) {
    if (!g.countryCode || !g.campaignId) continue;
    const key = `${g.campaignId}|||${g.countryCode}|||${g.date}`;
    const existing = campaignCountryMap.get(key);
    if (existing) {
      existing.impressions += g.impressions;
      existing.clicks += g.clicks;
      existing.cost += g.cost;
      existing.conversions += g.conversions;
      existing.conversionsValue += g.conversionsValue;
      existing.campaignName = g.campaignName; // latest wins
    } else {
      campaignCountryMap.set(key, {
        campaignId: g.campaignId, campaignName: g.campaignName,
        countryCode: g.countryCode, month: g.date,
        impressions: g.impressions, clicks: g.clicks,
        cost: g.cost, conversions: g.conversions, conversionsValue: g.conversionsValue,
      });
    }
  }

  // Compute campaign total spend per month for campaign_spend_share
  const campaignMonthSpend = new Map<string, number>();
  for (const v of Array.from(campaignCountryMap.values())) {
    const key = `${v.campaignId}|||${v.month}`;
    campaignMonthSpend.set(key, (campaignMonthSpend.get(key) ?? 0) + v.cost);
  }

  const campaignCountryRows = Array.from(campaignCountryMap.values()).map((v) => {
    const totalCampaignSpend = campaignMonthSpend.get(`${v.campaignId}|||${v.month}`) ?? 0;
    return {
      client_id: clientId, campaign_id: v.campaignId, campaign_name: v.campaignName,
      country_code: v.countryCode, month: v.month,
      impressions: v.impressions, clicks: v.clicks, cost: v.cost,
      conversions: v.conversions, conversions_value: v.conversionsValue,
      ctr: v.impressions > 0 ? parseFloat((v.clicks / v.impressions).toFixed(6)) : 0,
      avg_cpc: v.clicks > 0 ? parseFloat((v.cost / v.clicks).toFixed(4)) : 0,
      cost_per_conversion: v.conversions > 0 ? parseFloat((v.cost / v.conversions).toFixed(4)) : 0,
      conversion_rate: v.clicks > 0 ? parseFloat((v.conversions / v.clicks).toFixed(6)) : 0,
      roas: roas(v.conversionsValue, v.cost),
      campaign_spend_share: totalCampaignSpend > 0 ? parseFloat((v.cost / totalCampaignSpend).toFixed(4)) : 0,
      synced_at: now,
    };
  });

  // Step 2: Aggregate to country + month (account level)
  const countryMonthMap = new Map<string, {
    countryCode: string; month: string;
    impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number;
    campaignIds: Set<string>;
  }>();

  for (const v of Array.from(campaignCountryMap.values())) {
    const key = `${v.countryCode}|||${v.month}`;
    const existing = countryMonthMap.get(key);
    if (existing) {
      existing.impressions += v.impressions;
      existing.clicks += v.clicks;
      existing.cost += v.cost;
      existing.conversions += v.conversions;
      existing.conversionsValue += v.conversionsValue;
      existing.campaignIds.add(v.campaignId);
    } else {
      countryMonthMap.set(key, {
        countryCode: v.countryCode, month: v.month,
        impressions: v.impressions, clicks: v.clicks,
        cost: v.cost, conversions: v.conversions, conversionsValue: v.conversionsValue,
        campaignIds: new Set([v.campaignId]),
      });
    }
  }

  // Compute account total spend per month for spend_share
  const accountMonthSpend = new Map<string, number>();
  for (const v of Array.from(countryMonthMap.values())) {
    accountMonthSpend.set(v.month, (accountMonthSpend.get(v.month) ?? 0) + v.cost);
  }

  const countryMonthlyRows = Array.from(countryMonthMap.values()).map((v) => {
    const totalSpend = accountMonthSpend.get(v.month) ?? 0;
    return {
      client_id: clientId, country_code: v.countryCode, month: v.month,
      impressions: v.impressions, clicks: v.clicks, cost: v.cost,
      conversions: v.conversions, conversions_value: v.conversionsValue,
      ctr: v.impressions > 0 ? parseFloat((v.clicks / v.impressions).toFixed(6)) : 0,
      avg_cpc: v.clicks > 0 ? parseFloat((v.cost / v.clicks).toFixed(4)) : 0,
      cost_per_conversion: v.conversions > 0 ? parseFloat((v.cost / v.conversions).toFixed(4)) : 0,
      conversion_rate: v.clicks > 0 ? parseFloat((v.conversions / v.clicks).toFixed(6)) : 0,
      roas: roas(v.conversionsValue, v.cost),
      campaign_count: v.campaignIds.size,
      spend_share: totalSpend > 0 ? parseFloat((v.cost / totalSpend).toFixed(4)) : 0,
      synced_at: now,
    };
  });

  // Step 3: Compute country YoY from aggregated data
  const countryMonthLookup = new Map<string, typeof countryMonthlyRows[number]>();
  for (const r of countryMonthlyRows) {
    countryMonthLookup.set(`${r.country_code}|||${r.month}`, r);
  }

  function yoyPct(cur: number, prev: number): number | null {
    return prev > 0 ? parseFloat((((cur - prev) / prev) * 100).toFixed(1)) : null;
  }

  const countryYoyRows: Record<string, unknown>[] = [];
  for (const r of countryMonthlyRows) {
    // UTC, niet new Date(...).setFullYear(): dat parst als UTC en telt lokaal op. Op een
    // UTC-server klopt het, maar in een tijdzone met negatieve offset landt de sleutel een dag
    // te vroeg (59 van de 60 maanden in New York) en vindt de lookup niets — waarna de rij
    // stilzwijgend wordt overgeslagen in plaats van als YoY-vergelijking te verschijnen.
    const prevKey = `${r.country_code}|||${addYears(String(r.month), -1)}`;
    const prev = countryMonthLookup.get(prevKey);
    if (!prev) continue;
    countryYoyRows.push({
      client_id: clientId, country_code: r.country_code, month: r.month,
      impressions_yoy_pct: yoyPct(r.impressions, prev.impressions),
      clicks_yoy_pct: yoyPct(r.clicks, prev.clicks),
      cost_yoy_pct: yoyPct(r.cost, prev.cost),
      conversions_yoy_pct: yoyPct(r.conversions, prev.conversions),
      conversions_value_yoy_pct: yoyPct(r.conversions_value, prev.conversions_value),
      ctr_yoy_pct: yoyPct(r.ctr, prev.ctr),
      avg_cpc_yoy_pct: yoyPct(r.avg_cpc, prev.avg_cpc),
      conversion_rate_yoy_pct: yoyPct(r.conversion_rate, prev.conversion_rate),
      roas_yoy_pct: yoyPct(r.roas, prev.roas),
      cost_per_conversion_yoy_pct: yoyPct(r.cost_per_conversion, prev.cost_per_conversion),
      synced_at: now,
    });
  }

  // Step 4: Compute country impression share (weighted avg from campaign IS data)
  const isLookup = new Map<string, typeof isRaw[number]>();
  for (const is of isRaw) {
    isLookup.set(`${is.campaignId}|||${is.date}`, is);
  }

  const countryIsMap = new Map<string, {
    countryCode: string; month: string;
    weightedIS: number; weightedBudgetLost: number; weightedRankLost: number;
    totalCost: number; totalBudget: number; campaignIds: Set<string>;
  }>();

  for (const ccr of campaignCountryRows) {
    const isData = isLookup.get(`${ccr.campaign_id}|||${ccr.month}`);
    if (!isData || isData.searchImpressionShare == null) continue;
    const key = `${ccr.country_code}|||${ccr.month}`;
    const existing = countryIsMap.get(key);
    if (existing) {
      existing.weightedIS += (isData.searchImpressionShare ?? 0) * ccr.cost;
      existing.weightedBudgetLost += (isData.searchBudgetLostIS ?? 0) * ccr.cost;
      existing.weightedRankLost += (isData.searchRankLostIS ?? 0) * ccr.cost;
      existing.totalCost += ccr.cost;
      existing.totalBudget += (isData.dailyBudget ?? 0) * ccr.campaign_spend_share;
      existing.campaignIds.add(ccr.campaign_id);
    } else {
      countryIsMap.set(key, {
        countryCode: ccr.country_code, month: ccr.month,
        weightedIS: (isData.searchImpressionShare ?? 0) * ccr.cost,
        weightedBudgetLost: (isData.searchBudgetLostIS ?? 0) * ccr.cost,
        weightedRankLost: (isData.searchRankLostIS ?? 0) * ccr.cost,
        totalCost: ccr.cost,
        totalBudget: (isData.dailyBudget ?? 0) * ccr.campaign_spend_share,
        campaignIds: new Set([ccr.campaign_id]),
      });
    }
  }

  const countryIsRows = Array.from(countryIsMap.values()).map((v) => ({
    client_id: clientId, country_code: v.countryCode, month: v.month,
    search_impression_share: v.totalCost > 0 ? parseFloat((v.weightedIS / v.totalCost).toFixed(4)) : null,
    search_budget_lost_is: v.totalCost > 0 ? parseFloat((v.weightedBudgetLost / v.totalCost).toFixed(4)) : null,
    search_rank_lost_is: v.totalCost > 0 ? parseFloat((v.weightedRankLost / v.totalCost).toFixed(4)) : null,
    total_daily_budget: v.totalBudget,
    total_cost: v.totalCost,
    budget_utilization: v.totalBudget > 0 ? parseFloat((v.totalCost / (v.totalBudget * 30)).toFixed(4)) : 0,
    campaign_count: v.campaignIds.size,
    synced_at: now,
  }));

  // Write country tables
  await Promise.all([
    syncDataset("ads_campaign_country_monthly", () => replaceBatch(supabase, "ads_campaign_country_monthly",
      campaignCountryRows, clientId)),
    syncDataset("ads_country_monthly", () => appendBatch(supabase, "ads_country_monthly",
      countryMonthlyRows, "client_id,month,country_code", clientId)),
    syncDataset("ads_country_yoy", () => replaceBatch(supabase, "ads_country_yoy",
      countryYoyRows, clientId)),
    syncDataset("ads_country_impression_share", () => replaceBatch(supabase, "ads_country_impression_share",
      countryIsRows, clientId)),
    syncDataset("google_ads_rsa_assets", () => upsertBatch(supabase, "google_ads_rsa_assets",
      rsaAssetsRaw.map((r) => rsaAssetToDbRow(r, clientId)),
      "client_id,month,ad_id,asset_id")),
    syncDataset("ads_negative_keywords", () => replaceBatch(supabase, "ads_negative_keywords",
      negativesToDbRows([...adGroupNegRaw, ...campaignNegRaw, ...sharedNegRaw], clientId, now) as unknown as Record<string, unknown>[],
      clientId)),
    syncDataset("google_ads_ad_meta", () => upsertBatch(supabase, "google_ads_ad_meta",
      adMetaRaw.map((r) => adMetaToDbRow(r, clientId)),
      "client_id,ad_id")),
  ]);

  // ── Update dimension availability ──

  const dimensionNameForDataset = (name: string): string => {
    if (name === "google_ads_checkout_funnel") return "checkout_metrics";
    if (name === "google_ads_product_performance") return "product_performance";
    return name.replace("ads_", "").replace("_monthly", "").replace("_performance", "");
  };

  const dimRows = datasetResults.map((d) => ({
    client_id: clientId,
    dimension: dimensionNameForDataset(d.name),
    is_available: d.success && d.rows > 0,
    row_count: d.rows,
    latest_month: endDate,
    earliest_month: startDate,
    months_available: d.rows > 0 ? 13 : 0,
    is_partial: false,
    data_source: d.name === "google_ads_checkout_funnel" ? "calculated" : "google_ads",
    notes: d.error ?? null,
    synced_at: now,
  }));

  await upsertBatch(supabase, "ads_dimension_availability", dimRows, "client_id,dimension");

  // ── Compute result ──

  const succeeded = datasetResults.filter((d) => d.success).length;
  const failed = datasetResults.filter((d) => !d.success).length;
  const totalRows = datasetResults.reduce((s, d) => s + d.rows, 0);

  let status: SyncStatus;
  if (failed === 0) status = "success";
  else if (succeeded === 0) status = "failed";
  else status = "partial";

  const finishedAt = new Date().toISOString();
  const errors = datasetResults.filter((d) => d.error).map((d) => `${d.name}: ${d.error}`);

  // ── Update sync run ──

  if (runId) {
    await supabase.from("sync_runs").update({
      status,
      finished_at: finishedAt,
      datasets_attempted: datasetResults.length,
      datasets_succeeded: succeeded,
      datasets_failed: failed,
      total_rows_written: totalRows,
      dataset_results: datasetResults,
      error_summary: errors.length > 0 ? errors.join("; ") : null,
    }).eq("id", runId);
  }

  // ── Update client sync status ──

  const freshnessStatus = status === "success" ? "fresh" : status === "partial" ? "partial" : "stale";
  await supabase.from("client_sync_status").upsert({
    client_id: clientId,
    last_sync_at: finishedAt,
    last_sync_status: status,
    last_sync_run_id: runId,
    last_successful_sync_at: status === "success" ? finishedAt : undefined,
    datasets_available: succeeded,
    datasets_total: datasetResults.length,
    freshness_status: freshnessStatus,
    updated_at: finishedAt,
  }, { onConflict: "client_id" });

  return {
    runId, clientId, status,
    startedAt: now, finishedAt,
    datasetsAttempted: datasetResults.length,
    datasetsSucceeded: succeeded,
    datasetsFailed: failed,
    totalRowsWritten: totalRows,
    datasetResults,
    dateRangeStart: startDate,
    dateRangeEnd: endDate,
    errorSummary: errors.length > 0 ? errors.join("; ") : null,
  };
}
