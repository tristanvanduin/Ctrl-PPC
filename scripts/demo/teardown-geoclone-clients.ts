// ============================================================================
// GRT/GRA/GRN-KLANTEN TEARDOWN — spiegel van seed-geoclone-clients.ts.
//   npx tsx scripts/demo/teardown-geoclone-clients.ts
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { fysiekeTabel } from "../../lib/data-access/feitentabellen";
import { GEOCLONE_CLIENTS } from "../../lib/demo/geoclone-clients";

// Alles wat de seed zelf schrijft, plus wat een SOP-run erbij zou genereren (zelfde discipline
// als teardown-demo-client.ts). agency_analysis_output hoort er NIET bij: die tabel is
// agency_id-gescoped (portfolio-synthese over het hele bureau), geen client_id-kolom -- verwijderen
// op client_id zou het hele bureau se synthese-output raken, niet alleen deze pseudo-klant.
const TABLES = [
  "ads_campaign_monthly", "ads_account_monthly", "ads_account_weekly",
  "client_settings", "client_sync_status",
  "sop_analysis_output", "sop_insights", "sop_recommendations", "sop_tasks",
  "sprint_hypotheses", "sprint_items", "search_term_analysis",
];

async function run() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Zet NEXT_PUBLIC_SUPABASE_URL en een key in de omgeving."); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: settingsRow } = await db.from("app_settings").select("value").eq("key", "api_clients").maybeSingle();
  const list = Array.isArray(settingsRow?.value) ? (settingsRow!.value as { id?: string }[]) : [];
  const ids: Set<string> = new Set(GEOCLONE_CLIENTS.map((g) => g.clientId));

  for (const g of GEOCLONE_CLIENTS) {
    for (const t of TABLES) {
      const { error } = await db.from(fysiekeTabel(t)).delete().eq("client_id", g.clientId);
      if (error) console.error(`  ✗ ${g.clientId}/${t}: ${error.message}`);
    }
    const { error: acctErr } = await db.from("accounts").delete().eq("client_id", g.clientId);
    console.log(acctErr ? `✗ ${g.clientId}: accounts (${acctErr.message})` : `✓ ${g.clientId} opgeruimd`);
  }

  if (list.some((c) => ids.has(String(c.id)))) {
    const next = list.filter((c) => !ids.has(String(c.id)));
    await db.from("app_settings").upsert({ key: "api_clients", value: next, updated_at: new Date().toISOString() });
    console.log("✓ uit de klantenlijst verwijderd");
  }

  console.log("\nGRT/GRA/GRN-klanten volledig opgeruimd. demo-greentech zelf is ongemoeid.");
}

run();
