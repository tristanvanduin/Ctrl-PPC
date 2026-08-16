// Meta OAuth2-tokenwisseling. Meta wijkt af van het standaard OAuth2-patroon: er is geen refresh
// token, alleen een kortlevende user access token (~1-2 uur) die je in een TWEEDE aanroep omruilt
// voor een langlevende token (~60 dagen). Dat langlevende token is zelf de credential die we
// bewaren — het kan met dezelfde aanroep worden vernieuwd zolang het nog geldig is.
// Docs: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/long-lived

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaTokenExchangeResult {
  accessToken: string;
  expiresAt: number; // ms sinds epoch; Meta geeft expires_in in seconden
}

async function fetchTokenParams(params: URLSearchParams): Promise<{ access_token: string; expires_in?: number }> {
  const response = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Meta OAuth2 tokenwisseling mislukt: ${error}`);
  }
  return response.json();
}

/** Authorization code → kortlevende token → langlevende token, in één aanroep naar buiten toe. */
export async function exchangeMetaAuthCode(
  appId: string,
  appSecret: string,
  code: string,
  redirectUri: string
): Promise<MetaTokenExchangeResult> {
  const kortlevend = await fetchTokenParams(new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  }));

  return exchangeForLongLivedToken(appId, appSecret, kortlevend.access_token);
}

/** Ruilt een (kortlevend of nog geldig langlevend) token om voor een vers langlevend token. */
export async function exchangeForLongLivedToken(
  appId: string,
  appSecret: string,
  accessToken: string
): Promise<MetaTokenExchangeResult> {
  const data = await fetchTokenParams(new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: accessToken,
  }));
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 60 * 24 * 60 * 60) * 1000,
  };
}
