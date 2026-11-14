// Vastgelopen runs afsluiten: een job op "running" zonder update na een uur wordt afgesloten. Heeft
// hij zijn afrondingsteken (sectie "full" in sop_analysis_output) wel weggeschreven, dan gaat hij op
// "completed"; anders op "failed", met de reden erbij.
//
// isStaleRunning bestond en was getest, maar had buiten de tests geen aanroeper. In generation_jobs
// stonden zestien analyses van april tot september op "running", waarvan veertien kanaal-maandruns
// die wel klaar waren (de route riep markProgressCompleted nooit aan) en een paar die echt halverwege
// waren gestopt (doorlichting 13 november). Het logboek leest alleen completed en failed, dus geen
// van beide was ergens te zien. Nu wordt elke run die een uur stil is afgesloten.
//
// Eerst kijken of hij af is. De eerste versie zette elke stille run op failed, met "de run is niet
// afgerond". Op 14 november hadden 10 van de 15 stille demo-maandruns hun afrondingsteken wel, binnen
// een halve minuut na hun laatste voortgangsmelding: die versie had tien geslaagde runs als mislukt
// weggeschreven. Het teken telt alleen voor deze run als het na zijn start komt, binnen een uur na
// zijn laatste melding, en voor de volgende run van dezelfde klant en hetzelfde type startte.
//
// Aangeroepen bij de start van elke analyse (voor die klant) en door de SOP-cron (voor iedereen):
// de crons staan uit, dus alleen de cron zou betekenen dat het nooit gebeurt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaleRunning, VASTGELOPEN_RUN_MINUTEN } from "./core";
import { AFRONDINGS_SECTIE } from "./sop-cadence";

export interface JobRij {
  job_id: string;
  status: string;
  updated_at: string | null;
  current_phase: string | null;
  current_phase_label?: string | null;
  client_id?: string | null;
  started_at?: string | null;
  metadata?: { sop_type?: unknown } | null;
}

/** Hoe een vastgelopen run wordt afgesloten. */
export type Afsluiting =
  | { status: "completed"; completed_at: string; message: string }
  | { status: "failed"; completed_at: string; error_message: string };

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
 * Beslist hoe een vastgelopen run wordt afgesloten. Puur.
 * - `afrondingen`: created_at van de rijen met het afrondingsteken voor deze klant en dit sop_type.
 * - `volgendeStart`: started_at van de eerstvolgende run van deze klant en dit sop_type, of null.
 * Zonder started_at of sop_type is niet vast te stellen welk teken bij deze run hoort: dan failed.
 */
export function afsluitingVoor(
  rij: JobRij,
  afrondingen: string[],
  volgendeStart: string | null,
  nu: Date,
  minuten: number = VASTGELOPEN_RUN_MINUTEN,
): Afsluiting {
  const start = rij.started_at ? Date.parse(rij.started_at) : NaN;
  const laatst = rij.updated_at ? Date.parse(rij.updated_at) : NaN;
  const volgende = volgendeStart ? Date.parse(volgendeStart) : Infinity;
  const tot = Math.min(laatst + minuten * 60_000, volgende);
  const teken = Number.isFinite(start) && Number.isFinite(laatst)
    ? afrondingen
        .map((a) => Date.parse(a))
        .filter((t) => Number.isFinite(t) && t >= start && t <= tot)
        .sort((a, b) => a - b)[0]
    : undefined;
  if (teken !== undefined) {
    const op = new Date(teken).toISOString();
    return {
      status: "completed",
      completed_at: op,
      message: `Afgerond: het afrondingsteken (sectie ${AFRONDINGS_SECTIE}) staat er sinds ${op.slice(0, 16).replace("T", " ")}. De run meldde dat zelf niet; de status is achteraf vastgesteld.`,
    };
  }
  return { status: "failed", completed_at: nu.toISOString(), error_message: vastgelopenReden(rij, minuten) };
}

/** Het sop_type uit de metadata, of null. */
function sopTypeVan(rij: JobRij): string | null {
  const t = rij.metadata?.sop_type;
  return typeof t === "string" && t ? t : null;
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
    .select("job_id, client_id, status, started_at, updated_at, current_phase, current_phase_label, metadata")
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
    const [afrondingen, volgendeStart] = await afrondingenVoor(supabase, rij);
    const afsluiting = afsluitingVoor(rij, afrondingen, volgendeStart, nu);
    const velden = afsluiting.status === "completed"
      ? { status: "completed", message: afsluiting.message, completed_at: afsluiting.completed_at, updated_at: nu.toISOString() }
      : { status: "failed", error_message: afsluiting.error_message, completed_at: afsluiting.completed_at, updated_at: nu.toISOString() };
    // .eq("status", "running") en .lt(updated_at): een run die net nog voortgang meldde wordt niet
    // alsnog afgesloten.
    const { data: bijgewerkt, error: fout } = await supabase.from("generation_jobs")
      .update(velden)
      .eq("job_id", rij.job_id)
      .eq("status", "running")
      .lt("updated_at", grens)
      .select("job_id");
    if (fout) console.error(`[vastgelopen-runs] afsluiten van ${rij.job_id} mislukt: ${fout.message}`);
    else afgesloten += (bijgewerkt ?? []).length;
  }
  return afgesloten;
}

/**
 * De afrondingstekens en de start van de volgende run voor deze run. Lukt het lezen niet, dan geen
 * tekens: de run gaat dan op failed, zoals voor deze controle bestond.
 */
async function afrondingenVoor(supabase: SupabaseClient, rij: JobRij): Promise<[string[], string | null]> {
  const sopType = sopTypeVan(rij);
  if (!sopType || !rij.client_id || !rij.started_at) return [[], null];
  const [tekens, volgende] = await Promise.all([
    supabase.from("sop_analysis_output")
      .select("created_at")
      .eq("client_id", rij.client_id)
      .eq("sop_type", sopType)
      .eq("section", AFRONDINGS_SECTIE)
      .gte("created_at", rij.started_at)
      .order("created_at", { ascending: true })
      .limit(20),
    supabase.from("generation_jobs")
      .select("started_at")
      .eq("client_id", rij.client_id)
      .eq("metadata->>sop_type", sopType)
      .gt("started_at", rij.started_at)
      .order("started_at", { ascending: true })
      .limit(1),
  ]);
  if (tekens.error || volgende.error) {
    console.error(`[vastgelopen-runs] afrondingsteken van ${rij.job_id} lezen mislukt: ${(tekens.error ?? volgende.error)?.message}`);
    return [[], null];
  }
  const tijden = ((tekens.data ?? []) as { created_at: string | null }[]).map((r) => r.created_at).filter((t): t is string => !!t);
  const start = ((volgende.data ?? []) as { started_at: string | null }[])[0]?.started_at ?? null;
  return [tijden, start];
}
