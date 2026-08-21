import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bedrijfsmodel } from "./segment";
import type { GodViewChurnInvoerRij } from "./god-view-churn";
import { beoordeelKlant } from "@/lib/adoptie/detecteer-code-rood";

// IO-laag voor de God View-churnlaag. Zelfde opt-in-bureaus en dezelfde bedrijfsmodel/niche-bron
// als fetchGodViewInvoerRijen (god-view-data.ts) -- alleen de laatste kolom verschilt: geen
// spend/conversies uit blended_account_monthly, maar het licht uit beoordeelCodeRood.
//
// LIVE BEREKEND, NIET UIT code_rood_meldingen GELEZEN. Die tabel is de opgeslagen, door een mens
// beoordeelde staat (migratie 073, met een eigen levenscyclus open/geaccepteerd/afgewezen/
// opgelost) voor de Today- en dashboardmeldingen. Deze route heeft dat menselijke spoor niet
// nodig -- hij wil alleen het pure, actuele oordeel per account om te tellen per segment, dus
// roept beoordeelKlant() rechtstreeks aan zoals de cron-detectiejob dat ook doet. Werkt dus al
// vóór migratie 073 handmatig gedraaid is.
export async function fetchGodViewChurnInvoerRijen(supabase: SupabaseClient): Promise<GodViewChurnInvoerRij[]> {
  const [{ data: bureaus }, { data: accounts }, { data: instellingen }] = await Promise.all([
    supabase.from("agencies").select("id, benchmark_optin_at"),
    supabase.from("accounts").select("client_id, agency_id"),
    supabase.from("client_settings").select("client_id, bedrijfsmodel, niche"),
  ]);

  const meedoen = new Set((bureaus ?? []).filter((b) => (b as { benchmark_optin_at: string | null }).benchmark_optin_at).map((b) => String((b as { id: string }).id)));
  const agencyPerKlant = new Map((accounts ?? []).map((a) => [String((a as { client_id: string }).client_id), String((a as { agency_id: string | null }).agency_id ?? "")]));
  const instellingPerKlant = new Map(
    (instellingen ?? []).map((r) => [String((r as { client_id: string }).client_id), r as { bedrijfsmodel: string | null; niche: string | null }])
  );

  const inAanmerking: { clientId: string; agencyId: string; bedrijfsmodel: Bedrijfsmodel | null; niche: string | null }[] = [];
  for (const [clientId, s] of instellingPerKlant) {
    if (!s.bedrijfsmodel && !s.niche) continue;
    const agencyId = agencyPerKlant.get(clientId);
    if (!agencyId || !meedoen.has(agencyId)) continue;
    inAanmerking.push({ clientId, agencyId, bedrijfsmodel: (s.bedrijfsmodel as Bedrijfsmodel | null) ?? null, niche: s.niche ?? null });
  }

  // Kleine bureaupool vandaag (masterplan 16.6/16.7), dus parallel per klant is geen probleem --
  // zodra dit platform meegroeit is dit de plek om te batchen, niet nu al vroegtijdig te bouwen.
  const oordelen = await Promise.all(
    inAanmerking.map(async (k) => {
      try {
        const oordeel = await beoordeelKlant(supabase, k.clientId);
        return { ...k, licht: oordeel?.licht ?? "onbekend" as const };
      } catch {
        return { ...k, licht: "onbekend" as const };
      }
    })
  );

  return oordelen;
}
