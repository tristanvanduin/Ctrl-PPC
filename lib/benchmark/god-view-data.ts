import type { SupabaseClient } from "@supabase/supabase-js";
import { monthsAgo } from "@/lib/reporting-date";
import type { Bedrijfsmodel } from "./segment";
import type { GodViewInvoerRij } from "./god-view";

// IO-laag voor de God View-kernlaag (lib/benchmark/god-view.ts, masterplan 16.7). Haalt de rijen
// op die god-view.ts nodig heeft: alleen accounts van OPT-IN-bureaus (agencies.benchmark_optin_at,
// migratie 064) met een ingevulde afbakening (bedrijfsmodel en/of niche — zonder afbakening telt
// een account in geen enkele cel mee, zelfde regel als celoverzicht()/bouwGodViewCellen()).
//
// Bron: blended_account_monthly, niet ads_account_monthly. benchmarkdekking/route.ts neemt "google"
// als vaste aanname omdat dat scherm alleen telt en geen prestatiecijfers nodig heeft; hier gaat
// het om echte spend/conversies, dus het kanaal komt uit de data zelf (blended_account_monthly
// heeft al een channel-kolom) in plaats van een aanname die stilzwijgend fout wordt zodra Meta of
// LinkedIn meetellen.

export async function fetchGodViewInvoerRijen(supabase: SupabaseClient): Promise<GodViewInvoerRij[]> {
  const month = monthsAgo(1);

  const [{ data: bureaus }, { data: accounts }, { data: instellingen }, { data: maandrijen }] = await Promise.all([
    supabase.from("agencies").select("id, benchmark_optin_at"),
    supabase.from("accounts").select("client_id, agency_id"),
    supabase.from("client_settings").select("client_id, bedrijfsmodel, niche"),
    supabase.from("blended_account_monthly").select("client_id, channel, spend, conversions, conversion_value").eq("month", month),
  ]);

  const meedoen = new Set((bureaus ?? []).filter((b) => (b as { benchmark_optin_at: string | null }).benchmark_optin_at).map((b) => String((b as { id: string }).id)));
  const agencyPerKlant = new Map((accounts ?? []).map((a) => [String((a as { client_id: string }).client_id), String((a as { agency_id: string | null }).agency_id ?? "")]));
  const instellingPerKlant = new Map(
    (instellingen ?? []).map((r) => [String((r as { client_id: string }).client_id), r as { bedrijfsmodel: string | null; niche: string | null }])
  );

  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const rijen: GodViewInvoerRij[] = [];
  for (const r of (maandrijen ?? []) as { client_id: string; channel: string; spend: number | null; conversions: number | null; conversion_value: number | null }[]) {
    const clientId = String(r.client_id);
    const agencyId = agencyPerKlant.get(clientId);
    if (!agencyId || !meedoen.has(agencyId)) continue;
    const s = instellingPerKlant.get(clientId);
    if (!s || (!s.bedrijfsmodel && !s.niche)) continue;

    rijen.push({
      clientId,
      agencyId,
      channel: r.channel,
      bedrijfsmodel: (s.bedrijfsmodel as Bedrijfsmodel | null) ?? null,
      niche: s.niche ?? null,
      spend: n(r.spend),
      // blended_account_monthly.conversions bevat de leads al sinds de view op fact_core leest
      // (migratie 080): de projectie schrijft Meta als conversions + leads en LinkedIn als
      // one_click_leads + external_website_conversions, met leads = one_click_leads
      // (refresh_fact_from_legacy, migratie 078); Google heeft leads 0. Hier stond
      // "conversions + leads", naar de conventie van de cross-channel-KPI's, die nog uit migratie
      // 014 stamde, toen leads apart stonden. Sinds 080 telde dat elke LinkedIn-lead twee keer en
      // kwam de CPA van een leadgen-account te laag uit. Een eindige CPA houdt zo'n account
      // gewoon: zijn leads zitten in conversions.
      conversions: n(r.conversions),
      conversionValue: n(r.conversion_value),
    });
  }
  return rijen;
}
