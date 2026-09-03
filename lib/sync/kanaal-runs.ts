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
  bewaarGeroteerdRefreshToken, type LinkedInSyncCredentials, type MicrosoftSyncCredentials,
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
import { DataLaagFout, eis } from "@/lib/analysis/db-veilig";
import { projecteerNaarFactCore } from "./projectie";
import { logger } from "@/lib/logger";

const log = logger.child("kanaal-runs");

// ── Kanaalronde 3 september 2026 ─────────────────────────────────────────────
//
// Grondwaarheid van die dag: geen enkele echte klant had een rij in meta_connections,
// linkedin_connections of microsoft_connections, en niets in de app kon er een aanmaken (alleen
// de bureau-OAuth bestond). Elke kanaalsync eindigde dus in "geen_koppeling" -- zonder spoor,
// want de run-rij werd pas ná de koppelingscontrole aangemaakt. Sindsdien:
//
//   1. Een queryfout op de koppelingstabel is een FOUT (DataLaagFout), geen "geen koppeling".
//   2. Een mislukte insert van de run-rij breekt de run af: een sync zonder administratie is
//      een spook op elke statuspagina.
//   3. "geen credentials" en "token kapot" laten een failed-run-rij na, zodat de statuspagina
//      en de nachtcron-samenvatting laten zien WAAROM er niets gesynct is.
//   4. last_sync_at op de koppelingsrij wordt alleen bij een GESLAAGDE run gezet; de dagstand
//      (lib/sync/datastand.ts) leest hem als "laatste geslaagde sync".
//   5. Een koppeling met status "disabled" synct ook handmatig niet: uitgezet is uitgezet.

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
  const { data, error } = await supabase.from(tabel).insert({ client_id: clientId, scope, status: "running" }).select("id").single();
  if (error) throw new DataLaagFout(`${tabel} (run starten)`, error.message);
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Een run die niet eens kon beginnen (geen credentials, token kapot) krijgt tóch een rij: een
 * failed-run met de reden. Anders staat er "laatste run: 3 maanden geleden, geslaagd" terwijl
 * er elke nacht een poging strandt.
 */
export async function noteerKanaalRunMislukt(
  supabase: SupabaseClient,
  tabel: string,
  clientId: string,
  scope: SyncScope,
  reden: string
): Promise<void> {
  const nu = new Date().toISOString();
  const { error } = await supabase.from(tabel).insert({
    client_id: clientId, scope, status: "failed", started_at: nu, finished_at: nu,
    rows_upserted: {}, error: reden.slice(0, 1000),
  });
  if (error) log.error(`${tabel}: failed-run-rij voor ${clientId} niet geschreven: ${error.message}`);
}

/** De koppelingsrij van een klant. Een queryfout is een fout, geen "geen koppeling". */
async function leesConnectie<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  tabel: string,
  kolommen: string,
  clientId: string
): Promise<T | null> {
  const res = await supabase.from(tabel).select(kolommen).eq("client_id", clientId).maybeSingle();
  if (res.error) throw new DataLaagFout(`${tabel} (koppeling)`, res.error.message);
  return (res.data as T | null) ?? null;
}

/**
 * Vangnet tussen startRun en schrijfRun: een gegooide fout (netwerk, DNS, een Supabase-hik
 * in de invariantencheck) is een MISLUKTE run en hoort zo geadministreerd. Zonder dit bleef
 * de run-rij eeuwig op "running" staan -- een spook-sync op de statuspagina en in elke
 * vastgelopen-run-bewaking. De fout gaat daarna gewoon door naar de aanroeper (route: 500;
 * cron: zijn eigen samenvatting), alleen de administratie klopt nu eerst.
 */
async function metRunAdministratie(
  supabase: SupabaseClient,
  runTabel: string,
  runId: string | null,
  fn: () => Promise<KanaalRunUitkomst>
): Promise<KanaalRunUitkomst> {
  try {
    return await fn();
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    await schrijfRun(supabase, runTabel, runId, false, { exception: melding.slice(0, 500) }, [melding]);
    throw e;
  }
}

async function schrijfConnectie(
  supabase: SupabaseClient,
  tabel: string,
  clientId: string,
  success: boolean,
  failed: string[]
): Promise<void> {
  // last_sync_at is "laatste GESLAAGDE sync": een mislukte run laat hem staan en zet alleen de
  // fout. Voorheen schoof hij bij elke poging op, en las "gesynct: vannacht" als "data van
  // vannacht" terwijl de run gefaald was.
  await supabase.from(tabel).update({
    ...(success ? { last_sync_at: new Date().toISOString() } : {}),
    status: "active",
    last_error: success ? null : failed.join("; ").slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("client_id", clientId);
}

// ── Meta ────────────────────────────────────────────────────────────────────

export async function draaiMetaSync(supabase: SupabaseClient, clientId: string, scope: SyncScope): Promise<KanaalRunUitkomst> {
  // token_ref op deze rij wordt bewust NIET gelezen: die kolom stamt uit het oude
  // per-klant-tokenontwerp (W0.1); tokens lopen sinds het bureaumodel (migratie 062) per
  // bureau via de kluis.
  const conn = await leesConnectie<{ ad_account_id?: string; status?: string }>(supabase, "meta_connections", "ad_account_id, status", clientId);
  const rawAccountId = conn?.ad_account_id;
  if (!rawAccountId) return { soort: "geen_koppeling", melding: `Client "${clientId}" heeft geen Meta-koppeling (meta_connections)` };
  if (conn?.status === "disabled") return { soort: "geen_koppeling", melding: `De Meta-koppeling van "${clientId}" staat uit (disabled); koppel opnieuw via Instellingen` };
  const accountId = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;

  const creds = await metaCredentialsVoorKlant(supabase, clientId);
  if (!creds) {
    const melding = "Meta-credentials niet geconfigureerd: het bureau heeft geen actieve Meta-koppeling (agency_connections) en de omgeving heeft geen META_ADS_ACCESS_TOKEN";
    await noteerKanaalRunMislukt(supabase, "meta_sync_runs", clientId, scope, melding);
    return { soort: "geen_credentials", melding };
  }
  log.info(`meta ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  // Preflight: is de token nog levend? Eén goedkope GET in plaats van vier async-jobs die
  // allemaal op dezelfde dode token stuklopen. Foutcode 190 is Meta's "invalid/expired token".
  const ping = (await (await fetch(`${META_GRAPH_BASE}/${accountId}?fields=account_status&access_token=${creds.accessToken}`)).json()) as { error?: { code?: number; message?: string } };
  if (ping.error) {
    await supabase.from("meta_connections").update({
      status: ping.error.code === 190 ? "expired" : "error",
      last_error: ping.error.message ?? "onbekende Graph-fout",
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);
    const melding = `Meta-preflight faalde: ${ping.error.message ?? "onbekende fout"}`;
    await noteerKanaalRunMislukt(supabase, "meta_sync_runs", clientId, scope, melding);
    return { soort: "token_probleem", melding };
  }

  const runId = await startRun(supabase, "meta_sync_runs", clientId, scope);
  return metRunAdministratie(supabase, "meta_sync_runs", runId, async () => {
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

    // Projectie naar fact_core (lib/sync/projectie.ts): de app leest meta_account_daily en
    // consorten sinds migratie 054 als views over fact_core, dus zonder deze stap ziet niemand
    // wat hierboven is geschreven. Geen projectie is geen sync.
    const projectie = await projecteerNaarFactCore(supabase, clientId);
    if (!projectie.ok) failed.push(projectie.fout);
    rowsUpserted.projectie = projectie.ok;

    const success = failed.length === 0;
    await schrijfRun(supabase, "meta_sync_runs", runId, success, rowsUpserted, failed);
    await schrijfConnectie(supabase, "meta_connections", clientId, success, failed);
    return { soort: "klaar", ok: success, rowsUpserted, failed, bron: creds.bron };
  });
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

// In-memory access-token-cache (60s buffer), gekeyd op het refresh token: verschillende
// bureaus dragen verschillende sleutels, en een globale cache zou bureau B stilletjes op het
// token van bureau A laten syncen.
const cachedTokens = new Map<string, { token: string; expiresAt: number }>();
/** Exported voor de koppelflow (accountlijst ophalen): dezelfde cache, dezelfde rotatie-afhandeling. */
export async function linkedinAccessToken(supabase: SupabaseClient, creds: LinkedInSyncCredentials): Promise<string | null> {
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
  const conn = await leesConnectie<{ ad_account_urn?: string; status?: string }>(supabase, "linkedin_connections", "ad_account_urn, status", clientId);
  const accountUrn = conn?.ad_account_urn;
  if (!accountUrn) return { soort: "geen_koppeling", melding: `Client "${clientId}" heeft geen LinkedIn-koppeling (linkedin_connections)` };
  if (conn?.status === "disabled") return { soort: "geen_koppeling", melding: `De LinkedIn-koppeling van "${clientId}" staat uit (disabled); koppel opnieuw via Instellingen` };

  const creds = await linkedinCredentialsVoorKlant(supabase, clientId);
  if (!creds) {
    const melding = "LinkedIn-credentials niet geconfigureerd: het bureau heeft geen actieve LinkedIn-koppeling (agency_connections) en de omgeving heeft geen LINKEDIN_REFRESH_TOKEN";
    await noteerKanaalRunMislukt(supabase, "linkedin_sync_runs", clientId, scope, melding);
    return { soort: "geen_credentials", melding };
  }
  log.info(`linkedin ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  const accessToken = await linkedinAccessToken(supabase, creds);
  if (!accessToken) {
    await supabase.from("linkedin_connections").update({ status: "expired", last_error: "Token-refresh faalde", updated_at: new Date().toISOString() }).eq("client_id", clientId);
    await noteerKanaalRunMislukt(supabase, "linkedin_sync_runs", clientId, scope, "LinkedIn token-refresh faalde");
    return { soort: "token_probleem", melding: "LinkedIn token-refresh faalde" };
  }

  const runId = await startRun(supabase, "linkedin_sync_runs", clientId, scope);
  return metRunAdministratie(supabase, "linkedin_sync_runs", runId, async () => {
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

    // Zelfde projectie als bij Meta: de LinkedIn-views lezen uit fact_core.
    const projectie = await projecteerNaarFactCore(supabase, clientId);
    if (!projectie.ok) failed.push(projectie.fout);

    const success = failed.length === 0;
    await schrijfRun(supabase, "linkedin_sync_runs", runId, success, rowsUpserted, failed);
    await schrijfConnectie(supabase, "linkedin_connections", clientId, success, failed);
    return {
      soort: "klaar", ok: success, rowsUpserted, failed, bron: creds.bron,
      entities: { campaigns: campaignUrns.length, creatives: creativeUrns.length },
    };
  });
}

// ── Microsoft ───────────────────────────────────────────────────────────────

/**
 * Een access token uit het refresh token, mét de rotatie direct vastgelegd: Microsoft geeft bij
 * elke refresh een nieuw refresh token uit en het oude is dan al vervallen. Wie hier omheen
 * ververst zonder te bewaren, breekt de koppeling voor de volgende nacht. Daarom één plek, ook
 * voor de koppelflow (accountlijst ophalen). Null als de refresh geweigerd is.
 */
export async function microsoftAccessToken(supabase: SupabaseClient, creds: MicrosoftSyncCredentials): Promise<string | null> {
  const token = await refreshMicrosoftToken(creds);
  if (!token) return null;
  if (token.refreshToken && creds.bron === "bureau" && creds.agencyId) {
    const bewaard = await bewaarGeroteerdRefreshToken(supabase, creds.agencyId, "microsoft_ads", token.refreshToken);
    if (!bewaard.ok) log.error(`geroteerd refresh token NIET bewaard voor bureau ${creds.agencyId}: ${bewaard.fout}`);
  } else if (token.refreshToken && creds.bron === "omgeving") {
    log.warn("Microsoft roteerde het refresh token maar de bron is de omgeving; werk MICROSOFT_ADS_REFRESH_TOKEN handmatig bij.");
  }
  return token.accessToken;
}

export async function draaiMicrosoftSync(supabase: SupabaseClient, clientId: string, scope: SyncScope): Promise<KanaalRunUitkomst> {
  const conn = await leesConnectie<{ account_id?: string; customer_id?: string | null; status?: string }>(supabase, "microsoft_connections", "account_id, customer_id, status", clientId);
  const accountId = conn?.account_id;
  if (!accountId) return { soort: "geen_koppeling", melding: `Client "${clientId}" heeft geen Microsoft-koppeling (microsoft_connections)` };
  if (conn?.status === "disabled") return { soort: "geen_koppeling", melding: `De Microsoft-koppeling van "${clientId}" staat uit (disabled); koppel opnieuw via Instellingen` };

  const creds = await microsoftCredentialsVoorKlant(supabase, clientId);
  if (!creds) {
    const melding = "Microsoft-credentials niet geconfigureerd: het bureau heeft geen actieve Microsoft Advertising-koppeling (agency_connections) en de omgeving heeft geen MICROSOFT_ADS_*-terugval";
    await noteerKanaalRunMislukt(supabase, "microsoft_sync_runs", clientId, scope, melding);
    return { soort: "geen_credentials", melding };
  }
  log.info(`microsoft ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  // De rij-kolom wint van de kluis-payload: het customer-id is per klant, de kluis per bureau.
  const customerId = conn?.customer_id ?? creds.customerId;
  if (!customerId) return { soort: "geen_koppeling", melding: "Geen customer_id bekend (microsoft_connections noch kluis-payload)" };

  const accessToken = await microsoftAccessToken(supabase, creds);
  if (!accessToken) {
    await supabase.from("microsoft_connections").update({ status: "expired", last_error: "Token-refresh faalde", updated_at: new Date().toISOString() }).eq("client_id", clientId);
    await noteerKanaalRunMislukt(supabase, "microsoft_sync_runs", clientId, scope, "Microsoft token-refresh faalde");
    return { soort: "token_probleem", melding: "Microsoft token-refresh faalde" };
  }

  const cfg: MicrosoftApiConfig = { accessToken, developerToken: creds.developerToken, customerId, accountId };
  const runId = await startRun(supabase, "microsoft_sync_runs", clientId, scope);
  return metRunAdministratie(supabase, "microsoft_sync_runs", runId, async () => {
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
  });
}

// ── Voor de nachtcron: welke klanten hebben welke kanaalkoppeling ───────────

export type SyncKanaal = "meta" | "linkedin" | "microsoft";

export const KANAAL_RUNS: Record<SyncKanaal, (supabase: SupabaseClient, clientId: string, scope: SyncScope) => Promise<KanaalRunUitkomst>> = {
  meta: draaiMetaSync,
  linkedin: draaiLinkedinSync,
  microsoft: draaiMicrosoftSync,
};

export const KANAAL_TABELLEN: Record<SyncKanaal, { koppeling: string; runs: string }> = {
  meta: { koppeling: "meta_connections", runs: "meta_sync_runs" },
  linkedin: { koppeling: "linkedin_connections", runs: "linkedin_sync_runs" },
  microsoft: { koppeling: "microsoft_connections", runs: "microsoft_sync_runs" },
};

/**
 * Alle (klant, kanaal)-paren met een actieve koppeling. "disabled" doet bewust niet mee
 * (handmatig uitgezet); "expired"/"error" wél -- de nachtelijke poging is precies het moment
 * waarop een herstelde token weer moet gaan lopen, en een mislukking wordt gewoon opnieuw
 * geadministreerd.
 *
 * Een tabel die niet gelezen kan worden komt terug in `fouten`, per tabel: de cron kan dan de
 * andere kanalen gewoon draaien én in zijn samenvatting zeggen welke lijst ontbrak. Voorheen
 * las een queryfout hier als "nul koppelingen", en dat is precies de stilte waar deze ronde
 * tegen bouwt.
 */
export async function kanaalKoppelingen(supabase: SupabaseClient): Promise<{ paren: { clientId: string; kanaal: SyncKanaal }[]; fouten: string[] }> {
  const paren: { clientId: string; kanaal: SyncKanaal }[] = [];
  const fouten: string[] = [];
  for (const kanaal of Object.keys(KANAAL_TABELLEN) as SyncKanaal[]) {
    const tabel = KANAAL_TABELLEN[kanaal].koppeling;
    try {
      const res = await supabase.from(tabel).select("client_id, status").neq("status", "disabled");
      const rijen = eis(res, `${tabel} (koppelingen)`) as { client_id?: string }[];
      for (const rij of rijen) {
        if (rij.client_id) paren.push({ clientId: String(rij.client_id), kanaal });
      }
    } catch (e) {
      const melding = e instanceof Error ? e.message : String(e);
      log.error(`kanaalkoppelingen ${tabel} niet gelezen: ${melding}`);
      fouten.push(melding);
    }
  }
  return { paren, fouten };
}
