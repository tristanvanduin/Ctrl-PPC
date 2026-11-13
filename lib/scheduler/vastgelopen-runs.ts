// Vastgelopen runs afsluiten: een job op "running" zonder update na een uur gaat op "failed", met
// de reden erbij.
//
// isStaleRunning bestond en was getest, maar had buiten de tests geen aanroeper. In generation_jobs
// stonden zestien analyses van april tot september op "running", waarvan veertien kanaal-maandruns
// die wel klaar waren (de route riep markProgressCompleted nooit aan) en een paar die echt halverwege
// waren gestopt (doorlichting 13 november). Het logboek leest alleen completed en failed, dus geen
// van beide was ergens te zien. Nu wordt elke run die een uur stil is afgesloten, en zegt de
// foutmelding in welke fase hij bleef hangen.
//
// Aangeroepen bij de start van elke analyse (voor die klant) en door de SOP-cron (voor iedereen):
// de crons staan uit, dus alleen de cron zou betekenen dat het nooit gebeurt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaleRunning, VASTGELOPEN_RUN_MINUTEN } from "./core";

export interface JobRij {
  job_id: string;
  status: string;
  updated_at: string | null;
  current_phase: string | null;
  current_phase_label?: string | null;
}

/** De reden die in error_message komt. */
export function vastgelopenReden(rij: JobRij, minuten: number = VASTGELOPEN_RUN_MINUTEN): string {
  const fase = rij.current_phase_label || rij.current_phase || "onbekende fase";
  const sinds = rij.updated_at ? rij.updated_at.slice(0, 16).replace("T", " ") : "onbekend";
  return `Vastgelopen: geen voortgang sinds ${sinds} (fase: ${fase}). Na ${minuten} minuten zonder update als mislukt afgesloten; de run is niet afgerond en telt niet als gedraaid.`;
}

/** Welke van deze rijen vastgelopen zijn. Puur. */
export function vastgelopenRuns(rijen: JobRij[], nu: Date, minuten: number = VASTGELOPEN_RUN_MINUTEN): JobRij[] {
  return rijen.filter((r) => isStaleRunning(r.status, r.updated_at ? new Date(r.updated_at) : null, nu, minuten));
}

/**
 * Sluit de vastgelopen runs af. Faalt zacht: een opruimactie die niet lukt mag een analyse niet
 * tegenhouden. Geeft het aantal afgesloten runs terug.
 */
export async function ruimVastgelopenRunsOp(
  supabase: SupabaseClient,
  opts: { clientId?: string; nu?: Date } = {},
): Promise<number> {
  const nu = opts.nu ?? new Date();
  const grens = new Date(nu.getTime() - VASTGELOPEN_RUN_MINUTEN * 60_000).toISOString();
  let q = supabase.from("generation_jobs")
    .select("job_id, status, updated_at, current_phase, current_phase_label")
    .eq("status", "running")
    .lt("updated_at", grens)
    .limit(200);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  const { data, error } = await q;
  if (error) {
    console.error(`[vastgelopen-runs] lezen mislukt: ${error.message}`);
    return 0;
  }
  let afgesloten = 0;
  for (const rij of vastgelopenRuns((data ?? []) as JobRij[], nu)) {
    // .eq("status", "running") en .lt(updated_at): een run die net nog voortgang meldde wordt niet
    // alsnog afgesloten.
    const { data: bijgewerkt, error: fout } = await supabase.from("generation_jobs")
      .update({ status: "failed", error_message: vastgelopenReden(rij), completed_at: nu.toISOString(), updated_at: nu.toISOString() })
      .eq("job_id", rij.job_id)
      .eq("status", "running")
      .lt("updated_at", grens)
      .select("job_id");
    if (fout) console.error(`[vastgelopen-runs] afsluiten van ${rij.job_id} mislukt: ${fout.message}`);
    else afgesloten += (bijgewerkt ?? []).length;
  }
  return afgesloten;
}
