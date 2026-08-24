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
    // ads_read alleen, ZONDER ads_management (24 augustus 2026). Dat schrijfrecht stond hier
    // wel maar wordt nergens gebruikt: de enige POST in lib/meta/ is de async insights-job, en
    // die is een leesaanroep die Meta nu eenmaal als POST heeft vormgegeven. Twee redenen om
    // hem weg te halen, en de tweede is de duurste:
    //
    //   1. Meta laat je bij App Review elke permissie met een screencast onderbouwen. Een
    //      schrijfrecht dat het product niet gebruikt kun je niet demonstreren, en dat is een
    //      afwijzingsgrond op de aanvraag zelf.
    //   2. Het sprak onze eigen pagina's tegen. /faq zegt "never executes anything itself in
    //      Google Ads, Meta, or LinkedIn" en het Privacy Statement spreekt van leestoegang.
    //      Een consent-scherm dat beheerrechten vraagt, zegt tegen de klant iets anders dan de
    //      site die hem overtuigd heeft -- en de klant ziet dat scherm.
    //
    // Gaat het product ooit wél schrijven naar Meta, dan hoort ads_management hier terug te
    // komen SAMEN met de tekst op /faq en in het Privacy Statement, niet los.
    scope: "ads_read",
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
