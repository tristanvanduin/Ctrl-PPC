import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncClient, type SyncResult } from "@/lib/sync/orchestrator";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import { synckandidaten } from "@/lib/tenancy/klanten";
import { credentialsVoorBureau } from "@/lib/tenancy/credentials";
import { kanaalKoppelingen, KANAAL_RUNS, type SyncKanaal } from "@/lib/sync/kanaal-runs";
import { noteerOvergeslagenSync, meldSyncStilstand } from "@/lib/sync/cron-sporen";
import { sorteerOpStaleness, verdeelTijdbudget, draaiMetPool, GOOGLE_GELIJKTIJDIG } from "@/lib/sync/cron-planning";
import { eis, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

/**
 * GET /api/sync/cron — Nightly scheduled sync for all active clients.
 *
 * Secured with CRON_SECRET header to prevent unauthorized access.
 * Designed to be called by:
 * - Vercel Cron Jobs (vercel.json)
 * - External cron service (e.g., cron-job.org)
 * - Supabase Edge Functions
 *
 * Eerst de Google Ads-klanten (stalest-first, drie tegelijk, binnen Googles deel van het
 * tijdbudget), daarna de kanaalkoppelingen (Meta/LinkedIn/Microsoft) via exact dezelfde runs
 * als de handmatige routes (lib/sync/kanaal-runs.ts), in hun eigen venster. Beide vensters
 * tellen vanaf de INVOCATIESTART en liggen binnen maxDuration; wat niet meer past wordt als
 * "doorgeschoven" gerapporteerd en staat door de staleness-volgorde de volgende nacht vooraan.
 * De verdeling en de pool staan in lib/sync/cron-planning.ts, met de reden erbij (zeventig
 * klanten, tien minuten). Een garantie tegen maxDuration midden in een run is het niet -- een
 * Meta-daily kost in het slechtste geval meer dan de eindmarge (elf async-rapportjobs met elk
 * een pollplafond van een minuut). Wordt dat doorschuiven of afbreken structureel, dan is de
 * volgende stap de bestaande queue-mechaniek (zie app/api/cron/process-action-queue) -- niet
 * een langere timeout.
 */

export const maxDuration = 600;
// Het tijdbudget wordt per run verdeeld (lib/sync/cron-planning.ts): Google en de kanalen
// krijgen elk een venster binnen maxDuration, stalest-first, drie Google-klanten tegelijk.

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
  const kandidaten = await synckandidaten(supabase, { bron: "google-ads", agencyId: agencyFilter });

  // Stalest-first (zie lib/sync/cron-planning.ts): wie het langst niet gesynct is gaat voor,
  // en wat vannacht buiten het tijdbudget valt staat morgen vooraan. Een onleesbare
  // statustabel is een fout die de hele run stopt -- zonder volgorde zou dezelfde staart elke
  // nacht buiten de boot vallen, en dat is precies wat deze cron niet meer mag.
  const laatsteSync = new Map<string, string | null>();
  if (kandidaten.length > 0) {
    const statusRes = await supabase.from("client_sync_status").select("client_id, last_successful_sync_at")
      .in("client_id", kandidaten.map((k) => k.clientId)).limit(2000);
    try {
      for (const r of eis(statusRes, "client_sync_status (cronvolgorde)") as { client_id: unknown; last_successful_sync_at: unknown }[]) {
        laatsteSync.set(String(r.client_id ?? ""), r.last_successful_sync_at ? String(r.last_successful_sync_at) : null);
      }
    } catch (e) {
      return dataFoutNaarResponse(e) ?? Response.json({ error: e instanceof Error ? e.message : "Onbekende fout" }, { status: 500 });
    }
  }
  const clients = sorteerOpStaleness(kandidaten, laatsteSync);

  // De kanaalkoppelingen (Meta/LinkedIn/Microsoft) staan los van de Google-lijst: een klant
  // kan best alleen een Microsoft-koppeling hebben. Alleen als BEIDE leeg zijn is er niets
  // te doen.
  const { paren: koppelingen, fouten: koppelingFouten } = await kanaalKoppelingen(supabase);
  if (clients.length === 0 && koppelingen.length === 0 && koppelingFouten.length === 0) {
    return Response.json({ error: "Geen clients met een advertentiekoppeling" }, { status: 404 });
  }

  const budget = verdeelTijdbudget({ maxDurationMs: maxDuration * 1000, kanaalParen: koppelingen.length });
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
  // De cache bewaart de BELOFTE, niet de uitkomst: drie klanten van hetzelfde bureau starten
  // tegelijk, en zonder dat zouden ze alle drie de kluis raadplegen voordat de eerste klaar is.
  const db = supabase;
  const credPerBureau = new Map<string, Promise<Awaited<ReturnType<typeof credentialsVoorBureau>>>>();
  function credsVoor(agencyId: string | null) {
    const sleutel = agencyId ?? "(geen bureau)";
    let belofte = credPerBureau.get(sleutel);
    if (!belofte) {
      belofte = credentialsVoorBureau(db, agencyId);
      credPerBureau.set(sleutel, belofte);
    }
    return belofte;
  }

  type KlantUitkomst = { clientId: string; status: string; rows: number; error?: string };
  async function syncEenKlant(client: (typeof clients)[number]): Promise<KlantUitkomst> {
    try {
      const cred = await credsVoor(client.agencyId);
      if (!cred) {
        // Een spoor in sync_runs en client_sync_status, anders staat de tabel maanden op
        // "laatste run geslaagd" terwijl er elke nacht niets gebeurt (zie lib/sync/cron-sporen.ts).
        const reden = "geen credentials: het bureau heeft geen actieve Google Ads-koppeling (agency_connections) en de omgeving heeft geen terugval-token";
        const spoor = await noteerOvergeslagenSync(db, { clientId: client.clientId, customerId: client.externId ?? null, reden });
        return { clientId: client.clientId, status: "failed", rows: 0, error: spoor.ok ? reden : `${reden}; spoor niet geschreven: ${spoor.fout}` };
      }

      // `db` en niet `supabase`: binnen deze geneste functie houdt TypeScript de vernauwing
      // van de vroege return hierboven niet vast.
      const result: SyncResult = await syncClient({
        supabase: db,
        credentials: cred.credentials,
        clientId: client.clientId,
        customerId: client.externId!,
        syncType: "scheduled",
        triggeredBy: "cron",
      });

      await syncMerchantProductSnapshots({
        supabase: db,
        clientId: client.clientId,
        credentials: cred.credentials,
      });

      return { clientId: client.clientId, status: result.status, rows: result.totalRowsWritten };
    } catch (err) {
      return { clientId: client.clientId, status: "failed", rows: 0, error: err instanceof Error ? err.message : "Onbekende fout" };
    }
  }

  // Drie tegelijk, stalest-first, en geen nieuwe klant meer zodra Googles deel van het budget
  // op is. Wat overblijft is "doorgeschoven": geen mislukking, morgen vooraan.
  const google = await draaiMetPool(clients, GOOGLE_GELIJKTIJDIG, () => Date.now() - invocatieStart < budget.googleStopMs, syncEenKlant);
  for (const uitkomst of google.uitkomsten) {
    results.push(uitkomst);
    if (uitkomst.status === "success" || uitkomst.status === "partial") succeeded++;
    else failed++;
  }
  for (const client of google.doorgeschoven) {
    results.push({ clientId: client.clientId, status: "doorgeschoven", rows: 0, error: "tijdbudget op; volgende nacht als eerste aan de beurt" });
  }
  const googleGestart = google.uitkomsten.length;

  // Een hele ronde zonder één geslaagde Google-sync is een storing, geen rustige nacht. Alleen
  // over de klanten die echt gestart zijn: een ronde die door het budget niets kon starten is
  // een ander verhaal (en staat als doorgeschoven in het antwoord).
  if (googleGestart > 0 && succeeded === 0) {
    await meldSyncStilstand(supabase, { totaal: googleGestart, gefaald: failed, voorbeeld: results.find((r) => r.error)?.error ?? null });
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
    if (Date.now() - invocatieStart > budget.kanaalStopMs) {
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
    gestart: googleGestart,
    succeeded,
    failed,
    doorgeschoven: google.doorgeschoven.length,
    planning: { volgorde: "stalest-first", gelijktijdig: GOOGLE_GELIJKTIJDIG, googleStopMs: budget.googleStopMs, kanaalStopMs: budget.kanaalStopMs, duurMs: Date.now() - invocatieStart },
    results,
    kanalen: {
      totaal: koppelingen.length,
      // Een koppelingstabel die niet gelezen kon worden: die kanalen zijn deze nacht NIET
      // gedraaid, en dat hoort in de samenvatting, niet als "0 koppelingen".
      koppelingFouten,
      geslaagd: kanaalGeslaagd,
      gefaald: kanaalGefaald,
      doorgeschoven,
      results: kanaalResults,
    },
  });
}
