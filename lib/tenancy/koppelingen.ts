import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// DE PLATFORMKOPPELING PER BUREAU
// ============================================================================
//
// Zie de kop van scripts/migrations/062_bureaukoppelingen.sql voor het model. Kort:
//
//   developer token, OAuth client   →  van het product, uit de omgeving
//   refresh token, MCC/business-id  →  van het bureau, uit deze tabel
//
// Het refresh token zelf staat NIET in agency_connections maar in vault.secrets; de kolom
// token_ref wijst ernaar. Deze module is de enige plek die dat weet.
//
// ── WAAROM DE VAULT VIA RPC EN NIET VIA EEN QUERY ──────────────────────────
//
// PostgREST bedient standaard alleen het public-schema; vault.secrets ligt daarbuiten. Daarom
// gaan het schrijven en lezen via twee kleine SQL-functies in public (migratie 063), met
// SECURITY DEFINER en EXECUTE alleen voor service_role. Dat is bovendien de nauwere deur: de
// applicatie kan één geheim zetten en één geheim ophalen, en niet de hele kluis doorzoeken.

// "google_analytics" en niet "ga4": de vault-naamregex in migratie 063 (^oauth_[a-z_]+_...) staat
// geen cijfers toe in het providersegment, en "ga4" bevat er een. Bewust geen migratie om die
// regex te verruimen — een provider-naam zonder cijfer is de kleinere, veiligere wijziging. De
// GA4-module zelf (lib/ga4/) heet ongewijzigd ga4; dit is uitsluitend de OAuth-providerwaarde.
export type Provider = "google_ads" | "meta" | "linkedin" | "microsoft_ads" | "google_analytics" | "search_console";

export const PROVIDERS: readonly Provider[] = ["google_ads", "meta", "linkedin", "microsoft_ads", "google_analytics", "search_console"];

export type KoppelingStatus = "actief" | "verlopen" | "ingetrokken" | "fout";

export interface Koppeling {
  agencyId: string;
  provider: Provider;
  /** MCC-id bij Google, business-id bij Meta, organisatie-URN bij LinkedIn. */
  externalId: string | null;
  scopes: string[];
  status: KoppelingStatus;
  expiresAt: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  /** Of er een geheim aan hangt. NOOIT het geheim zelf -- dat gaat alleen via leesRefreshToken. */
  heeftToken: boolean;
}

interface Rij {
  agency_id: string;
  provider: string;
  external_id: string | null;
  token_ref: string | null;
  scopes: string[] | null;
  status: string | null;
  expires_at: string | null;
  connected_at: string | null;
  last_refreshed_at: string | null;
  last_error: string | null;
}

const KOLOMMEN =
  "agency_id, provider, external_id, token_ref, scopes, status, expires_at, connected_at, last_refreshed_at, last_error";

function naarKoppeling(r: Rij): Koppeling {
  return {
    agencyId: r.agency_id,
    provider: r.provider as Provider,
    externalId: r.external_id,
    scopes: r.scopes ?? [],
    status: (r.status ?? "fout") as KoppelingStatus,
    expiresAt: r.expires_at,
    connectedAt: r.connected_at,
    lastRefreshedAt: r.last_refreshed_at,
    lastError: r.last_error,
    heeftToken: r.token_ref != null,
  };
}

/** De naam waaronder het geheim in de vault staat. Uniek per bureau en platform. */
export function geheimNaam(agencyId: string, provider: Provider): string {
  return `oauth_${provider}_${agencyId}`;
}

/**
 * De koppeling van één bureau voor één platform, ZONDER het token.
 *
 * Dit is de functie die schermen en statuschecks gebruiken. Wie het token nodig heeft, vraagt er
 * apart om -- zo is aan de aanroep te zien dat er een geheim uit de kluis komt, en staat dat niet
 * per ongeluk in een object dat ergens gelogd wordt.
 */
export async function leesKoppeling(
  supabase: SupabaseClient,
  agencyId: string,
  provider: Provider
): Promise<Koppeling | null> {
  try {
    const { data, error } = await supabase
      .from("agency_connections").select(KOLOMMEN)
      .eq("agency_id", agencyId).eq("provider", provider).maybeSingle();
    if (error || !data) return null;
    return naarKoppeling(data as Rij);
  } catch {
    return null;
  }
}

/** Alle koppelingen van een bureau, zonder tokens. Voor het instellingenscherm. */
export async function leesKoppelingen(
  supabase: SupabaseClient,
  agencyId: string
): Promise<Koppeling[]> {
  try {
    const { data, error } = await supabase
      .from("agency_connections").select(KOLOMMEN).eq("agency_id", agencyId);
    if (error || !data) return [];
    return (data as Rij[]).map(naarKoppeling).sort((a, b) => a.provider.localeCompare(b.provider));
  } catch {
    return [];
  }
}

/**
 * Legt een verse toestemming vast: het token in de vault, de rest in de tabel.
 *
 * ── HET REFRESH TOKEN MAG NOOIT DOOR EEN LEGE WAARDE OVERSCHREVEN WORDEN ───
 *
 * Google geeft alleen een refresh token mee als de toestemming met `prompt=consent` is gevraagd.
 * Doet een bureau een herkoppeling zonder die parameter, dan komt er GEEN token terug. Zou deze
 * functie dat als "geen token" wegschrijven, dan is de koppeling stil kapot: de tabel zegt
 * actief, de kluis is leeg, en de sync valt pas 's nachts om.
 *
 * Daarom: een leeg token laat het bestaande geheim staan en werkt alleen de rest bij. Dat is de
 * veilige richting -- een oud token dat nog werkt is beter dan geen token.
 */
export async function bewaarKoppeling(
  supabase: SupabaseClient,
  input: {
    agencyId: string;
    provider: Provider;
    refreshToken?: string | null;
    externalId?: string | null;
    scopes?: string[];
    expiresAt?: string | null;
    connectedBy?: string | null;
  }
): Promise<{ ok: boolean; fout?: string }> {
  const { agencyId, provider } = input;
  try {
    let tokenRef: string | null = null;
    const token = (input.refreshToken ?? "").trim();
    if (token) {
      const { data, error } = await supabase.rpc("bewaar_oauth_geheim", {
        p_naam: geheimNaam(agencyId, provider),
        p_waarde: token,
      });
      if (error) return { ok: false, fout: `vault: ${error.message}` };
      tokenRef = data as string;
    }

    const rij: Record<string, unknown> = {
      agency_id: agencyId,
      provider,
      external_id: input.externalId ?? null,
      scopes: input.scopes ?? [],
      status: "actief",
      expires_at: input.expiresAt ?? null,
      connected_by: input.connectedBy ?? null,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    // Alleen zetten als er echt een nieuw token is; zie de opmerking hierboven.
    if (tokenRef) {
      rij.token_ref = tokenRef;
      rij.last_refreshed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("agency_connections").upsert(rij, { onConflict: "agency_id,provider" });
    if (error) return { ok: false, fout: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, fout: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Het refresh token uit de kluis. Null als er geen koppeling of geen geheim is.
 *
 * Aparte functie, en met opzet niet als veld op Koppeling: een geheim dat meelift in een object
 * belandt vroeg of laat in een logregel of een foutrapport.
 */
export async function leesRefreshToken(
  supabase: SupabaseClient,
  agencyId: string,
  provider: Provider
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("lees_oauth_geheim", {
      p_naam: geheimNaam(agencyId, provider),
    });
    if (error) return null;
    const waarde = (data as string | null) ?? null;
    return waarde && waarde.trim() ? waarde : null;
  } catch {
    return null;
  }
}

/**
 * Trekt een koppeling in: het geheim uit de kluis, de rij op 'ingetrokken'.
 *
 * De RIJ blijft staan en wordt niet verwijderd. Reden: je wilt kunnen zien dát er een koppeling
 * was en wanneer hij eindigde. Een verdwenen rij leest als "nooit gekoppeld", en dat is een ander
 * verhaal dan "de klant heeft de toegang ingetrokken".
 */
export async function trekKoppelingIn(
  supabase: SupabaseClient,
  agencyId: string,
  provider: Provider,
  reden = "ingetrokken door het bureau"
): Promise<{ ok: boolean; fout?: string }> {
  try {
    await supabase.rpc("wis_oauth_geheim", { p_naam: geheimNaam(agencyId, provider) });
    const { error } = await supabase
      .from("agency_connections")
      .update({ status: "ingetrokken", token_ref: null, last_error: reden, updated_at: new Date().toISOString() })
      .eq("agency_id", agencyId).eq("provider", provider);
    if (error) return { ok: false, fout: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, fout: e instanceof Error ? e.message : String(e) };
  }
}

/** Markeert een koppeling als kapot, met de reden erbij. Verandert het geheim niet. */
export async function markeerKoppelingFout(
  supabase: SupabaseClient,
  agencyId: string,
  provider: Provider,
  fout: string
): Promise<void> {
  try {
    await supabase.from("agency_connections")
      .update({ status: "fout", last_error: fout.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("agency_id", agencyId).eq("provider", provider);
  } catch {
    // Stil: het markeren van een fout mag geen tweede fout veroorzaken.
  }
}

// ── Verloopbewaking ─────────────────────────────────────────────────────────

/** Vanaf hoeveel dagen vóór het verlopen er gewaarschuwd wordt. */
export const VERLOOPWAARSCHUWING_DAGEN = 14;

export type Verloopoordeel =
  | { toestand: "geen_verval" }
  | { toestand: "ruim"; dagen: number }
  | { toestand: "binnenkort"; dagen: number; tekst: string }
  | { toestand: "verlopen"; dagen: number; tekst: string };

/**
 * Hoe een koppeling ervoor staat qua verval. Puur: geen database, geen klok tenzij meegegeven.
 *
 * ── WAAROM DIT ER IS ───────────────────────────────────────────────────────
 *
 * Google's refresh token verloopt niet maar kan ingetrokken worden; Meta's long-lived token
 * vervalt na ongeveer 60 dagen en LinkedIn's refresh token na ongeveer 365. Zonder bewaking merk
 * je dat op de nacht dat de sync stilvalt, en dan is de data al een dag oud voordat iemand kijkt.
 *
 * Een koppeling zonder expires_at is niet "in orde" maar "kent geen verval" -- dat onderscheid
 * staat er expliciet in, want het eerste zou een Meta-koppeling zonder datum stilzwijgend
 * goedkeuren.
 */
export function beoordeelVerval(
  expiresAt: string | null | undefined,
  nu: Date = new Date()
): Verloopoordeel {
  if (!expiresAt) return { toestand: "geen_verval" };
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return { toestand: "geen_verval" };
  const dagen = Math.floor((t - nu.getTime()) / 86_400_000);
  if (dagen < 0) {
    return {
      toestand: "verlopen",
      dagen,
      tekst: `De koppeling is ${Math.abs(dagen)} dag${Math.abs(dagen) === 1 ? "" : "en"} geleden verlopen. Opnieuw koppelen om te blijven synchroniseren.`,
    };
  }
  if (dagen <= VERLOOPWAARSCHUWING_DAGEN) {
    return {
      toestand: "binnenkort",
      dagen,
      tekst: `De koppeling verloopt over ${dagen} dag${dagen === 1 ? "" : "en"}. Koppel opnieuw voordat de synchronisatie stilvalt.`,
    };
  }
  return { toestand: "ruim", dagen };
}
