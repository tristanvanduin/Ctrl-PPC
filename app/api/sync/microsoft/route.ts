// =====================================================================
// STATUS: LIVE-ONGETEST EN GATED OP EEN DEVELOPER TOKEN. Spiegelt het Meta/LinkedIn-
// sync-route-patroon; de onderliggende lib/microsoft/sync.ts bouwt op unit-geteste
// transformkernen, maar het echte Reporting/Campaign Management-pad is pas tegen een
// echt account met een echt developer token te verifieren.
//
// CREDENTIALS: bring your own key (lib/tenancy/kanaal-credentials.ts) -- het bureau
// levert zijn eigen Azure-app, refresh token en developer token via scripts/koppel-byo.ts.
//
// TOKENROTATIE: Microsoft geeft bij elke refresh een NIEUW refresh token terug; dat wordt
// hier direct teruggeschreven naar de kluis. Niet terugschrijven laat de volgende run op
// een dood token draaien -- een fout die pas een dag later zichtbaar zou worden.
// =====================================================================

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { microsoftCredentialsVoorKlant, bewaarGeroteerdRefreshToken } from "@/lib/tenancy/kanaal-credentials";
import { refreshMicrosoftToken, type MicrosoftApiConfig } from "@/lib/microsoft/api";
import { syncMicrosoftBackfill, syncMicrosoftDaily, type MicrosoftSyncContext } from "@/lib/microsoft/sync";
import { controleerIngest, microsoftIngestChecks } from "@/lib/sync/invarianten";
import { todayUTC, trailingWindow } from "@/lib/meta/sync-windows";
import { logger } from "@/lib/logger";

export const maxDuration = 300; // backfill kan lang duren

const log = logger.child("microsoft-sync-route");

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
 * POST /api/sync/microsoft — trigger een sync voor een client.
 * Body: { client_id: string, scope?: "backfill" | "daily" }
 *
 * GET /api/sync/microsoft?client_id=xxx — sync-status voor een client.
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

  const creds = await microsoftCredentialsVoorKlant(supabase, clientId);
  if (!creds) return Response.json({ error: "Microsoft-credentials niet geconfigureerd (kluis noch omgeving)" }, { status: 500 });
  log.info(`credentials voor ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  const { data: conn } = await supabase
    .from("microsoft_connections")
    .select("account_id, customer_id, status")
    .eq("client_id", clientId)
    .maybeSingle();
  const accountId = (conn as { account_id?: string } | null)?.account_id;
  if (!accountId) {
    return Response.json({ error: `Client "${clientId}" heeft geen Microsoft-koppeling (microsoft_connections)` }, { status: 404 });
  }
  // De rij-kolom wint van de kluis-payload: het customer-id is per klant, de kluis per bureau.
  const customerId = (conn as { customer_id?: string } | null)?.customer_id ?? creds.customerId;
  if (!customerId) {
    return Response.json({ error: "Geen customer_id bekend (microsoft_connections noch kluis-payload)" }, { status: 400 });
  }

  const token = await refreshMicrosoftToken(creds);
  if (!token) {
    await supabase.from("microsoft_connections").update({
      status: "expired",
      last_error: "Token-refresh faalde",
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);
    return Response.json({ error: "Microsoft token-refresh faalde" }, { status: 502 });
  }
  // Rotatie direct vastleggen, vóór de sync zelf: als de run halverwege sneuvelt is het
  // nieuwe token dan al veilig, en het oude was op het moment van uitgifte al vervallen.
  if (token.refreshToken && creds.bron === "bureau" && creds.agencyId) {
    const bewaard = await bewaarGeroteerdRefreshToken(supabase, creds.agencyId, "microsoft_ads", token.refreshToken);
    if (!bewaard.ok) log.error(`geroteerd refresh token NIET bewaard voor bureau ${creds.agencyId}: ${bewaard.fout}`);
  } else if (token.refreshToken && creds.bron === "omgeving") {
    // Een omgevings-token kan niet worden teruggeschreven; dat is een bekende beperking van
    // de terugval en de reden dat het bureaumodel de norm is.
    log.warn("Microsoft roteerde het refresh token maar de bron is de omgeving; werk MICROSOFT_ADS_REFRESH_TOKEN handmatig bij.");
  }

  const cfg: MicrosoftApiConfig = {
    accessToken: token.accessToken,
    developerToken: creds.developerToken,
    customerId,
    accountId,
  };

  const { data: runRow } = await supabase
    .from("microsoft_sync_runs")
    .insert({ client_id: clientId, scope, status: "running" })
    .select("id")
    .single();
  const runId = (runRow as { id?: string } | null)?.id;

  try {
    const ctx: MicrosoftSyncContext = { supabase, clientId, cfg };
    // Zelfde tweedeling als LinkedIn/Meta: backfill stopt bij de laatste afgesloten maand,
    // de daily loopt tot vandaag (conversie-herstatement binnen het attributievenster).
    const einde = scope === "backfill" ? lastCompleteMonthEnd() : todayUTC();
    const uitkomst = scope === "backfill"
      ? await syncMicrosoftBackfill(ctx, einde)
      : await syncMicrosoftDaily(ctx, todayUTC());

    // Ingest-invarianten over het venster van deze run: de aannames van de lezers (level-pins,
    // fractieschalen, geen negatieve metrics) die alleen op echte data kunnen breken. Een
    // schending maakt de run mislukt -- scheve data als "completed" administreren is
    // gevaarlijker dan een duidelijke fout.
    const invarianten = await controleerIngest(supabase, clientId, microsoftIngestChecks(
      trailingWindow(einde, 28).since, `${einde.slice(0, 7)}-01`
    ));
    if (!invarianten.ok) uitkomst.failed.push(...invarianten.schendingen.map((s) => `invariant: ${s}`));

    const success = uitkomst.failed.length === 0;
    const rowsUpserted: Record<string, unknown> = Object.fromEntries(Object.entries(uitkomst.perOnderdeel).map(([naam, o]) => [naam, o.rows]));
    rowsUpserted.invarianten = { ok: invarianten.ok, gecontroleerd: invarianten.gecontroleerd };

    if (runId) {
      await supabase.from("microsoft_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: success ? "completed" : "failed",
        rows_upserted: rowsUpserted,
        ...(success ? {} : { error: `ophalen/schrijven mislukt: ${uitkomst.failed.join("; ")}`.slice(0, 1000) }),
      }).eq("id", runId);
    }
    await supabase.from("microsoft_connections").update({
      last_sync_at: new Date().toISOString(),
      status: "active",
      last_error: success ? null : uitkomst.failed.join("; ").slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);

    if (!success) {
      return Response.json({ ok: false, client_id: clientId, scope, rows_upserted: rowsUpserted, failed: uitkomst.failed, credential_bron: creds.bron }, { status: 502 });
    }
    return Response.json({ ok: true, client_id: clientId, scope, rows_upserted: rowsUpserted, credential_bron: creds.bron });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync mislukt";
    if (runId) await supabase.from("microsoft_sync_runs").update({ finished_at: new Date().toISOString(), status: "failed", error: message }).eq("id", runId);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const { data: runs } = await supabase
    .from("microsoft_sync_runs")
    .select("id, started_at, finished_at, scope, status, rows_upserted, error")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(5);

  const { data: conn } = await supabase
    .from("microsoft_connections")
    .select("status, last_sync_at, last_error")
    .eq("client_id", clientId)
    .maybeSingle();

  return Response.json({ connection: conn ?? { status: "missing" }, recentRuns: runs ?? [] });
}
