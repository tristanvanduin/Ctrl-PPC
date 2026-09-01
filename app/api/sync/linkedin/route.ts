// =====================================================================
// STATUS: LIVE-ONGETEST EN GATED OP MDP-APPROVAL (van de eigen app) OF EEN BYO-KOPPELING.
// Spiegelt het Google-sync-route-patroon (admin-client via service_role, in-memory
// token-refresh). Pas tegen een goedgekeurde app en een echt account te verifieren.
//
// CREDENTIALS: bring your own key (lib/tenancy/kanaal-credentials.ts). Het bureau levert
// zijn eigen app plus refresh token via scripts/koppel-byo.ts; de omgeving
// (LINKEDIN_CLIENT_ID/SECRET/REFRESH_TOKEN) blijft de terugval voor de dag dat de eigen
// app zijn MDP-goedkeuring heeft.
//
// TOKEN-ROTATIE: LinkedIn kan bij een refresh een geroteerd refresh token teruggeven
// (circa 60 dagen access, 12 maanden refresh). Voor een kluis-koppeling wordt dat hier
// direct teruggeschreven; voor de omgevings-terugval kan dat niet en blijft handmatig
// hernieuwen de discipline.
// =====================================================================

import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { refreshAccessToken } from "@/lib/linkedin/auth";
import { linkedinCredentialsVoorKlant, bewaarGeroteerdRefreshToken, type LinkedInSyncCredentials } from "@/lib/tenancy/kanaal-credentials";
import { logger } from "@/lib/logger";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import {
  syncLinkedinBackfill, syncLinkedinDaily, type LinkedInLevel, type SyncContext,
} from "@/lib/linkedin/sync";
import {
  fetchCampaignGroups, fetchCampaigns, fetchCreatives,
  campaignGroupToDbRow, campaignToDbRow, creativeToDbRow,
} from "@/lib/linkedin/entities";
import { controleerIngest, linkedinIngestChecks } from "@/lib/sync/invarianten";
import { todayUTC, addDaysISO } from "@/lib/linkedin/sync-windows";

export const maxDuration = 300; // backfill kan lang duren

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const log = logger.child("linkedin-sync-route");

// In-memory access-token-cache, zelfde idee als de Google-koppeling (60s buffer). Gekeyd op
// het refresh token: sinds de BYO-koppeling kunnen verschillende bureaus verschillende
// sleutels dragen, en een globale cache zou bureau B stilletjes op het token van bureau A
// laten syncen -- precies de verwisseling waarvoor de bron-administratie bestaat.
const cachedTokens = new Map<string, { token: string; expiresAt: number }>();
async function getAccessToken(
  supabase: SupabaseClient,
  creds: LinkedInSyncCredentials
): Promise<string | null> {
  const bestaand = cachedTokens.get(creds.refreshToken);
  if (bestaand && bestaand.expiresAt > Date.now() + 60_000) return bestaand.token;
  const refreshed = await refreshAccessToken(creds.refreshToken, { clientId: creds.clientId, clientSecret: creds.clientSecret });
  if (!refreshed) return null;
  cachedTokens.set(creds.refreshToken, { token: refreshed.accessToken, expiresAt: Date.now() + refreshed.expiresIn * 1000 });
  // Geroteerd refresh token direct terugschrijven (alleen mogelijk bij een kluis-koppeling).
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

function lastCompleteMonthEnd(now = new Date()): string {
  const currentMonth = now.getUTCMonth() + 1;
  const year = currentMonth === 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * POST /api/sync/linkedin — trigger een sync voor een client.
 * Body: { client_id: string, scope?: "backfill" | "daily" }
 *
 * GET /api/sync/linkedin?client_id=xxx — sync-status voor een client.
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

  // Na het parsen van de body: de resolver heeft de client nodig om het bureau te vinden.
  const creds = await linkedinCredentialsVoorKlant(supabase, clientId);
  if (!creds) return Response.json({ error: "LinkedIn-credentials niet geconfigureerd (kluis noch omgeving)" }, { status: 500 });
  log.info(`credentials voor ${clientId}: bron=${creds.bron}, eigenApp=${creds.eigenApp}`);

  // Het ad-account-URN voor deze client uit de connectie.
  const { data: conn } = await supabase
    .from("linkedin_connections")
    .select("ad_account_urn, status")
    .eq("client_id", clientId)
    .maybeSingle();
  const accountUrn = (conn as { ad_account_urn?: string } | null)?.ad_account_urn;
  if (!accountUrn) {
    return Response.json({ error: `Client "${clientId}" heeft geen LinkedIn-koppeling` }, { status: 404 });
  }

  const accessToken = await getAccessToken(supabase, creds);
  if (!accessToken) {
    await supabase.from("linkedin_connections").update({ status: "expired", last_error: "Token-refresh faalde", updated_at: new Date().toISOString() }).eq("client_id", clientId);
    return Response.json({ error: "LinkedIn token-refresh faalde" }, { status: 502 });
  }

  // Log de run-start.
  const { data: runRow } = await supabase
    .from("linkedin_sync_runs")
    .insert({ client_id: clientId, scope, status: "running" })
    .select("id")
    .single();
  const runId = (runRow as { id?: string } | null)?.id;

  try {
    const ctx: SyncContext = { supabase, clientId, accessToken };
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

    // TWEE VERSCHILLENDE EINDDATUMS, en dat is het hele punt.
    //
    // De backfill vult de geschiedenis en stopt bewust bij de laatste AFGESLOTEN maand: hij bestaat
    // om hele maanden achter elkaar te zetten, en een halve lopende maand hoort daar niet bij.
    //
    // De dagelijkse sync moet juist tot vandaag lopen. Dat ging mis: hij kreeg dezelfde
    // lastCompleteMonthEnd() mee, dus de data liep nooit verder dan de laatste dag van de vorige
    // maand -- terwijl app/api/analysis/weekly/route.ts de laatste 14 dagen opvraagt. Die twee
    // vensters overlappen na de 14e van een maand helemaal niet meer, en de weekly gaf dan een 404
    // met "Sync de data via POST /api/sync" terwijl de sync correct had gedraaid. Zonder live
    // klanten is dat nooit als storing zichtbaar geweest.
    //
    // todayUTC() bestond al in lib/linkedin/sync-windows.ts en werd buiten tests nergens gebruikt;
    // de kop van dat bestand legt ook precies uit waaróm de daily een trailing venster tot vandaag
    // nodig heeft: LinkedIn herschrijft conversies met terugwerkende kracht binnen het
    // attributievenster, dus de laatste 30 dagen worden elke run opnieuw ge-upsert. Een deels
    // gevulde dag van vandaag wordt daarmee morgen vanzelf gecorrigeerd -- dat is waar die
    // 30-daagse her-upsert voor is.
    const backfillEnd = lastCompleteMonthEnd();
    const dailyEnd = todayUTC();

    // De sync geeft nu per niveau/chunk expliciet succes of mislukking terug (voorheen alleen
    // een rijenaantal -- 0 rijen door een lege periode en 0 rijen door een mislukte fetch/upsert
    // zagen er identiek uit, dus een kapotte koppeling rapporteerde stilzwijgend "voltooid" met
    // niets gesynct). Eén mislukt niveau/chunk is genoeg om de hele run als mislukt te markeren:
    // een halve sync die zichzelf "completed" noemt is gevaarlijker dan een duidelijke fout.
    let rowsUpserted: unknown;
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
    // Ingest-invarianten over het venster van deze run (zie lib/sync/invarianten.ts): de
    // CAMPAIGN-level-pin van de demographic-lezers en niet-negatieve metrics -- aannames die
    // alleen op echte data kunnen breken.
    const invariantVenster = scope === "backfill" ? addDaysISO(backfillEnd, -62) : addDaysISO(dailyEnd, -30);
    const invarianten = await controleerIngest(supabase, clientId, linkedinIngestChecks(invariantVenster));
    if (!invarianten.ok) failed.push(...invarianten.schendingen.map((s) => `invariant: ${s}`));

    const success = failed.length === 0;

    if (runId) {
      await supabase.from("linkedin_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: success ? "completed" : "failed",
        rows_upserted: rowsUpserted,
        ...(success ? {} : { error: `ophalen/schrijven mislukt: ${failed.join("; ")}` }),
      }).eq("id", runId);
    }
    // status blijft "active": de koppeling/token werkte (anders was getAccessToken hierboven al
    // gestopt) -- alleen de analytics-fetch faalde deels. Dat is een sync-uitkomst
    // (linkedin_sync_runs.status hierboven), geen connectieprobleem; "error" is hier bewust geen
    // nieuwe statuswaarde, want de rest van de codebase kent alleen "active"/"expired".
    await supabase.from("linkedin_connections").update({
      last_sync_at: new Date().toISOString(),
      status: "active",
      last_error: success ? null : failed.join("; "),
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);

    if (!success) {
      return Response.json({
        ok: false, client_id: clientId, scope,
        entities: { campaigns: campaignUrns.length, creatives: creativeUrns.length },
        rows_upserted: rowsUpserted, failed,
      }, { status: 502 });
    }
    return Response.json({ ok: true, client_id: clientId, scope, entities: { campaigns: campaignUrns.length, creatives: creativeUrns.length }, rows_upserted: rowsUpserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync mislukt";
    if (runId) await supabase.from("linkedin_sync_runs").update({ finished_at: new Date().toISOString(), status: "failed", error: message }).eq("id", runId);
    return Response.json({ error: message }, { status: 500 });
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

  const { data: runs } = await supabase
    .from("linkedin_sync_runs")
    .select("id, started_at, finished_at, scope, status, rows_upserted, error")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(5);

  const { data: conn } = await supabase
    .from("linkedin_connections")
    .select("status, last_sync_at, last_error")
    .eq("client_id", clientId)
    .maybeSingle();

  return Response.json({ connection: conn ?? { status: "missing" }, recentRuns: runs ?? [] });
}
