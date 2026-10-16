// Wist de geprojecteerde rijen van een DEMO-account, zodat refresh_fact_from_legacy() ze daarna
// precies opnieuw opbouwt uit de bron.
//
// WAAROM DIT BESTAAT
//
// De demo-seeders (scripts/demo/seed-demo-client.ts, seed-geoclone-clients.ts) leggen hun
// datumvenster aan vanaf de dag waarop ze draaien, wissen de *_legacy-bronrijen van de demoklant en
// schrijven het nieuwe venster weg. Daarna projecteert refresh_fact_from_legacy() (laatste
// definitie: scripts/migrations/078_fact_dimension_onderhoud.sql) naar fact_core, fact_dimension
// en de kanaalmetrieken. Die projectie doet alleen `insert ... on conflict do update` en wist
// nooit iets. Elke dag waarmee het venster opschuift bleef dus als wees achter in fact_core, en de
// views die de app leest (ads_account_monthly, meta_account_daily, ...) zijn views over fact_core.
// Gevolg op 16 oktober 2026: 140 weesdagen van demo-greentech plus 130 foute week- en
// maandrollups, en een rode view-dekkingspoort. Migratie 103 ruimde hetzelfde al eens op, maar
// bestreed het symptoom; de seeder bleef het opnieuw maken.
//
// De regel: wat de projectie opbouwt, wist de seeder eerst. Daarna bestaat er in fact_core niets
// meer dat geen bron heeft. Alle vijf de tabellen hebben `account_id ... on delete cascade` naar
// accounts; wissen op account_id raakt dus precies dit ene account.
//
// HARDE GRENS: alleen voor client_id's die met "demo-" beginnen. Voor een echte klant zou dit de
// historie wissen die de app toont, en zolang de Google-sync niet draait is die niet terug te halen.

import type { SupabaseClient } from "@supabase/supabase-js";

export const GEPROJECTEERDE_TABELLEN = ["fact_core", "fact_dimension", "google_metrics", "meta_metrics", "linkedin_metrics"] as const;

export function isDemoKlantId(clientId: string): boolean {
  return /^demo-[a-z0-9-]+$/.test(clientId);
}

export interface OpruimVerslag {
  accountIds: string[];
  /** Per tabel: gelukt, of de foutmelding. */
  tabellen: { tabel: string; fout: string | null }[];
}

/**
 * Wist de geprojecteerde rijen van alle accounts met deze client_id. Gooit bij een niet-demo
 * client_id, bij een leesfout op accounts en bij elke wisfout: een seeder die half opruimt en dan
 * projecteert, maakt precies de weesrijen die dit moet voorkomen.
 */
export async function wisDemoProjectie(db: SupabaseClient, clientId: string): Promise<OpruimVerslag> {
  if (!isDemoKlantId(clientId)) {
    throw new Error(`wisDemoProjectie weigert "${clientId}": alleen demo-klanten (client_id begint met "demo-")`);
  }
  const res = await db.from("accounts").select("id").eq("client_id", clientId);
  if (res.error) throw new Error(`accounts lezen voor ${clientId}: ${res.error.message}`);
  const accountIds = ((res.data ?? []) as { id?: unknown }[]).map((r) => String(r.id ?? "")).filter(Boolean);

  const tabellen: OpruimVerslag["tabellen"] = [];
  for (const accountId of accountIds) {
    for (const tabel of GEPROJECTEERDE_TABELLEN) {
      const { error } = await db.from(tabel).delete().eq("account_id", accountId);
      if (error) throw new Error(`${tabel} wissen voor ${clientId} (${accountId}): ${error.message}`);
      tabellen.push({ tabel, fout: null });
    }
  }
  return { accountIds, tabellen };
}
