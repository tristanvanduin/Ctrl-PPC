// LinkedIn OAuth2-tokenwisseling — standaard authorization-code-grant. LinkedIn's Marketing
// Developer Platform-apps met offline-toegang krijgen wél een refresh token (geldig ~365 dagen,
// tegen een access token van ~60 dagen — vandaar VERLOOPWAARSCHUWING_DAGEN in koppelingen.ts).
// Docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export interface LinkedInTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // ms sinds epoch
}

export async function exchangeLinkedInAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<LinkedInTokenExchangeResult> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LinkedIn OAuth2 tokenwisseling mislukt: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  };
}
