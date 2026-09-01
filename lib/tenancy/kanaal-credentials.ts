import type { SupabaseClient } from "@supabase/supabase-js";
import { bewaarKoppeling, leesKoppeling, leesRefreshToken, type Provider } from "./koppelingen";
import { klantVanId } from "./klanten";
import type { CredentialBron } from "./credentials";

// ============================================================================
// KANAAL-CREDENTIALS VOOR META, LINKEDIN EN MICROSOFT: BRING YOUR OWN APP
// ============================================================================
//
// Bij Google is de splitsing product-deel/bureau-deel (zie credentials.ts) mogelijk omdat het
// PRODUCT een goedgekeurde app en een developer token heeft. Voor Meta, LinkedIn en Microsoft
// is dat er (nog) niet: de eigen apps wachten op platform-goedkeuring. Tot die er is, brengt
// het bureau ALLES zelf mee -- zijn eigen geregistreerde app (client id/secret), zijn eigen
// token en bij Microsoft zijn eigen developer token. Dat is het pilotmodel: de eerste klant
// draait op zijn eigen sleutels, niet op de onze.
//
// ── HET GEHEIMFORMAAT: JSON NAAST DE PLATTE STRING ─────────────────────────
//
// De vault bewaart één geheim per (bureau, provider). Voor Google is dat een platte string:
// het refresh token, meer heeft het bureau daar niet. Voor deze kanalen kan het geheim een
// JSON-object zijn met de eigen-app-velden erbij:
//
//   { "refreshToken": "...", "clientId": "...", "clientSecret": "...",
//     "developerToken": "...", "customerId": "..." }
//
// Een platte string blijft geldig en betekent: alleen een refresh token, app-deel uit de
// omgeving. Zo kan hetzelfde geheim later, als de eigen apps zijn goedgekeurd, terug naar het
// Google-model zonder migratie: het bureau-deel krimpt, het product-deel groeit.
//
// ── DE BRON IS ZICHTBAAR, NET ALS BIJ GOOGLE ───────────────────────────────
//
// `bron` zegt waar het token vandaan kwam (bureau of omgeving) en `eigenApp` of ook het
// app-deel van het bureau kwam. Een sync die stil op de omgevings-token van het product
// terugvalt terwijl het bureau eigen sleutels heeft aangeleverd, is precies de verwisseling
// waar dit model tegen bouwt -- loggen op basis van deze velden is de bedoeling.

interface KanaalGeheim {
  refreshToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  developerToken: string | null;
  customerId: string | null;
}

/**
 * Leest het vault-geheim als JSON-payload of platte token-string.
 *
 * Exported voor de unit-test; verder alleen intern. Onparseerbare JSON (begint met "{" maar
 * faalt) telt als platte string: een half ingevuld formulier mag geen koppeling breken die
 * met een gewone token prima zou werken.
 */
export function parseKanaalGeheim(raw: string | null): KanaalGeheim {
  const leeg: KanaalGeheim = { refreshToken: null, clientId: null, clientSecret: null, developerToken: null, customerId: null };
  if (!raw || !raw.trim()) return leeg;
  const tekst = raw.trim();
  if (tekst.startsWith("{")) {
    try {
      const obj = JSON.parse(tekst) as Record<string, unknown>;
      const veld = (naam: string): string | null => {
        const w = obj[naam];
        return typeof w === "string" && w.trim() ? w.trim() : null;
      };
      return {
        refreshToken: veld("refreshToken"),
        clientId: veld("clientId"),
        clientSecret: veld("clientSecret"),
        developerToken: veld("developerToken"),
        customerId: veld("customerId"),
      };
    } catch {
      // Valt door naar platte string hieronder.
    }
  }
  return { ...leeg, refreshToken: tekst };
}

async function geheimVoorKlant(
  supabase: SupabaseClient,
  clientId: string,
  provider: Provider
): Promise<{ geheim: KanaalGeheim; agencyId: string } | null> {
  const agencyId = (await klantVanId(supabase, clientId))?.agencyId ?? null;
  if (!agencyId) return null;
  const koppeling = await leesKoppeling(supabase, agencyId, provider);
  if (!koppeling || koppeling.status !== "actief" || !koppeling.heeftToken) return null;
  const raw = await leesRefreshToken(supabase, agencyId, provider);
  if (!raw) return null;
  return { geheim: parseKanaalGeheim(raw), agencyId };
}

// ── Meta ────────────────────────────────────────────────────────────────────
//
// Meta kent geen refresh token maar een long-lived user token (~60 dagen); dat staat in het
// refreshToken-veld van de payload -- het is functioneel hetzelfde ding: het geheim waarmee de
// sync praat. Verlenging (fb_exchange_token) is een aparte zorg van de syncroute.

export interface MetaSyncCredentials {
  appId: string;
  appSecret: string;
  accessToken: string;
  bron: CredentialBron;
  eigenApp: boolean;
  agencyId: string | null;
}

export async function metaCredentialsVoorKlant(
  supabase: SupabaseClient,
  clientId: string
): Promise<MetaSyncCredentials | null> {
  const uitKluis = await geheimVoorKlant(supabase, clientId, "meta");
  const envAppId = process.env.META_ADS_APP_ID ?? "";
  const envAppSecret = process.env.META_ADS_APP_SECRET ?? "";

  if (uitKluis?.geheim.refreshToken) {
    const eigenApp = !!(uitKluis.geheim.clientId && uitKluis.geheim.clientSecret);
    const appId = uitKluis.geheim.clientId ?? envAppId;
    const appSecret = uitKluis.geheim.clientSecret ?? envAppSecret;
    if (!appId || !appSecret) return null;
    return { appId, appSecret, accessToken: uitKluis.geheim.refreshToken, bron: "bureau", eigenApp, agencyId: uitKluis.agencyId };
  }

  const envToken = process.env.META_ADS_ACCESS_TOKEN ?? "";
  if (!envAppId || !envAppSecret || !envToken) return null;
  return { appId: envAppId, appSecret: envAppSecret, accessToken: envToken, bron: "omgeving", eigenApp: false, agencyId: null };
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

export interface LinkedInSyncCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  bron: CredentialBron;
  eigenApp: boolean;
  agencyId: string | null;
}

export async function linkedinCredentialsVoorKlant(
  supabase: SupabaseClient,
  clientId: string
): Promise<LinkedInSyncCredentials | null> {
  const uitKluis = await geheimVoorKlant(supabase, clientId, "linkedin");
  const envId = process.env.LINKEDIN_CLIENT_ID ?? "";
  const envSecret = process.env.LINKEDIN_CLIENT_SECRET ?? "";

  if (uitKluis?.geheim.refreshToken) {
    const eigenApp = !!(uitKluis.geheim.clientId && uitKluis.geheim.clientSecret);
    const id = uitKluis.geheim.clientId ?? envId;
    const secret = uitKluis.geheim.clientSecret ?? envSecret;
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret, refreshToken: uitKluis.geheim.refreshToken, bron: "bureau", eigenApp, agencyId: uitKluis.agencyId };
  }

  const envToken = process.env.LINKEDIN_REFRESH_TOKEN ?? "";
  if (!envId || !envSecret || !envToken) return null;
  return { clientId: envId, clientSecret: envSecret, refreshToken: envToken, bron: "omgeving", eigenApp: false, agencyId: null };
}

// ── Tokenrotatie ────────────────────────────────────────────────────────────

/**
 * Schrijft een geroteerd refresh token terug naar de kluis, met behoud van de overige
 * payload-velden en de koppelingsrij (externalId, scopes).
 *
 * Microsoft roteert refresh tokens bij gebruik: het token-endpoint geeft een NIEUW refresh
 * token terug en het oude kan daarna vervallen. Niet terugschrijven betekent dat de volgende
 * syncrun op een dood token draait -- een fout die pas een dag later zichtbaar wordt, precies
 * het soort stille verlopen waar de verloopbewaking in koppelingen.ts tegen waakt.
 */
export async function bewaarGeroteerdRefreshToken(
  supabase: SupabaseClient,
  agencyId: string,
  provider: Provider,
  nieuwToken: string
): Promise<{ ok: boolean; fout?: string }> {
  const raw = await leesRefreshToken(supabase, agencyId, provider);
  const geheim = parseKanaalGeheim(raw);
  const koppeling = await leesKoppeling(supabase, agencyId, provider);
  const payload: Record<string, string> = { refreshToken: nieuwToken };
  for (const veld of ["clientId", "clientSecret", "developerToken", "customerId"] as const) {
    const waarde = geheim[veld];
    if (waarde) payload[veld] = waarde;
  }
  return bewaarKoppeling(supabase, {
    agencyId,
    provider,
    refreshToken: JSON.stringify(payload),
    // bewaarKoppeling schrijft externalId altijd; zonder deze doorgifte zou een rotatie het
    // business-/customer-id van de koppelingsrij wissen.
    externalId: koppeling?.externalId ?? null,
    scopes: koppeling?.scopes,
    expiresAt: koppeling?.expiresAt ?? null,
  });
}

// ── Microsoft Advertising ───────────────────────────────────────────────────
//
// Microsoft vergt naast de OAuth-app en het refresh token ook een developer token en het
// customer id (de "manager"-laag boven de accounts). Bij BYO komen die alle vier van het
// bureau; de omgevings-terugval bestaat voor de dag dat het product zijn eigen goedgekeurde
// token heeft (zelfde vorm als Google's productDeel).

export interface MicrosoftSyncCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  customerId: string | null;
  bron: CredentialBron;
  eigenApp: boolean;
  agencyId: string | null;
}

export async function microsoftCredentialsVoorKlant(
  supabase: SupabaseClient,
  clientId: string
): Promise<MicrosoftSyncCredentials | null> {
  const uitKluis = await geheimVoorKlant(supabase, clientId, "microsoft_ads");
  const envId = process.env.MICROSOFT_ADS_CLIENT_ID ?? "";
  const envSecret = process.env.MICROSOFT_ADS_CLIENT_SECRET ?? "";
  const envDev = process.env.MICROSOFT_ADS_DEVELOPER_TOKEN ?? "";

  if (uitKluis?.geheim.refreshToken) {
    const eigenApp = !!(uitKluis.geheim.clientId && uitKluis.geheim.clientSecret);
    const id = uitKluis.geheim.clientId ?? envId;
    const secret = uitKluis.geheim.clientSecret ?? envSecret;
    const dev = uitKluis.geheim.developerToken ?? envDev;
    if (!id || !secret || !dev) return null;
    return {
      clientId: id, clientSecret: secret, refreshToken: uitKluis.geheim.refreshToken,
      developerToken: dev, customerId: uitKluis.geheim.customerId,
      bron: "bureau", eigenApp, agencyId: uitKluis.agencyId,
    };
  }

  const envToken = process.env.MICROSOFT_ADS_REFRESH_TOKEN ?? "";
  const envCustomer = process.env.MICROSOFT_ADS_CUSTOMER_ID ?? "";
  if (!envId || !envSecret || !envDev || !envToken) return null;
  return {
    clientId: envId, clientSecret: envSecret, refreshToken: envToken,
    developerToken: envDev, customerId: envCustomer || null,
    bron: "omgeving", eigenApp: false, agencyId: null,
  };
}
