/**
 * Returns connection status for all configured APIs.
 * Used by the settings page to show which integrations are active.
 *
 * Naast de env-var-check (het legacy-pad) nu ook de echte OAuth-koppelingen per bureau
 * (agency_connections, via leesKoppelingen) — dit is de route die "zelf bepaalt wat hij
 * prijsgeeft" waar migratie 062 het over heeft: RLS laat de browser niets van deze tabel zien,
 * dus alles wat de settingspagina nodig heeft gaat via hier, met een service-role-client.
 */
import { getAuthUser } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { leesKoppelingen, PROVIDERS, type Koppeling, type Provider } from "@/lib/tenancy/koppelingen";

export async function GET() {
  const googleAds = {
    configured: !!(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN
    ),
    hasManagerId: !!process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  };

  const metaAds = {
    configured: !!process.env.META_ADS_ACCESS_TOKEN,
    hasAppCredentials: !!(process.env.META_ADS_APP_ID && process.env.META_ADS_APP_SECRET),
  };

  const koppelingen: Partial<Record<Provider, Koppeling | null>> = {};
  const user = await getAuthUser();
  if (user && user.agencyIds.length > 0) {
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const rijen = await leesKoppelingen(supabase, user.agencyIds[0]);
      for (const provider of PROVIDERS) {
        koppelingen[provider] = rijen.find((k) => k.provider === provider) ?? null;
      }
    }
  }

  return Response.json({
    googleAds,
    metaAds,
    anyConnected: googleAds.configured || metaAds.configured || Object.values(koppelingen).some((k) => k?.status === "actief"),
    koppelingen,
  });
}
