// =====================================================================
// DE KANAAL-SYNCRUNS ALS AANROEPBARE FUNCTIES -- één plek, twee aanroepers.
//
// De POST-routes (/api/sync/meta|linkedin|microsoft) en de nachtcron (/api/sync/cron)
// draaien exact dezelfde orkestratie: credentials uit de kluis, koppeling van de klant,
// token-verversing, de sync zelf, ingest-invarianten en de run-administratie. Toen die
// orkestratie alleen in de routes woonde kon de cron er niet bij zonder HTTP naar
// zichzelf te praten -- en twee kopieën van dezelfde orkestratie is precies het soort
// dubbeling dat uit elkaar groeit.
//
// STATUS: LIVE-ONGETEST langs dezelfde grens als de onderliggende syncmodules -- de
// samenstelling hier is puur verplaatste route-code; de HTTP-paden erin blijven pas
// tegen echte tokens te verifieren.
// =====================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  metaCredentialsVoorKlant, linkedinCredentialsVoorKlant, microsoftCredentialsVoorKlant,
  bewaarGeroteerdRefreshToken, type LinkedInSyncCredentials,
} from "@/lib/tenancy/kanaal-credentials";
import type { CredentialBron } from "@/lib/tenancy/credentials";
import { syncMetaBackfill, syncMetaDaily, syncMetaBreakdowns, type SyncContext as MetaSyncContext, type MetaLevel } from "@/lib/meta/sync";
import { META_GRAPH_BASE } from "@/lib/meta/api-version";
import { trailingWindow, todayUTC } from "@/lib/meta/sync-windows";
import { refreshAccessToken } from "@/lib/linkedin/auth";
import { syncLinkedinBackfill, syncLinkedinDaily, type LinkedInLevel, type SyncContext as LinkedInSyncContext } from "@/lib/linkedin/sync";
import {
  fetchCampaignGroups, fetchCampaigns, fetchCreatives,
  campaignGroupToDbRow, campaignToDbRow, creativeToDbRow,
} from "@/lib/linkedin/entities";
import { todayUTC as linkedinTodayUTC, addDaysISO } from "@/lib/linkedin/sync-windows";
import { refreshMicrosoftToken, type MicrosoftApiConfig } from "@/lib/microsoft/api";
import { syncMicrosoftBackfill, syncMicrosoftDaily, type MicrosoftSyncContext } from "@/lib/microsoft/sync";
import { controleerIngest, metaIngestChecks, linkedinIngestChecks, microsoftIngestChecks } from "@/lib/sync/invarianten";
import { logger } from "@/lib/logger";

const log = logger.child("kanaal-runs");

export type SyncScope = "backfill" | "daily";

export type KanaalRunUitkomst =
  | { soort: "geen_koppeling"; melding: string }
  | { soort: "geen_credentials"; melding: string }
  | { soort: "token_probleem"; melding: string }
  | { soort: "klaar"; ok: boolean; rowsUpserted: Record<string, unknown>; failed: string[]; bron: CredentialBron; entities?: Record<string, number> };

function lastCompleteMonthEnd(now = new Date()): string {
  const currentMonth = now.getUTCMonth() + 1;
  const year = currentMonth === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

async function schrijfRun(
  supabase: SupabaseClient,
  tabel: string,
  runId: string | null,
  success: boolean,
  rowsUpserted: unknown,
  failed: string[]
): Promise<void> {
  if (!runId) return;
  await supabase.from(tabel).update({
    finished_at: new Date().toISOString(),
    status: success ? "completed" : "failed",
    rows_upserted: rowsUpserted,
    ...(success ? {} : { error: `ophalen/schrijven mislukt: ${failed.join("; ")}`.slice(0, 1000) }),
  }).eq("id", runId);
}

async function startRun(supabase: SupabaseClient, tabel: string, clientId: string, scope: SyncScope): Promise<string | null> {
  const { data } = await supabase.from(tabel).insert({ client_id: clientId, scope, status: "running" }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function schrijfConnectie(
  supabase: SupabaseClient,
  tabel: string,
  clientId: string,
  success: boolean,
  failed: string[]
): Promise<void> {
  await supabase.from(tabel).update({
    last_sync_at: new Date().toISOString(),
    status: "active",
    last_error: success ? null : failed.join("; ").slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("client_id", clientId);
}

// ── Meta ────────────────────────────────────────────────────────────────────

export async function draaiMetaSync(supabase: SupabaseClient, clientId: string, scope: SyncScope): Promise<KanaalRunUitkomst> {
  const creds = await metaCredentialsVoorKlant(supabase, clientId);
  if (!creds) return { soort: "geen_credentials", melding: "Meta-credentials niet geconfigureerd (kluis noch omgeving)" };
  log.info(`meta ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  // token_ref op deze rij wordt bewust NIET gelezen: die kolom stamt uit het oude
  // per-klant-tokenontwerp (W0.1); tokens lopen sinds het bureaumodel (migratie 062) per
  // bureau via de kluis.
  const { data: conn } = await supabase.from("meta_connections").select("ad_account_id, status").eq("client_id", clientId).maybeSingle();
  const rawAccountId = (conn as { ad_account_id?: string } | null)?.ad_account_id;
  if (!rawAccountId) return { soort: "geen_koppeling", melding: `Client "${clientId}" heeft geen Meta-koppeling (meta_connections)` };
  const accountId = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;

  // Preflight: is de token nog levend? Eén goedkope GET in plaats van vier async-jobs die
  // allemaal op dezelfde dode token stuklopen. Foutcode 190 is Meta's "invalid/expired token".
  const ping = (await (await fetch(`${META_GRAPH_BASE}/${accountId}?fields=account_status&access_token=${creds.accessToken}`)).json()) as { error?: { code?: number; message?: string } };
  if (ping.error) {
    await supabase.from("meta_connections").update({
      status: ping.error.code === 190 ? "expired" : "error",
      last_error: ping.error.message ?? "onbekende Graph-fout",
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);
    return { soort: "token_probleem", melding: `Meta-preflight faalde: ${ping.error.message ?? "onbekende fout"}` };
  }

  const runId = await startRun(supabase, "meta_sync_runs", clientId, scope);
  const ctx: MetaSyncContext = { supabase, clientId, accountId, accessToken: creds.accessToken };
  const backfillEnd = lastCompleteMonthEnd();
  const dailyEnd = todayUTC();

  let rowsUpserted: Record<string, unknown>;
  const failed: string[] = [];
  if (scope === "backfill") {
    const outcome = await syncMetaBackfill(ctx, backfillEnd);
    // Breakdowns alleen over de laatste twee afgesloten maanden: de lezers zijn
    // maand-verankerd (alleen latestMonth telt), dus diepere breakdown-historie heeft geen
    // afnemer en zou de backfill met tientallen extra async-jobs belasten.
    const { since } = trailingWindow(backfillEnd, 62);
    const breakdowns = await syncMetaBreakdowns(ctx, since, backfillEnd);
    rowsUpserted = { backfill: outcome.rows, breakdowns: breakdowns.rows };
    failed.push(...outcome.failedChunks, ...breakdowns.failed.map((t) => `breakdown:${t}`));
  } else {
    const outcome = await syncMetaDaily(ctx, dailyEnd);
    const { since, until } = trailingWindow(dailyEnd, 28);
    const breakdowns = await syncMetaBreakdowns(ctx, since, until);
    rowsUpserted = Object.fromEntries((Object.keys(outcome) as MetaLevel[]).map((level) => [level, outcome[level].rows]));
    rowsUpserted.breakdowns = breakdowns.rows;
    failed.push(
      ...(Object.keys(outcome) as MetaLevel[]).filter((level) => !outcome[level].success).map((level) => `${level}: ${outcome[level].error ?? "onbekende fout"}`),
      ...breakdowns.failed.map((t) => `breakdown:${t}`),
    );
  }

  // Ingest-invarianten over het venster van deze run (zie lib/sync/invarianten.ts).
  const invariantVenster = scope === "backfill" ? trailingWindow(backfillEnd, 62).since : trailingWindow(dailyEnd, 28).since;
  const invarianten = await controleerIngest(supabase, clientId, metaIngestChecks(invariantVenster));
  if (!invarianten.ok) failed.push(...invarianten.schendingen.map((s) => `invariant: ${s}`));
  rowsUpserted.invarianten = { ok: invarianten.ok, gecontroleerd: invarianten.gecontroleerd };

  const success = failed.length === 0;
  await schrijfRun(supabase, "meta_sync_runs", runId, success, rowsUpserted, failed);
  await schrijfConnectie(supabase, "meta_connections", clientId, success, failed);
  return { soort: "klaar", ok: success, rowsUpserted, failed, bron: creds.bron };
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

// In-memory access-token-cache (60s buffer), gekeyd op het refresh token: verschillende
// bureaus dragen verschillende sleutels, en een globale cache zou bureau B stilletjes op het
// token van bureau A laten syncen.
const cachedTokens = new Map<string, { token: string; expiresAt: number }>();
async function linkedinAccessToken(supabase: SupabaseClient, creds: LinkedInSyncCredentials): Promise<string | null> {
  const bestaand = cachedTokens.get(creds.refreshToken);
  if (bestaand && bestaand.expiresAt > Date.now() + 60_000) return bestaand.token;
  const refreshed = await refreshAccessToken(creds.refreshToken, { clientId: creds.clientId, clientSecret: creds.clientSecret });
  if (!refreshed) return null;
  cachedTokens.set(creds.refreshToken, { token: refreshed.accessToken, expiresAt: Date.now() + refreshed.expiresIn * 1000 });
  if (refreshed.refreshToken && refreshed.refreshToken !== creds.refreshToken) {
    if (creds.bron === "bureau" && creds.agencyId) {
      const bewaard = await bewaarGeroteerdRefreshToken(supabase, creds.agencyId, "linkedin", refreshed.refreshToken);
      if (!bewaard.ok) log.error(`geroteerd refresh token NIET bewaard voor bureau ${creds.agencyId}: ${bewaard.fout}`);
    } else {
      log.warn("LinkedIn roteerde het refresh token maar de bron is de omgeving; werk LINKEDIN_REFRESH_TOKEN handmatig bij.");
    }
  }
  return refreshed.accessToken;
}

export async function draaiLinkedinSync(supabase: SupabaseClient, clientId: string, scope: SyncScope): Promise<KanaalRunUitkomst> {
  const creds = await linkedinCredentialsVoorKlant(supabase, clientId);
  if (!creds) return { soort: "geen_credentials", melding: "LinkedIn-credentials niet geconfigureerd (kluis noch omgeving)" };
  log.info(`linkedin ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  const { data: conn } = await supabase.from("linkedin_connections").select("ad_account_urn, status").eq("client_id", clientId).maybeSingle();
  const accountUrn = (conn as { ad_account_urn?: string } | null)?.ad_account_urn;
  if (!accountUrn) return { soort: "geen_koppeling", melding: `Client "${clientId}" heeft geen LinkedIn-koppeling` };

  const accessToken = await linkedinAccessToken(supabase, creds);
  if (!accessToken) {
    await supabase.from("linkedin_connections").update({ status: "expired", last_error: "Token-refresh faalde", updated_at: new Date().toISOString() }).eq("client_id", clientId);
    return { soort: "token_probleem", melding: "LinkedIn token-refresh faalde" };
  }

  const runId = await startRun(supabase, "linkedin_sync_runs", clientId, scope);
  const ctx: LinkedInSyncContext = { supabase, clientId, accessToken };
  const entityCtx = { accessToken };

  // Entiteiten ophalen en upserten; verzamel de URNs voor de analytics-sync.
  const groups = await fetchCampaignGroups(entityCtx, accountUrn);
  if (groups.length > 0) await supabase.from("linkedin_campaign_groups").upsert(groups.map((g) => campaignGroupToDbRow(g, clientId)), { onConflict: "group_urn" });

  const campaigns = await fetchCampaigns(entityCtx, accountUrn);
  if (campaigns.length > 0) await supabase.from("linkedin_campaigns").upsert(campaigns.map((c) => campaignToDbRow(c, clientId)), { onConflict: "campaign_urn" });
  const campaignUrns = campaigns.map((c) => String(c.id ?? c.urn)).filter(Boolean);

  const creativeUrns: string[] = [];
  for (const campaignUrn of campaignUrns) {
    const creatives = await fetchCreatives(entityCtx, campaignUrn);
    if (creatives.length > 0) {
      await supabase.from("linkedin_creatives").upsert(creatives.map((cr) => creativeToDbRow(cr, clientId)), { onConflict: "creative_urn" });
      creativeUrns.push(...creatives.map((cr) => String(cr.id ?? cr.urn)).filter(Boolean));
    }
  }

  const entitiesByLevel: Record<LinkedInLevel, string[]> = {
    account: [accountUrn],
    campaign: campaignUrns,
    creative: creativeUrns,
  };

  // Twee einddatums, en dat is het hele punt: de backfill stopt bij de laatste afgesloten
  // maand; de daily loopt tot vandaag omdat LinkedIn conversies met terugwerkende kracht
  // herschrijft binnen het attributievenster (zie lib/linkedin/sync-windows.ts).
  const backfillEnd = lastCompleteMonthEnd();
  const dailyEnd = linkedinTodayUTC();

  let rowsUpserted: Record<string, unknown>;
  let failed: string[] = [];
  if (scope === "backfill") {
    const outcome = await syncLinkedinBackfill(ctx, backfillEnd, entitiesByLevel);
    rowsUpserted = { backfill: outcome.rows };
    failed = outcome.failedChunks;
  } else {
    const outcome = await syncLinkedinDaily(ctx, dailyEnd, entitiesByLevel);
    rowsUpserted = Object.fromEntries(Object.entries(outcome).map(([level, o]) => [level, o.rows]));
    failed = Object.entries(outcome).filter(([, o]) => !o.success).map(([level, o]) => `${level}: ${o.error ?? "onbekende fout"}`);
  }

  const invariantVenster = scope === "backfill" ? addDaysISO(backfillEnd, -62) : addDaysISO(dailyEnd, -30);
  const invarianten = await controleerIngest(supabase, clientId, linkedinIngestChecks(invariantVenster));
  if (!invarianten.ok) failed.push(...invarianten.schendingen.map((s) => `invariant: ${s}`));

  const success = failed.length === 0;
  await schrijfRun(supabase, "linkedin_sync_runs", runId, success, rowsUpserted, failed);
  await schrijfConnectie(supabase, "linkedin_connections", clientId, success, failed);
  return {
    soort: "klaar", ok: success, rowsUpserted, failed, bron: creds.bron,
    entities: { campaigns: campaignUrns.length, creatives: creativeUrns.length },
  };
}

// ── Microsoft ───────────────────────────────────────────────────────────────

export async function draaiMicrosoftSync(supabase: SupabaseClient, clientId: string, scope: SyncScope): Promise<KanaalRunUitkomst> {
  const creds = await microsoftCredentialsVoorKlant(supabase, clientId);
  if (!creds) return { soort: "geen_credentials", melding: "Microsoft-credentials niet geconfigureerd (kluis noch omgeving)" };
  log.info(`microsoft ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  const { data: conn } = await supabase.from("microsoft_connections").select("account_id, customer_id, status").eq("client_id", clientId).maybeSingle();
  const accountId = (conn as { account_id?: string } | null)?.account_id;
  if (!accountId) return { soort: "geen_koppeling", melding: `Client "${clientId}" heeft geen Microsoft-koppeling (microsoft_connections)` };
  // De rij-kolom wint van de kluis-payload: het customer-id is per klant, de kluis per bureau.
  const customerId = (conn as { customer_id?: string } | null)?.customer_id ?? creds.customerId;
  if (!customerId) return { soort: "geen_koppeling", melding: "Geen customer_id bekend (microsoft_connections noch kluis-payload)" };

  const token = await refreshMicrosoftToken(creds);
  if (!token) {
    await supabase.from("microsoft_connections").update({ status: "expired", last_error: "Token-refresh faalde", updated_at: new Date().toISOString() }).eq("client_id", clientId);
    return { soort: "token_probleem", melding: "Microsoft token-refresh faalde" };
  }
  // Rotatie direct vastleggen, vóór de sync zelf: als de run halverwege sneuvelt is het
  // nieuwe token dan al veilig, en het oude was op het moment van uitgifte al vervallen.
  if (token.refreshToken && creds.bron === "bureau" && creds.agencyId) {
    const bewaard = await bewaarGeroteerdRefreshToken(supabase, creds.agencyId, "microsoft_ads", token.refreshToken);
    if (!bewaard.ok) log.error(`geroteerd refresh token NIET bewaard voor bureau ${creds.agencyId}: ${bewaard.fout}`);
  } else if (token.refreshToken && creds.bron === "omgeving") {
    log.warn("Microsoft roteerde het refresh token maar de bron is de omgeving; werk MICROSOFT_ADS_REFRESH_TOKEN handmatig bij.");
  }

  const cfg: MicrosoftApiConfig = { accessToken: token.accessToken, developerToken: creds.developerToken, customerId, accountId };
  const runId = await startRun(supabase, "microsoft_sync_runs", clientId, scope);
  const ctx: MicrosoftSyncContext = { supabase, clientId, cfg };

  const einde = scope === "backfill" ? lastCompleteMonthEnd() : todayUTC();
  const uitkomst = scope === "backfill"
    ? await syncMicrosoftBackfill(ctx, einde)
    : await syncMicrosoftDaily(ctx, todayUTC());

  const invarianten = await controleerIngest(supabase, clientId, microsoftIngestChecks(
    trailingWindow(einde, 28).since, `${einde.slice(0, 7)}-01`
  ));
  if (!invarianten.ok) uitkomst.failed.push(...invarianten.schendingen.map((s) => `invariant: ${s}`));

  const success = uitkomst.failed.length === 0;
  const rowsUpserted: Record<string, unknown> = Object.fromEntries(Object.entries(uitkomst.perOnderdeel).map(([naam, o]) => [naam, o.rows]));
  rowsUpserted.invarianten = { ok: invarianten.ok, gecontroleerd: invarianten.gecontroleerd };

  await schrijfRun(supabase, "microsoft_sync_runs", runId, success, rowsUpserted, uitkomst.failed);
  await schrijfConnectie(supabase, "microsoft_connections", clientId, success, uitkomst.failed);
  return { soort: "klaar", ok: success, rowsUpserted, failed: uitkomst.failed, bron: creds.bron };
}

// ── Voor de nachtcron: welke klanten hebben welke kanaalkoppeling ───────────

export type SyncKanaal = "meta" | "linkedin" | "microsoft";

export const KANAAL_RUNS: Record<SyncKanaal, (supabase: SupabaseClient, clientId: string, scope: SyncScope) => Promise<KanaalRunUitkomst>> = {
  meta: draaiMetaSync,
  linkedin: draaiLinkedinSync,
  microsoft: draaiMicrosoftSync,
};

/**
 * Alle (klant, kanaal)-paren met een actieve koppeling. "disabled" doet bewust niet mee
 * (handmatig uitgezet); "expired"/"error" wél -- de nachtelijke poging is precies het moment
 * waarop een herstelde token weer moet gaan lopen, en een mislukking wordt gewoon opnieuw
 * geadministreerd.
 */
export async function kanaalKoppelingen(supabase: SupabaseClient): Promise<{ clientId: string; kanaal: SyncKanaal }[]> {
  const paren: { clientId: string; kanaal: SyncKanaal }[] = [];
  const tabellen: { tabel: string; kanaal: SyncKanaal }[] = [
    { tabel: "meta_connections", kanaal: "meta" },
    { tabel: "linkedin_connections", kanaal: "linkedin" },
    { tabel: "microsoft_connections", kanaal: "microsoft" },
  ];
  for (const { tabel, kanaal } of tabellen) {
    const { data } = await supabase.from(tabel).select("client_id, status").neq("status", "disabled");
    for (const rij of (data ?? []) as { client_id?: string }[]) {
      if (rij.client_id) paren.push({ clientId: String(rij.client_id), kanaal });
    }
  }
  return paren;
}
