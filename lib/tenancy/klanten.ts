import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// WELKE KLANTEN ER ZIJN, EN VAN WELK BUREAU
// ============================================================================
//
// ── HET PROBLEEM ────────────────────────────────────────────────────────────
//
// De serverkant las de klantenlijst uit `app_settings.api_clients`: ÉÉN JSON-rij met alle
// klanten van het hele platform. Nagemeten op 5 augustus 2026: 71 klanten, 8.243 bytes, en
// GEEN agency_id. Vier plekken lazen dat blob -- de sync-route, de nachtelijke cron, de
// analyse-helpers en de second-opinion-evaluator -- en twee daarvan hadden er een eigen,
// letterlijk identieke `getCustomerId` voor staan.
//
// Waarom dat niet houdbaar is zodra er een tweede bureau komt:
//
//   1. De nachtelijke cron synct ALLES uit dat blob. Bureau B's accounts zouden meelopen in
//      bureau A's run, met bureau A's credentials.
//   2. Er is geen manier om te vragen "welke klanten heeft bureau X" -- de informatie staat er
//      niet in.
//   3. Eén rij die door iedereen wordt overschreven: twee bureaus die tegelijk een account
//      koppelen, en de laatste schrijver wint met verlies van de ander.
//
// ── DE OPLOSSING BESTOND AL ─────────────────────────────────────────────────
//
// `accounts` heeft client_id, name, source, external_id EN agency_id. Nagemeten voordat dit
// gebouwd werd: het blob en de tabel dekken elkaar volledig -- 71 van 71 dezelfde client_id, en
// nul verschillen in external_id tegenover googleAdsCustomerId. Het blob was dus een kopie
// zonder de enige kolom die ertoe doet.
//
// Deze module is de enige plek waar de serverkant die vraag stelt. Staat in de GEDEELD-lijst van
// scripts/check-hygiene.mjs, zodat een vijfde kopie de poort niet haalt.
//
// ── WAT HIER BEWUST NIET GEBEURT ────────────────────────────────────────────
//
// De BROWSERKANT (lib/clients.ts) schrijft nog steeds naar dat blob, en leest het ook. Dat is de
// zijbalk en de klantenkiezer, en dat pad omleggen raakt localStorage, de zichtbaarheids-
// instellingen en de demo-modus tegelijk. Zolang beide kanten hetzelfde bevatten -- en dat is nu
// zo -- is dat geen fout maar een tweede spoor. Het hoort weg, en het hoort in één keer weg, met
// de schermen erbij. Niet half.

export interface Klant {
  /** De interne uuid (accounts.id) -- nodig om fact_core rechtstreeks te bevragen (account_id is
   *  daar de sleutel, niet client_id). Voor bestaande consumenten die alleen clientId gebruikten
   *  verandert er niets; dit is een toevoeging. */
  id: string;
  clientId: string;
  naam: string;
  /** "google-ads", "meta", "demo", ... */
  bron: string;
  /** Het externe account-id bij het platform. Voor Google Ads het customer-id zonder streepjes. */
  externId: string | null;
  agencyId: string | null;
}

interface AccountRij {
  id: string;
  client_id: string;
  name: string | null;
  source: string | null;
  external_id: string | null;
  agency_id: string | null;
}

function naarKlant(r: AccountRij): Klant {
  return {
    id: r.id,
    clientId: r.client_id,
    naam: r.name ?? r.client_id,
    bron: r.source ?? "onbekend",
    externId: r.external_id,
    agencyId: r.agency_id,
  };
}

const KOLOMMEN = "id, client_id, name, source, external_id, agency_id";

/**
 * Eén klant op zijn id. Null als hij niet bestaat.
 *
 * Bij een leesfout ook null, en niet een uitzondering: de aanroepers hiervan beslissen of ze
 * doorgaan zonder koppeling. Een worp zou een sync-run of een analyse afbreken op iets wat ook
 * "deze klant heeft geen Google-koppeling" kan betekenen.
 */
export async function klantVanId(
  supabase: SupabaseClient,
  clientId: string
): Promise<Klant | null> {
  try {
    const { data, error } = await supabase
      .from("accounts").select(KOLOMMEN).eq("client_id", clientId).maybeSingle();
    if (error || !data) return null;
    return naarKlant(data as AccountRij);
  } catch {
    return null;
  }
}

/**
 * Het externe account-id bij een klant, of null.
 *
 * Dit verving twee letterlijk identieke `getCustomerId`-functies (lib/analysis/helpers.ts en
 * lib/second-opinion/evaluator.ts) plus dezelfde zoekopdracht inline in de sync-route.
 */
export async function externAccountId(
  supabase: SupabaseClient,
  clientId: string
): Promise<string | null> {
  return (await klantVanId(supabase, clientId))?.externId ?? null;
}

/**
 * De klanten die gesynct moeten worden, optioneel begrensd tot één bureau.
 *
 * `bron` filtert op het platform ("google-ads"); klanten zonder extern id vallen sowieso af,
 * want daar valt niets te synchroniseren.
 *
 * ZONDER agencyId levert hij ALLE bureaus, en dat is met opzet: de nachtelijke cron draait
 * vandaag platformbreed en dat gedrag mag niet stilletjes veranderen. Maar de parameter is er
 * wél, zodat de dag dat er een tweede bureau komt de aanroeper alleen zijn eigen bureau hoeft
 * mee te geven -- en niet eerst deze functie moet herschrijven.
 */
export async function synckandidaten(
  supabase: SupabaseClient,
  opties: { bron?: string; agencyId?: string | null } = {}
): Promise<Klant[]> {
  try {
    let q = supabase.from("accounts").select(KOLOMMEN).not("external_id", "is", null);
    if (opties.bron) q = q.eq("source", opties.bron);
    if (opties.agencyId) q = q.eq("agency_id", opties.agencyId);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as AccountRij[])
      .filter((r) => (r.external_id ?? "").trim() !== "")
      .map(naarKlant)
      // Vaste volgorde: een cron die elke nacht in een andere volgorde draait, is bij een
      // afgebroken run niet te vergelijken met de vorige.
      .sort((a, b) => a.clientId.localeCompare(b.clientId));
  } catch {
    return [];
  }
}
