// =====================================================================
// STATUS: LIVE-ONGETEST EN GATED OP APP-REVIEW. Spiegelt het LinkedIn-sync-route-patroon;
// de onderliggende lib/meta/sync.ts is unit-getest maar het echte insights-pad is pas
// tegen een echte token en account te verifieren.
//
// CREDENTIALS: bring your own key (lib/tenancy/kanaal-credentials.ts). Het bureau levert
// zijn eigen app plus long-lived token via scripts/koppel-byo.ts; de omgeving is terugval
// voor de dag dat het product een eigen goedgekeurde app heeft. De bron wordt gelogd:
// een sync die stil op de verkeerde sleutels draait is precies wat dat model moet voorkomen.
//
// TOKEN-VERLOOP: Meta's long-lived token vervalt na ~60 dagen en kent geen refresh-grant.
// De preflight hieronder vangt een dode token op vóór er vier async-rapportjobs draaien, en
// zet de connectie dan op "expired" -- verlengen (fb_exchange_token) is een handmatige of
// latere geautomatiseerde stap, geen stille bijvangst van een syncrun.
// =====================================================================

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { metaCredentialsVoorKlant } from "@/lib/tenancy/kanaal-credentials";
import { syncMetaBackfill, syncMetaDaily, syncMetaBreakdowns, type SyncContext, type MetaLevel } from "@/lib/meta/sync";
import { controleerIngest, metaIngestChecks } from "@/lib/sync/invarianten";
import { trailingWindow, todayUTC } from "@/lib/meta/sync-windows";
import { META_GRAPH_BASE } from "@/lib/meta/api-version";
import { logger } from "@/lib/logger";

export const maxDuration = 300; // backfill kan lang duren

const log = logger.child("meta-sync-route");

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function lastCompleteMonthEnd(now = new Date()): string {
  const currentMonth = now.getUTCMonth() + 1;
  const year = currentMonth === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * POST /api/sync/meta — trigger een sync voor een client.
 * Body: { client_id: string, scope?: "backfill" | "daily" }
 *
 * GET /api/sync/meta?client_id=xxx — sync-status voor een client.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  let scope: "backfill" | "daily";
  try {
    const body = await request.json();
    clientId = body.client_id;
    scope = body.scope === "backfill" ? "backfill" : "daily";
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: 'Verwacht: { client_id: string, scope?: "backfill" | "daily" }' }, { status: 400 });
  }

  const creds = await metaCredentialsVoorKlant(supabase, clientId);
  if (!creds) return Response.json({ error: "Meta-credentials niet geconfigureerd (kluis noch omgeving)" }, { status: 500 });
  log.info(`credentials voor ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  // Het ad-account-id voor deze client uit de connectie. token_ref op deze rij wordt bewust
  // NIET gelezen: die kolom stamt uit het oude per-klant-tokenontwerp (W0.1); tokens lopen
  // sinds het bureaumodel (migratie 062) per bureau via de kluis.
  const { data: conn } = await supabase
    .from("meta_connections")
    .select("ad_account_id, status")
    .eq("client_id", clientId)
    .maybeSingle();
  const rawAccountId = (conn as { ad_account_id?: string } | null)?.ad_account_id;
  if (!rawAccountId) {
    return Response.json({ error: `Client "${clientId}" heeft geen Meta-koppeling (meta_connections)` }, { status: 404 });
  }
  const accountId = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;

  // Preflight: is de token nog levend? Eén goedkope GET in plaats van vier async-jobs die
  // allemaal op dezelfde dode token stuklopen. Foutcode 190 is Meta's "invalid/expired token".
  const ping = (await (await fetch(`${META_GRAPH_BASE}/${accountId}?fields=account_status&access_token=${creds.accessToken}`)).json()) as { error?: { code?: number; message?: string } };
  if (ping.error) {
    const verlopen = ping.error.code === 190;
    await supabase.from("meta_connections").update({
      status: verlopen ? "expired" : "error",
      last_error: ping.error.message ?? "onbekende Graph-fout",
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);
    return Response.json({ error: `Meta-preflight faalde: ${ping.error.message ?? "onbekende fout"}` }, { status: 502 });
  }

  const { data: runRow } = await supabase
    .from("meta_sync_runs")
    .insert({ client_id: clientId, scope, status: "running" })
    .select("id")
    .single();
  const runId = (runRow as { id?: string } | null)?.id;

  try {
    const ctx: SyncContext = { supabase, clientId, accountId, accessToken: creds.accessToken };

    // Zelfde tweedeling als LinkedIn (zie de toelichting daar): backfill stopt bij de laatste
    // afgesloten maand, de daily loopt tot vandaag met het 28-daagse trailing venster omdat
    // Meta conversies met terugwerkende kracht herschrijft binnen het attributievenster.
    const backfillEnd = lastCompleteMonthEnd();
    const dailyEnd = todayUTC();

    let rowsUpserted: Record<string, unknown>;
    const failed: string[] = [];
    if (scope === "backfill") {
      const outcome = await syncMetaBackfill(ctx, backfillEnd);
      // Breakdowns alleen over de laatste twee afgesloten maanden: de lezers zijn
      // maand-verankerd (alleen latestMonth telt), dus diepere breakdown-historie heeft
      // geen afnemer en zou de backfill met tientallen extra async-jobs belasten.
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
    // Ingest-invarianten over het venster van deze run (zie lib/sync/invarianten.ts): de
    // level-pin en niet-negatieve metrics die alleen op echte data kunnen breken.
    const invariantVenster = scope === "backfill" ? trailingWindow(backfillEnd, 62).since : trailingWindow(dailyEnd, 28).since;
    const invarianten = await controleerIngest(supabase, clientId, metaIngestChecks(invariantVenster));
    if (!invarianten.ok) failed.push(...invarianten.schendingen.map((s) => `invariant: ${s}`));
    rowsUpserted.invarianten = { ok: invarianten.ok, gecontroleerd: invarianten.gecontroleerd };

    const success = failed.length === 0;

    if (runId) {
      await supabase.from("meta_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: success ? "completed" : "failed",
        rows_upserted: rowsUpserted,
        ...(success ? {} : { error: `ophalen/schrijven mislukt: ${failed.join("; ")}` }),
      }).eq("id", runId);
    }
    await supabase.from("meta_connections").update({
      last_sync_at: new Date().toISOString(),
      status: "active",
      last_error: success ? null : failed.join("; ").slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);

    if (!success) {
      return Response.json({ ok: false, client_id: clientId, scope, rows_upserted: rowsUpserted, failed, credential_bron: creds.bron }, { status: 502 });
    }
    return Response.json({ ok: true, client_id: clientId, scope, rows_upserted: rowsUpserted, credential_bron: creds.bron });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync mislukt";
    if (runId) await supabase.from("meta_sync_runs").update({ finished_at: new Date().toISOString(), status: "failed", error: message }).eq("id", runId);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const { data: runs } = await supabase
    .from("meta_sync_runs")
    .select("id, started_at, finished_at, scope, status, rows_upserted, error")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(5);

  const { data: conn } = await supabase
    .from("meta_connections")
    .select("status, last_sync_at, last_error")
    .eq("client_id", clientId)
    .maybeSingle();

  return Response.json({ connection: conn ?? { status: "missing" }, recentRuns: runs ?? [] });
}
