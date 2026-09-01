import { NextRequest } from "next/server";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { createClient } from "@supabase/supabase-js";
import { syncClient } from "@/lib/sync/orchestrator";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { klantVanId } from "@/lib/tenancy/klanten";
import { credentialsVoorBureau } from "@/lib/tenancy/credentials";
import { logger } from "@/lib/logger";
import { checkDataFreshness } from "@/lib/sync/freshness";

export const maxDuration = 120; // 2 minutes for full sync

/**
 * POST /api/sync — trigger a manual sync for a single client.
 * Body: { client_id: string }
 *
 * GET /api/sync?client_id=xxx — get sync status for a client.
 */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  // Toegang: het beurs-id zit in de body, dus de middleware kan de scope niet zien; dit is
  // het route-eigen slot dat samen met O1_AUTH_ENFORCED aangaat (zie vereisKlantToegangUitBody
  // in lib/auth/server.ts).
  const toegang = await vereisKlantToegangUitBody(request, "sync:run", clientId);
  if (toegang) return toegang;

  // Het customer-id uit accounts, niet uit het globale app_settings-blob. Zie de kop van
  // lib/tenancy/klanten.ts: dat blob kent geen bureau, dus elke vraag erover was platformbreed.
  const klant = await klantVanId(supabase, clientId);
  if (!klant) {
    return Response.json({ error: `Client "${clientId}" is niet bekend` }, { status: 404 });
  }
  if (!klant.externId) {
    return Response.json({ error: `Client "${clientId}" heeft geen Google Ads koppeling` }, { status: 404 });
  }

  // De credentials van het BUREAU van deze klant. Valt terug op de omgeving zolang het bureau nog
  // niet gekoppeld heeft; `bron` maakt zichtbaar welke van de twee het werd, zodat een terugval
  // niet stil blijft. Zie de kop van lib/tenancy/credentials.ts.
  const cred = await credentialsVoorBureau(supabase, klant.agencyId);
  if (!cred) {
    return Response.json({ error: "Google Ads credentials niet geconfigureerd" }, { status: 500 });
  }
  if (cred.bron === "omgeving" && klant.agencyId) {
    logger.warn("[sync] bureau heeft geen eigen koppeling, terugval op de omgeving", {
      clientId, agencyId: klant.agencyId,
    });
  }

  try {
    const result = await syncClient({
      supabase,
      credentials: cred.credentials,
      clientId,
      customerId: klant.externId,
      syncType: "manual",
      triggeredBy: "api",
    });

    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Sync mislukt" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // De invoer eerst, dan de omgeving. Andersom kreeg een verzoek zonder client_id een 500
  // ("de server is stuk") terwijl het antwoord een 400 hoort te zijn ("je verzoek klopt niet"),
  // en kon de demo-check niet werken omdat de route al had afgehaakt.
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  // Get sync status
  const { data: status } = await supabase
    .from("client_sync_status")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  // Get recent runs
  const { data: runs } = await supabase
    .from("sync_runs")
    .select("id, sync_type, status, started_at, finished_at, datasets_succeeded, datasets_failed, total_rows_written, error_summary")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(5);

  // freshness_status op client_sync_status wordt eenmalig geschreven aan het eind van een
  // sync-run (lib/sync/orchestrator.ts) en blijft daarna "fresh" staan, ook maanden nadat de
  // sync is opgehouden te draaien -- de kolom zegt "de laatste run die draaide, slaagde", niet
  // "de data is nu actueel". checkDataFreshness() herrekent dat live uit last_sync_at, precies
  // zoals SyncStatusBadge dat client-side ook al doet; deze route deed dat niet en gaf de rauwe
  // kolom door aan wie hem ook maar aanroept. Zie docs/MASTERPLAN.md sectie 2.1.
  const freshness = await checkDataFreshness(supabase, clientId);

  return Response.json({
    syncStatus: status
      ? { ...status, freshness_status: freshness.freshnessStatus }
      : { client_id: clientId, freshness_status: freshness.freshnessStatus, last_sync_at: null },
    recentRuns: runs ?? [],
  });
}
