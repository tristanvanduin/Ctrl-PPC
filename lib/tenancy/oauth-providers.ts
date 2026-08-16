// Vaste, niet-geheime configuratie per OAuth-provider: waar de consent-pagina staat, welke scope
// gevraagd wordt, en welke omgevingsvariabelen de OAuth-client dragen. De geheimen zelf (secrets)
// staan in process.env, nooit hier — dit bestand mag zonder problemen in een routebestand
// geïmporteerd worden dat client-side niets teruggeeft.
//
// Google Ads, GA4 en Search Console delen dezelfde OAuth-client (GOOGLE_ADS_CLIENT_ID/SECRET is
// één Google Cloud-project met meerdere API's ingeschakeld); alleen de scope verschilt. Dat is
// waarom er geen aparte GOOGLE_GA4_CLIENT_ID hoeft te bestaan — zie lib/tenancy/credentials.ts se
// opmerking over "developer token/OAuth-client van het product, één stuk".

import type { Provider } from "./koppelingen";

export type ProviderFamilie = "google" | "meta" | "linkedin";

export interface OAuthProviderConfig {
  provider: Provider;
  familie: ProviderFamilie;
  label: string;
  authorizeUrl: string;
  scope: string;
  /** Extra parameters bovenop client_id/redirect_uri/response_type/scope/state. */
  extraAuthorizeParams?: Record<string, string>;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
}

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function googleClientId(): string | undefined {
  return process.env.GOOGLE_ADS_CLIENT_ID;
}
function googleClientSecret(): string | undefined {
  return process.env.GOOGLE_ADS_CLIENT_SECRET;
}

export const OAUTH_PROVIDERS: Record<Provider, OAuthProviderConfig> = {
  google_ads: {
    provider: "google_ads",
    familie: "google",
    label: "Google Ads",
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    scope: "https://www.googleapis.com/auth/adwords",
    // access_type=offline + prompt=consent: zonder deze twee geeft Google geen refresh token
    // terug bij een herkoppeling — zie de opmerking in koppelingen.ts.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  },
  google_analytics: {
    provider: "google_analytics",
    familie: "google",
    label: "Google Analytics 4",
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  },
  search_console: {
    provider: "search_console",
    familie: "google",
    label: "Google Search Console",
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  },
  meta: {
    provider: "meta",
    familie: "meta",
    label: "Meta Ads",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    scope: "ads_read,ads_management",
    clientId: () => process.env.META_ADS_APP_ID,
    clientSecret: () => process.env.META_ADS_APP_SECRET,
  },
  linkedin: {
    provider: "linkedin",
    familie: "linkedin",
    label: "LinkedIn Ads",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    scope: "r_ads,r_ads_reporting",
    clientId: () => process.env.LINKEDIN_CLIENT_ID,
    clientSecret: () => process.env.LINKEDIN_CLIENT_SECRET,
  },
};

/** Of deze provider een geregistreerde OAuth-client heeft (client id + secret uit de omgeving). */
export function providerHeeftClient(provider: Provider): boolean {
  const cfg = OAUTH_PROVIDERS[provider];
  return Boolean(cfg.clientId() && cfg.clientSecret());
}
