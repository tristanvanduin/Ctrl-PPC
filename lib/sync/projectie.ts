// De projectie van de `*_legacy`-tabellen naar fact_core, na een sync.
//
// WAAROM DIT BESTAAT
//
// Sinds migratie 054 leest de app de acht feitentabellen (ads_account_monthly, meta_account_daily,
// linkedin_campaign_daily, ...) als VIEWS over fact_core. De syncs schrijven naar de fysieke
// `*_legacy`-tabellen (lib/data-access/feitentabellen.ts), en één databasefunctie,
// refresh_fact_from_legacy (laatste definitie: scripts/migrations/078_fact_dimension_onderhoud.sql),
// projecteert die naar fact_core en de kanaalmetriektabellen.
//
// Op 3 september 2026 bleek dat alleen de Google-orchestrator die functie aanriep. De Meta- en
// LinkedIn-syncs schreven hun rijen naar de legacy-tabellen en stopten daar: de app, die door de
// views leest, zou van zo'n sync NIETS zien. En bij Google werd een mislukte projectie alleen
// gelogd, met als reden dat "de nieuwe tabellen nog nergens gelezen worden" -- wat sinds 054
// precies andersom is. Vandaar één plek, en één regel: geen projectie is geen sync.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PROJECTIE_FUNCTIE = "refresh_fact_from_legacy";

/** Projecteert de legacy-rijen van één klant naar fact_core. Een fout komt terug, nooit gegooid:
 *  de aanroeper beslist hoe hij hem administreert (dataset-resultaat, run-status). */
export async function projecteerNaarFactCore(supabase: SupabaseClient, clientId: string): Promise<{ ok: true } | { ok: false; fout: string }> {
  try {
    const { error } = await supabase.rpc(PROJECTIE_FUNCTIE, { p_client_id: clientId });
    if (error) return { ok: false, fout: `projectie naar fact_core (${PROJECTIE_FUNCTIE}) mislukt: ${error.message}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, fout: `projectie naar fact_core (${PROJECTIE_FUNCTIE}) mislukt: ${e instanceof Error ? e.message : String(e)}` };
  }
}
