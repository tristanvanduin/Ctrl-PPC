// Gedeelde Google OAuth2-tokenwisseling — gebruikt door Google Ads, GA4 en Search Console. Alle
// drie zijn dezelfde Google-OAuth-client (één Google Cloud-project), alleen de scope verschilt.
//
// ── WAAROM DEZE MODULE BESTAAT EN GEEN DERDE KOPIE VAN HETZELFDE FETCH-BLOK IS ────────────────
//
// lib/api/google-ads.ts had dit blok al or, maar cachete het access token in een kale
// module-variabele: prima zolang er precies één bureau is, fout zodra een tweede meedraait (bureau
// B krijgt dan het access token van bureau A totdat de 60s-marge verstrijkt). Deze versie cachet
// per credential-vingerafdruk (client_id+refresh_token), zodat elk bureau zijn eigen token houdt.
//
// exchangeAuthCode is nieuw: de OAuth-callback-route heeft dit nodig om de eenmalige
// authorization code van Google om te wisselen voor een refresh token (met prompt=consent
// aangevraagd, zie lib/tenancy/koppelingen.ts's opmerking daarover).

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleTokenExchangeResult {
  accessToken: string;
  expiresAt: number; // ms sinds epoch
  refreshToken?: string; // alleen aanwezig bij exchangeAuthCode, en alleen als Google 'm meegeeft
  scope?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const accessTokenCache = new Map<string, CachedToken>();

function cacheKey(clientId: string, refreshToken: string): string {
  return `${clientId}:${refreshToken}`;
}

/**
 * Refresh token → access token. Gecached per (client_id, refresh_token) met 60s-marge, zodat
 * meerdere bureaus die in hetzelfde proces draaien nooit elkaars token te zien krijgen.
 */
export async function exchangeRefreshToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const key = cacheKey(clientId, refreshToken);
  const cached = accessTokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google OAuth2 token refresh failed: ${error}`);
  }

  const data = await response.json();
  const accessToken = data.access_token as string;
  const expiresAt = Date.now() + (data.expires_in as number) * 1000;
  accessTokenCache.set(key, { accessToken, expiresAt });
  return accessToken;
}

/**
 * Eenmalige authorization code (uit de OAuth-callback) → access token + (meestal) refresh token.
 * Google geeft alleen een refresh token terug als de authorize-aanroep `prompt=consent` gebruikte
 * — zie lib/tenancy/oauth-providers.ts, die dat altijd meegeeft.
 */
export async function exchangeAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<GoogleTokenExchangeResult> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google OAuth2 code exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
}
