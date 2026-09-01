// =====================================================================
// STATUS: ORKESTRATIE OP GEVERIFIEERDE KERNEN, HTTP LIVE-ONGETEST -- zelfde grens als
// lib/meta/sync.ts. De transform en vensters zijn unit-getest; draaiReport() en de
// Campaign Management-calls zijn pas tegen een echt developer token te verifieren.
//
// De sync schrijft exact de tabellen die de analyse leest (lib/microsoft/analysis-data.ts):
// drie dagtabellen, breakdowns op level "account", drie maandtabellen, het profiel en de
// twee entiteitstabellen. Een tabel zonder lezer wordt niet gesynct.
// =====================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draaiReport, bouwReportRequest, fetchMicrosoftCampaigns, fetchMicrosoftAdGroups,
  type MicrosoftApiConfig,
} from "./api";
import {
  parseReportCsv, naarDagRij, naarBreakdownRij, naarKeywordMaandRij, naarZoektermMaandRij,
  naarImpressieAandeelRij, aggregeerProfielRijen, naarCampagneRij, naarAdGroupRij,
  normaliseerNetwerk, normaliseerApparaat, PROFIEL_PIVOTS,
} from "./transform";
// Kanaal-agnostische datumvensters; ze wonen bij Meta omdat ze daar het eerst nodig waren.
// Een eigen kopie hier zou precies de dubbele-hulpjes-val zijn die de hygienepoort bewaakt.
import { trailingWindow, backfillWindow, monthlyChunks } from "@/lib/meta/sync-windows";
import { recordFetchFailure, withFetchFailures } from "@/lib/api/fetch-failures";
import { logger } from "@/lib/logger";

const log = logger.child("microsoft-sync");

export interface MicrosoftSyncContext {
  supabase: SupabaseClient;
  clientId: string;
  cfg: MicrosoftApiConfig;
}

export interface MicrosoftSyncOutcome {
  rows: number;
  success: boolean;
  error?: string;
}

// De gedeelde metriekkolommen van elk performance-rapport. ConversionsQualified en niet
// Conversions: de klassieke kolom is sinds 2022 afgeschaft en levert structureel "0"
// (geverifieerd in de v13-docs; zie ook conversies() in transform.ts). Beide worden
// opgevraagd zodat de transform kan terugvallen als de nieuwe kolom leeg blijkt.
const METRIEKEN = ["Impressions", "Clicks", "Spend", "ConversionsQualified", "Conversions", "Revenue"];

async function upsert(
  ctx: MicrosoftSyncContext,
  tabel: string,
  rijen: Record<string, unknown>[],
  onConflict: string,
  bron: string
): Promise<MicrosoftSyncOutcome> {
  if (rijen.length === 0) return { rows: 0, success: true };
  const { error } = await ctx.supabase.from(tabel).upsert(rijen, { onConflict, ignoreDuplicates: false });
  if (error) {
    recordFetchFailure(`microsoft:${bron}:upsert`, error.message, "microsoft");
    log.error("Upsert mislukt voor", tabel, error.message);
    return { rows: 0, success: false, error: error.message };
  }
  return { rows: rijen.length, success: true };
}

function dedupe(rijen: Record<string, unknown>[], sleutel: string[]): Record<string, unknown>[] {
  const gezien = new Map<string, Record<string, unknown>>();
  for (const rij of rijen) gezien.set(sleutel.map((k) => String(rij[k])).join("|"), rij);
  return [...gezien.values()];
}

/** Draait één rapport en geeft de geparste rijen; een gefaald rapport wordt een outcome, geen exception. */
async function rapportRijen(
  ctx: MicrosoftSyncContext,
  bron: string,
  request: Record<string, unknown>
): Promise<{ rijen: Record<string, string>[]; fout: string | null }> {
  try {
    const csv = await draaiReport(ctx.cfg, request);
    return { rijen: parseReportCsv(csv), fout: null };
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e);
    recordFetchFailure(`microsoft:${bron}`, fout, "microsoft");
    return { rijen: [], fout };
  }
}

// ── Dagtabellen ─────────────────────────────────────────────────────────────

const DAG_SPECS = [
  { bron: "account", type: "AccountPerformanceReportRequest", idKolom: null, tabel: "microsoft_account_daily", extra: [] as string[] },
  { bron: "campaign", type: "CampaignPerformanceReportRequest", idKolom: "CampaignId", tabel: "microsoft_campaign_daily", extra: ["CampaignId", "CampaignName"] },
  { bron: "adgroup", type: "AdGroupPerformanceReportRequest", idKolom: "AdGroupId", tabel: "microsoft_adgroup_daily", extra: ["CampaignId", "AdGroupId", "AdGroupName"] },
];

export async function syncMicrosoftDagen(ctx: MicrosoftSyncContext, since: string, until: string): Promise<Record<string, MicrosoftSyncOutcome>> {
  const uitkomsten: Record<string, MicrosoftSyncOutcome> = {};
  for (const spec of DAG_SPECS) {
    const { rijen, fout } = await rapportRijen(ctx, spec.bron, bouwReportRequest({
      type: spec.type, aggregation: "Daily", accountId: ctx.cfg.accountId, since, until,
      columns: ["TimePeriod", ...spec.extra, ...METRIEKEN],
    }));
    if (fout) { uitkomsten[spec.bron] = { rows: 0, success: false, error: fout }; continue; }
    const dbRijen = rijen
      .map((r) => naarDagRij(r, ctx.clientId, spec.idKolom ? (r[spec.idKolom] ?? "").trim() : ctx.cfg.accountId))
      .filter((r): r is Record<string, unknown> => r !== null);
    uitkomsten[spec.bron] = await upsert(ctx, spec.tabel, dedupe(dbRijen, ["client_id", "date", "entity_id"]), "client_id,date,entity_id", spec.bron);
  }
  return uitkomsten;
}

// ── Breakdowns (level "account": netwerk en apparaat) ───────────────────────

const BREAKDOWN_SPECS = [
  { bron: "breakdown:network", breakdownType: "network" as const, kolom: "Network", normaliseer: normaliseerNetwerk },
  { bron: "breakdown:device", breakdownType: "device" as const, kolom: "DeviceType", normaliseer: normaliseerApparaat },
];

export async function syncMicrosoftBreakdowns(ctx: MicrosoftSyncContext, since: string, until: string): Promise<MicrosoftSyncOutcome & { failed: string[] }> {
  let totaal = 0;
  const failed: string[] = [];
  for (const spec of BREAKDOWN_SPECS) {
    const { rijen, fout } = await rapportRijen(ctx, spec.bron, bouwReportRequest({
      type: "AccountPerformanceReportRequest", aggregation: "Daily", accountId: ctx.cfg.accountId, since, until,
      columns: ["TimePeriod", spec.kolom, ...METRIEKEN],
    }));
    if (fout) { failed.push(spec.breakdownType); continue; }
    const dbRijen = rijen
      .map((r) => naarBreakdownRij(r, ctx.clientId, ctx.cfg.accountId, spec.breakdownType, spec.normaliseer(r[spec.kolom] ?? "")))
      .filter((r): r is Record<string, unknown> => r !== null);
    const uitkomst = await upsert(
      ctx, "microsoft_breakdown_daily",
      dedupe(dbRijen, ["client_id", "date", "level", "entity_id", "breakdown_type", "breakdown_value"]),
      "client_id,date,level,entity_id,breakdown_type,breakdown_value", spec.bron
    );
    if (!uitkomst.success) failed.push(spec.breakdownType);
    totaal += uitkomst.rows;
  }
  return { rows: totaal, success: failed.length === 0, failed };
}

// ── Maandtabellen ───────────────────────────────────────────────────────────

export async function syncMicrosoftMaandtabellen(
  ctx: MicrosoftSyncContext,
  since: string,
  until: string,
  budgetPerCampagne: Map<string, number>
): Promise<Record<string, MicrosoftSyncOutcome>> {
  const uitkomsten: Record<string, MicrosoftSyncOutcome> = {};

  const keyword = await rapportRijen(ctx, "keyword", bouwReportRequest({
    type: "KeywordPerformanceReportRequest", aggregation: "Monthly", accountId: ctx.cfg.accountId, since, until,
    columns: ["TimePeriod", "CampaignId", "CampaignName", "AdGroupId", "AdGroupName", "KeywordId", "Keyword", "BidMatchType", "QualityScore", ...METRIEKEN],
  }));
  uitkomsten.keyword = keyword.fout
    ? { rows: 0, success: false, error: keyword.fout }
    : await upsert(ctx, "microsoft_keyword_monthly",
        dedupe(keyword.rijen.map((r) => naarKeywordMaandRij(r, ctx.clientId)).filter((r): r is Record<string, unknown> => r !== null), ["client_id", "keyword_id", "month"]),
        "client_id,keyword_id,month", "keyword");

  const zoekterm = await rapportRijen(ctx, "search_terms", bouwReportRequest({
    type: "SearchQueryPerformanceReportRequest", aggregation: "Monthly", accountId: ctx.cfg.accountId, since, until,
    columns: ["TimePeriod", "CampaignId", "CampaignName", "AdGroupId", "AdGroupName", "SearchQuery", "BidMatchType", ...METRIEKEN],
  }));
  uitkomsten.search_terms = zoekterm.fout
    ? { rows: 0, success: false, error: zoekterm.fout }
    : await upsert(ctx, "microsoft_search_terms_monthly",
        dedupe(zoekterm.rijen.map((r) => naarZoektermMaandRij(r, ctx.clientId)).filter((r): r is Record<string, unknown> => r !== null), ["client_id", "search_term", "campaign_name", "ad_group_name", "month"]),
        "client_id,search_term,campaign_name,ad_group_name,month", "search_terms");

  const aandeel = await rapportRijen(ctx, "impression_share", bouwReportRequest({
    type: "CampaignPerformanceReportRequest", aggregation: "Monthly", accountId: ctx.cfg.accountId, since, until,
    columns: ["TimePeriod", "CampaignId", "CampaignName", "CampaignType", "ImpressionSharePercent", "ImpressionLostToBudgetPercent", "ImpressionLostToRankAggPercent", ...METRIEKEN],
  }));
  uitkomsten.impression_share = aandeel.fout
    ? { rows: 0, success: false, error: aandeel.fout }
    : await upsert(ctx, "microsoft_campaign_impression_share",
        dedupe(aandeel.rijen.map((r) => naarImpressieAandeelRij(r, ctx.clientId, budgetPerCampagne, until)).filter((r): r is Record<string, unknown> => r !== null), ["client_id", "campaign_id", "month"]),
        "client_id,campaign_id,month", "impression_share");

  // Profiel (LinkedIn-targeting): ÉÉN rapport, geen drie -- de v13-docs eisen de drie
  // naamkolommen plus AccountName/AdGroupName verplicht samen (zie aggregeerProfielRijen in
  // transform.ts). De rapportrijen zijn het kruisproduct van de dimensies; de aggregatie
  // per pivot gebeurt in de transform.
  const profiel = await rapportRijen(ctx, "profile", bouwReportRequest({
    type: "ProfessionalDemographicsAudienceReportRequest", aggregation: "Monthly", accountId: ctx.cfg.accountId, since, until,
    columns: ["TimePeriod", "AccountName", "AdGroupName", ...PROFIEL_PIVOTS.map((p) => p.kolom), ...METRIEKEN],
  }));
  uitkomsten.profile = profiel.fout
    ? { rows: 0, success: false, error: profiel.fout }
    : await upsert(ctx, "microsoft_profile_monthly",
        aggregeerProfielRijen(profiel.rijen, ctx.clientId),
        "client_id,month,pivot_type,pivot_value", "profile");

  return uitkomsten;
}

// ── Entiteiten ──────────────────────────────────────────────────────────────

export async function syncMicrosoftEntiteiten(ctx: MicrosoftSyncContext): Promise<{ uitkomst: MicrosoftSyncOutcome; budgetPerCampagne: Map<string, number> }> {
  const budgetPerCampagne = new Map<string, number>();
  try {
    const campagnes = await fetchMicrosoftCampaigns(ctx.cfg);
    const campagneRijen = campagnes.map((c) => naarCampagneRij(c, ctx.clientId)).filter((r): r is Record<string, unknown> => r !== null);
    for (const rij of campagneRijen) {
      const budget = rij.daily_budget;
      if (typeof budget === "number" && budget > 0) budgetPerCampagne.set(String(rij.campaign_id), budget);
    }
    const camp = await upsert(ctx, "microsoft_campaigns", campagneRijen, "campaign_id", "campaigns");
    if (!camp.success) return { uitkomst: camp, budgetPerCampagne };

    let adgroupRijen: Record<string, unknown>[] = [];
    for (const rij of campagneRijen) {
      const adgroups = await fetchMicrosoftAdGroups(ctx.cfg, Number(rij.campaign_id));
      adgroupRijen = adgroupRijen.concat(
        adgroups.map((ag) => naarAdGroupRij(ag, String(rij.campaign_id), ctx.clientId)).filter((r): r is Record<string, unknown> => r !== null)
      );
    }
    const ag = await upsert(ctx, "microsoft_adgroups", adgroupRijen, "adgroup_id", "adgroups");
    return { uitkomst: { rows: camp.rows + ag.rows, success: ag.success, error: ag.error }, budgetPerCampagne };
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e);
    recordFetchFailure("microsoft:entiteiten", fout, "microsoft");
    return { uitkomst: { rows: 0, success: false, error: fout }, budgetPerCampagne };
  }
}

// ── De twee scopes ──────────────────────────────────────────────────────────

export interface MicrosoftScopeUitkomst {
  perOnderdeel: Record<string, MicrosoftSyncOutcome>;
  rows: number;
  failed: string[];
}

function verzamel(perOnderdeel: Record<string, MicrosoftSyncOutcome>): MicrosoftScopeUitkomst {
  const failed = Object.entries(perOnderdeel).filter(([, o]) => !o.success).map(([naam, o]) => `${naam}: ${o.error ?? "onbekende fout"}`);
  const rows = Object.values(perOnderdeel).reduce((som, o) => som + o.rows, 0);
  return { perOnderdeel, rows, failed };
}

/**
 * Daily incremental: entiteiten vers, dagtabellen en breakdowns over het 28-daagse trailing
 * venster (conversie-herstatement), maandtabellen over de lopende plus vorige maand zodat
 * de maand-tot-nu-stand elke run wordt bijgeschreven.
 */
export async function syncMicrosoftDaily(ctx: MicrosoftSyncContext, endDate: string): Promise<MicrosoftScopeUitkomst> {
  const { result } = await withFetchFailures(async () => {
    const { since, until } = trailingWindow(endDate, 28);
    const entiteiten = await syncMicrosoftEntiteiten(ctx);
    const dagen = await syncMicrosoftDagen(ctx, since, until);
    const breakdowns = await syncMicrosoftBreakdowns(ctx, since, until);
    const maandSince = `${addMaanden(endDate.slice(0, 7), -1)}-01`;
    const maanden = await syncMicrosoftMaandtabellen(ctx, maandSince, until, entiteiten.budgetPerCampagne);
    return verzamel({ entiteiten: entiteiten.uitkomst, ...dagen, breakdowns, ...maanden });
  });
  return result;
}

/**
 * Initiele backfill: dagtabellen 13 maanden in maand-chunks (de rapport-API blijft dan per
 * request behapbaar), maandtabellen in één Monthly-rapport over het hele venster,
 * breakdowns alleen de laatste twee afgesloten maanden (de lezers zijn maand-verankerd).
 */
export async function syncMicrosoftBackfill(ctx: MicrosoftSyncContext, endDate: string): Promise<MicrosoftScopeUitkomst> {
  const { result } = await withFetchFailures(async () => {
    const { since, until } = backfillWindow(endDate, 13);
    const entiteiten = await syncMicrosoftEntiteiten(ctx);

    const dagUitkomsten: Record<string, MicrosoftSyncOutcome> = {};
    for (const chunk of monthlyChunks(since, until)) {
      const deel = await syncMicrosoftDagen(ctx, chunk.since, chunk.until);
      for (const [naam, o] of Object.entries(deel)) {
        const bestaand = dagUitkomsten[naam] ?? { rows: 0, success: true };
        dagUitkomsten[naam] = {
          rows: bestaand.rows + o.rows,
          success: bestaand.success && o.success,
          error: o.error ?? bestaand.error,
        };
      }
    }

    const { since: bdSince } = trailingWindow(until, 62);
    const breakdowns = await syncMicrosoftBreakdowns(ctx, bdSince, until);
    const maanden = await syncMicrosoftMaandtabellen(ctx, since, until, entiteiten.budgetPerCampagne);
    return verzamel({ entiteiten: entiteiten.uitkomst, ...dagUitkomsten, breakdowns, ...maanden });
  });
  return result;
}

/** "2026-08" + n maanden, als "yyyy-mm". Lokale helper: de vensters in sync-windows werken op dagen. */
function addMaanden(maand: string, n: number): string {
  const [jaar, mnd] = maand.split("-").map(Number);
  const d = new Date(Date.UTC(jaar, mnd - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
