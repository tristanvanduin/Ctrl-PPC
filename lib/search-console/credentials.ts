// Search Console-credentials voor een klant — spiegelt lib/ga4/credentials.ts exact. Zelfde
// tweelaags-patroon: OAuth-client van het product (dezelfde als Google Ads/GA4), refresh token uit
// de koppeling van het BUREAU (agency_connections, provider "search_console"). Geen env-terugval.

import type { SupabaseClient } from "@supabase/supabase-js";
import { leesKoppeling, leesRefreshToken } from "@/lib/tenancy/koppelingen";
import { klantVanId } from "@/lib/tenancy/klanten";
import { exchangeRefreshToken } from "@/lib/api/google-oauth";

export async function searchConsoleAccessTokenVoorKlant(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const oauthClientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const oauthClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!oauthClientId || !oauthClientSecret) return null;

  const klant = await klantVanId(supabase, clientId);
  if (!klant?.agencyId) return null;

  const koppeling = await leesKoppeling(supabase, klant.agencyId, "search_console");
  if (!koppeling || koppeling.status !== "actief" || !koppeling.heeftToken) return null;

  const refreshToken = await leesRefreshToken(supabase, klant.agencyId, "search_console");
  if (!refreshToken) return null;

  try {
    return await exchangeRefreshToken(oauthClientId, oauthClientSecret, refreshToken);
  } catch {
    return null;
  }
}
