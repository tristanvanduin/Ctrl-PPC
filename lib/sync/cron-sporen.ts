// Sporen van een sync die NIET draaide.
//
// De nachtcron (app/api/sync/cron) sloeg een klant zonder credentials over met alleen een regel
// in zijn JSON-antwoord -- dat niemand leest. Zo kon de Google-sync van 17 april tot 3 september
// 2026 stilstaan zonder één rij in sync_runs: de tabel zei "laatste run geslaagd", de status zei
// "fresh", en de enige plek waar "geen credentials" stond was de responsebody van een cron.
//
// Nu laat elke overgeslagen klant een sync_runs-rij achter (status failed, met de reden) en zet
// hij client_sync_status op failed/stale -- last_successful_sync_at blijft staan, want die was
// waar. En als een hele cronronde geen enkele klant synct, gaat er één alert uit (gededupliceerd
// via alerts_log, dus hooguit één per zes uur).

import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notifications";
import { logger } from "@/lib/logger";

export interface OvergeslagenSync {
  clientId: string;
  customerId: string | null;
  reden: string;
  triggeredBy?: string;
}

/** Schrijft de failed-run en de statusrij. Faalt zacht (de cron mag hier niet op omvallen),
 *  maar geeft terug of het lukte, zodat de aanroeper het kan melden. */
export async function noteerOvergeslagenSync(
  supabase: SupabaseClient,
  { clientId, customerId, reden, triggeredBy = "cron" }: OvergeslagenSync
): Promise<{ ok: boolean; fout: string | null }> {
  const nu = new Date().toISOString();
  const run = await supabase.from("sync_runs").insert({
    client_id: clientId,
    google_ads_customer_id: customerId,
    sync_type: "scheduled",
    status: "failed",
    started_at: nu,
    finished_at: nu,
    datasets_attempted: 0,
    datasets_succeeded: 0,
    datasets_failed: 0,
    total_rows_written: 0,
    dataset_results: [],
    error_summary: reden,
    triggered_by: triggeredBy,
  });
  if (run.error) {
    logger.error(`[cron] sync_runs-spoor voor ${clientId} niet geschreven: ${run.error.message}`);
    return { ok: false, fout: run.error.message };
  }
  const status = await supabase.from("client_sync_status").upsert({
    client_id: clientId,
    last_sync_at: nu,
    last_sync_status: "failed",
    freshness_status: "stale",
    updated_at: nu,
  }, { onConflict: "client_id" });
  if (status.error) {
    logger.error(`[cron] client_sync_status voor ${clientId} niet bijgewerkt: ${status.error.message}`);
    return { ok: false, fout: status.error.message };
  }
  return { ok: true, fout: null };
}

/** Eén platformbrede alert als een cronronde geen enkele Google-klant heeft gesynct. */
export async function meldSyncStilstand(
  supabase: SupabaseClient,
  { totaal, gefaald, voorbeeld }: { totaal: number; gefaald: number; voorbeeld: string | null }
): Promise<void> {
  await notify(supabase, {
    type: "sync_failed",
    clientId: null,
    channel: "google_ads",
    kernfeit: `Nachtcron: 0 van ${totaal} Google Ads-klanten gesynct (${gefaald} gefaald)${voorbeeld ? ` -- ${voorbeeld}` : ""}.`,
  });
}
