import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncClient, type SyncResult } from "@/lib/sync/orchestrator";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import { synckandidaten } from "@/lib/tenancy/klanten";
import { credentialsVoorBureau } from "@/lib/tenancy/credentials";
import { kanaalKoppelingen, KANAAL_RUNS, type SyncKanaal } from "@/lib/sync/kanaal-runs";

/**
 * GET /api/sync/cron — Nightly scheduled sync for all active clients.
 *
 * Secured with CRON_SECRET header to prevent unauthorized access.
 * Designed to be called by:
 * - Vercel Cron Jobs (vercel.json)
 * - External cron service (e.g., cron-job.org)
 * - Supabase Edge Functions
 *
 * Eerst alle Google Ads-klanten sequentieel (rate-limit-vriendelijk), daarna de
 * kanaalkoppelingen (Meta/LinkedIn/Microsoft) via exact dezelfde runs als de handmatige
 * routes (lib/sync/kanaal-runs.ts). De kanaalrondes staan onder een tijdbudget dat vanaf de
 * INVOCATIESTART telt (de Google-ronde eet dus van hetzelfde budget): een nieuw
 * (klant, kanaal)-paar start alleen als er nog ruim marge onder maxDuration zit, en wat niet
 * meer past wordt als "doorgeschoven" gerapporteerd. Dat VERKLEINT de kans dat maxDuration
 * midden in een run valt; een garantie is het niet -- een Meta-daily kost in het slechtste
 * geval meer dan de marge (elf async-rapportjobs met elk een pollplafond van een minuut).
 * Wordt dat doorschuiven of afbreken structureel, dan is de volgende stap de bestaande
 * queue-mechaniek (zie app/api/cron/process-action-queue) -- niet een langere timeout.
 */

export const maxDuration = 600;
// Na dit punt start geen nieuw kanaalpaar meer: de resterende ~420s dekken het gangbare
// geval (rapportjobs zijn doorgaans in seconden klaar) met ruime marge.
const KANAAL_TIJDBUDGET_MS = 180_000;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}


export async function GET(request: NextRequest) {
  // Het anker voor het kanaal-tijdbudget: vanaf hier telt ALLES mee, ook de Google-ronde.
  // Een anker ná de Google-lus gaf het kanaalblok een eigen budget bovenop een onbegrensde
  // Google-ronde -- samen ruim voorbij maxDuration.
  const invocatieStart = Date.now();

  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });


  // ── DE KLANTENLIJST KOMT UIT accounts, NIET UIT HET GLOBALE BLOB ──────────
  //
  // Hier stond app_settings.api_clients: één JSON-rij met alle klanten van het hele platform,
  // zonder agency_id. Deze cron synct wat daarin staat, dus zodra er een tweede bureau is,
  // draaien diens accounts mee in deze run -- met de credentials van dit bureau.
  //
  // `accounts` heeft de bureaukoppeling wel. De aanroeper kan een bureau meegeven via
  // ?agency_id=; zonder dat blijft het gedrag platformbreed, zoals het vandaag is. Zie de kop
  // van lib/tenancy/klanten.ts.
  const agencyFilter = request.nextUrl.searchParams.get("agency_id");
  const clients = await synckandidaten(supabase, { bron: "google-ads", agencyId: agencyFilter });

  // De kanaalkoppelingen (Meta/LinkedIn/Microsoft) staan los van de Google-lijst: een klant
  // kan best alleen een Microsoft-koppeling hebben. Alleen als BEIDE leeg zijn is er niets
  // te doen.
  const koppelingen = await kanaalKoppelingen(supabase);
  if (clients.length === 0 && koppelingen.length === 0) {
    return Response.json({ error: "Geen clients met een advertentiekoppeling" }, { status: 404 });
  }

  // Sync clients sequentially (rate limit friendly)
  const results: Array<{ clientId: string; status: string; rows: number; error?: string }> = [];
  let succeeded = 0;
  let failed = 0;

  // ── DE CREDENTIALS PER BUREAU, ÉÉN KEER OPGEHAALD ─────────────────────────
  //
  // Niet per klant: een bureau heeft één MCC waar al zijn klanten onder hangen, dus per klant
  // ophalen betekent zeventig keer hetzelfde geheim uit de kluis halen. Deze cache leeft alleen
  // binnen deze run, en de klantenlijst is op bureau gesorteerd noch gegroepeerd -- vandaar een
  // Map en geen "vorige".
  // In een lokale constante, want binnen de geneste functie hieronder houdt TypeScript de
  // vernauwing van de vroege return niet vast.
  const db = supabase;
  const credPerBureau = new Map<string, Awaited<ReturnType<typeof credentialsVoorBureau>>>();
  async function credsVoor(agencyId: string | null) {
    const sleutel = agencyId ?? "(geen bureau)";
    if (!credPerBureau.has(sleutel)) {
      credPerBureau.set(sleutel, await credentialsVoorBureau(db, agencyId));
    }
    return credPerBureau.get(sleutel) ?? null;
  }

  for (const client of clients) {
    try {
      const cred = await credsVoor(client.agencyId);
      if (!cred) {
        failed++;
        results.push({ clientId: client.clientId, status: "failed", rows: 0, error: "geen credentials" });
        continue;
      }

      const result: SyncResult = await syncClient({
        supabase,
        credentials: cred.credentials,
        clientId: client.clientId,
        customerId: client.externId!,
        syncType: "scheduled",
        triggeredBy: "cron",
      });

      await syncMerchantProductSnapshots({
        supabase,
        clientId: client.clientId,
        credentials: cred.credentials,
      });

      results.push({
        clientId: client.clientId,
        status: result.status,
        rows: result.totalRowsWritten,
      });

      if (result.status === "success" || result.status === "partial") {
        succeeded++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      results.push({
        clientId: client.clientId,
        status: "failed",
        rows: 0,
        error: err instanceof Error ? err.message : "Onbekende fout",
      });
    }
  }

  // ── DE KANAALRONDES: META, LINKEDIN, MICROSOFT ────────────────────────────
  //
  // Daily-scope, dezelfde runs als de handmatige routes. Fouten per (klant, kanaal) stoppen
  // de ronde niet: elk paar administreert zijn eigen uitkomst in zijn *_sync_runs-tabel, en
  // deze respons vat samen. agency_id-filter geldt hier niet -- de koppelingstabellen dragen
  // geen agency_id; de credential-resolutie per klant pakt vanzelf het juiste bureau.
  const kanaalResults: Array<{ clientId: string; kanaal: SyncKanaal; status: string; detail?: string }> = [];
  let kanaalGeslaagd = 0;
  let kanaalGefaald = 0;
  let doorgeschoven = 0;

  for (const { clientId, kanaal } of koppelingen) {
    if (Date.now() - invocatieStart > KANAAL_TIJDBUDGET_MS) {
      doorgeschoven++;
      kanaalResults.push({ clientId, kanaal, status: "doorgeschoven", detail: "tijdbudget op; volgende nacht opnieuw" });
      continue;
    }
    try {
      const uitkomst = await KANAAL_RUNS[kanaal](supabase, clientId, "daily");
      if (uitkomst.soort === "klaar" && uitkomst.ok) {
        kanaalGeslaagd++;
        kanaalResults.push({ clientId, kanaal, status: "success" });
      } else {
        kanaalGefaald++;
        kanaalResults.push({
          clientId, kanaal, status: "failed",
          detail: uitkomst.soort === "klaar" ? uitkomst.failed.join("; ").slice(0, 300) : uitkomst.melding,
        });
      }
    } catch (err) {
      kanaalGefaald++;
      kanaalResults.push({ clientId, kanaal, status: "failed", detail: err instanceof Error ? err.message : "Onbekende fout" });
    }
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    totalClients: clients.length,
    succeeded,
    failed,
    results,
    kanalen: {
      totaal: koppelingen.length,
      geslaagd: kanaalGeslaagd,
      gefaald: kanaalGefaald,
      doorgeschoven,
      results: kanaalResults,
    },
  });
}
