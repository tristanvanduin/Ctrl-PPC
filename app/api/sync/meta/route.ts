// =====================================================================
// Dunne HTTP-wrapper om draaiMetaSync in lib/sync/kanaal-runs.ts -- de orkestratie woont
// daar, zodat de nachtcron (/api/sync/cron) exact dezelfde code draait als deze knop.
// Zie de kop van kanaal-runs.ts voor status (LIVE-ONGETEST) en het BYO-credentialmodel.
// =====================================================================

import { NextRequest } from "next/server";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { draaiMetaSync } from "@/lib/sync/kanaal-runs";

export const maxDuration = 300; // backfill kan lang duren

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
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

  // Toegang: het beurs-id zit in de body, dus de middleware kan de scope niet zien; dit is
  // het route-eigen slot dat samen met O1_AUTH_ENFORCED aangaat (zie vereisKlantToegangUitBody
  // in lib/auth/server.ts).
  const toegang = await vereisKlantToegangUitBody(request, "sync:run", clientId);
  if (toegang) return toegang;

  try {
    const uitkomst = await draaiMetaSync(supabase, clientId, scope);
    if (uitkomst.soort === "geen_koppeling") return Response.json({ error: uitkomst.melding }, { status: 404 });
    if (uitkomst.soort === "geen_credentials") return Response.json({ error: uitkomst.melding }, { status: 500 });
    if (uitkomst.soort === "token_probleem") return Response.json({ error: uitkomst.melding }, { status: 502 });
    const body = { ok: uitkomst.ok, client_id: clientId, scope, rows_upserted: uitkomst.rowsUpserted, credential_bron: uitkomst.bron };
    if (!uitkomst.ok) return Response.json({ ...body, failed: uitkomst.failed }, { status: 502 });
    return Response.json(body);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Sync mislukt" }, { status: 500 });
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
