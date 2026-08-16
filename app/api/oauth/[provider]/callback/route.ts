// Terugkeerpunt van de OAuth-consent-flow. Valideert de state-cookie tegen de state-parameter
// (CSRF), wisselt de authorization code om voor een token via de juiste providerfamilie, en legt
// de koppeling vast via bewaarKoppeling.
//
// ── HET BUREAU KOMT VERS UIT DE SESSIE, NOOIT UIT DE STATE-PARAMETER ─────────────────────────
//
// De state-parameter is puur een CSRF-nonce. Zou het bureau-id daar ook in staan, dan zou een
// aanvaller met een geldige eigen sessie een callback-URL met eens ANDER bureau-id kunnen
// aanbieden aan een slachtoffer; de state-cookie-match zou dat niet vangen (die controleert alleen
// "kwam deze aanvraag van deze browser", niet "voor welk bureau"). Het bureau van de ingelogde
// gebruiker op het moment van de callback is de enige bron die niet te vervalsen is.
import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/roles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { OAUTH_PROVIDERS } from "@/lib/tenancy/oauth-providers";
import { bewaarKoppeling, markeerKoppelingFout, type Provider } from "@/lib/tenancy/koppelingen";
import { exchangeAuthCode } from "@/lib/api/google-oauth";
import { exchangeMetaAuthCode } from "@/lib/api/meta-oauth";
import { exchangeLinkedInAuthCode } from "@/lib/api/linkedin-oauth";
import { redirectUriFor } from "../start/route";

export const dynamic = "force-dynamic";

function isProvider(v: string): v is Provider {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, v);
}

function settingsRedirect(origin: string, query: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/settings?${query}`);
  return res;
}

export async function GET(req: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const { origin, searchParams } = new URL(req.url);

  if (!isProvider(provider)) {
    return settingsRedirect(origin, "oauth_error=onbekende_provider");
  }

  const providerError = searchParams.get("error");
  if (providerError) {
    const res = settingsRedirect(origin, `oauth_error=${provider}_geweigerd`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieState = req.cookies.get(`oauth_state_${provider}`)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    const res = settingsRedirect(origin, `oauth_error=${provider}_ongeldige_state`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  }

  const user = await getAuthUser();
  if (!user || !can(user.role, "connection:manage") || user.agencyIds.length === 0) {
    const res = settingsRedirect(origin, `oauth_error=${provider}_niet_geautoriseerd`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  }
  // Meestal precies één bureau per gebruiker (zie AuthUser se opmerking); bij meerdere geldt het
  // eerste — een gebruiker met toegang tot meerdere bureaus koppelt via het bureau dat de sessie
  // als actief draagt, en dat is vandaag altijd het eerste in de lijst.
  const agencyId = user.agencyIds[0];

  const cfg = OAUTH_PROVIDERS[provider];
  const clientId = cfg.clientId();
  const clientSecret = cfg.clientSecret();
  if (!clientId || !clientSecret) {
    const res = settingsRedirect(origin, `oauth_error=${provider}_geen_client`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const res = settingsRedirect(origin, `oauth_error=${provider}_geen_database`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  }

  const redirectUri = redirectUriFor(origin, provider);

  try {
    let refreshToken: string | undefined;
    let expiresAt: string | null = null;
    let scopes: string[];

    if (cfg.familie === "google") {
      const result = await exchangeAuthCode(clientId, clientSecret, code, redirectUri);
      refreshToken = result.refreshToken;
      scopes = result.scope ? result.scope.split(" ") : [cfg.scope];
      // Google's refresh token kent geen vaste vervaldatum (kan wel ingetrokken worden) —
      // expiresAt blijft leeg, zie beoordeelVerval's "geen_verval"-toestand.
    } else if (cfg.familie === "meta") {
      const result = await exchangeMetaAuthCode(clientId, clientSecret, code, redirectUri);
      // Meta kent geen apart refresh token; het langlevende access token IS de credential.
      refreshToken = result.accessToken;
      expiresAt = new Date(result.expiresAt).toISOString();
      scopes = cfg.scope.split(",");
    } else {
      const result = await exchangeLinkedInAuthCode(clientId, clientSecret, code, redirectUri);
      refreshToken = result.refreshToken ?? result.accessToken;
      expiresAt = new Date(result.expiresAt).toISOString();
      scopes = cfg.scope.split(",");
    }

    if (!refreshToken) {
      const res = settingsRedirect(origin, `oauth_error=${provider}_geen_token_ontvangen`);
      res.cookies.delete(`oauth_state_${provider}`);
      return res;
    }

    const opgeslagen = await bewaarKoppeling(supabase, {
      agencyId,
      provider,
      refreshToken,
      scopes,
      expiresAt,
      connectedBy: user.id,
    });
    if (!opgeslagen.ok) {
      const res = settingsRedirect(origin, `oauth_error=${provider}_opslaan_mislukt`);
      res.cookies.delete(`oauth_state_${provider}`);
      return res;
    }

    const res = settingsRedirect(origin, `oauth_success=${provider}`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e);
    try {
      await markeerKoppelingFout(supabase, agencyId, provider, fout);
    } catch {
      // Stil: het markeren van een fout mag geen tweede fout veroorzaken.
    }
    const res = settingsRedirect(origin, `oauth_error=${provider}_onbekende_fout`);
    res.cookies.delete(`oauth_state_${provider}`);
    return res;
  }
}
