// GA4-credentials voor een klant: de OAuth-client is van het product (dezelfde als Google Ads,
// zie lib/tenancy/oauth-providers.ts), het refresh token komt uit de koppeling van het BUREAU
// waartoe deze klant hoort (agency_connections, provider "google_analytics") — precies hetzelfde
// tweelaags-patroon als credentialsVoorBureau in lib/tenancy/credentials.ts, maar dan voor GA4.
// Geen env-terugval: zonder een echte koppeling is er domweg geen GA4-toegang, en dat hoort als
// "absent" te lezen, niet als een stille default.

import type { SupabaseClient } from "@supabase/supabase-js";
import { leesKoppeling, leesRefreshToken } from "@/lib/tenancy/koppelingen";
import { klantVanId } from "@/lib/tenancy/klanten";
import { exchangeRefreshToken } from "@/lib/api/google-oauth";

/** Access token voor de GA4 Data API van deze klant, of null als er (nog) geen koppeling is. */
export async function ga4AccessTokenVoorKlant(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const oauthClientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const oauthClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!oauthClientId || !oauthClientSecret) return null;

  const klant = await klantVanId(supabase, clientId);
  if (!klant?.agencyId) return null;

  const koppeling = await leesKoppeling(supabase, klant.agencyId, "google_analytics");
  if (!koppeling || koppeling.status !== "actief" || !koppeling.heeftToken) return null;

  const refreshToken = await leesRefreshToken(supabase, klant.agencyId, "google_analytics");
  if (!refreshToken) return null;

  try {
    return await exchangeRefreshToken(oauthClientId, oauthClientSecret, refreshToken);
  } catch {
    return null;
  }
}
