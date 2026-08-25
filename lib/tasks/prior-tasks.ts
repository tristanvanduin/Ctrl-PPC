/**
 * De taken van de vorige cyclus ophalen voor de feed-forward-context.
 *
 * lib/tasks/task-tracking.ts levert de pure kern (buildTaskStatusGrounding) en is geschreven op
 * analysis_tasks uit migratie 006. Die tabel wordt echter nergens geschreven of gelezen — de
 * taken die de analyses werkelijk produceren belanden in sop_tasks. Deze module is de brug: hij
 * leest sop_tasks en mapt naar de PriorTask-vorm.
 *
 * Twee velden bestaan niet in sop_tasks:
 *
 *   execution_status  blijft "unknown". buildTaskStatusGrounding laat de notitie "(uitvoering
 *                     gedetecteerd)" dan gewoon weg. Dat is juist: we hebben geen detectie.
 *   deadline_hint     blijft null, dus geen escalatieregel. `frequency` ("weekly", "monthly")
 *                     lijkt erop maar betekent iets anders — hoe vaak de taak terugkomt, niet
 *                     hoe snel hij moet. Die twee door elkaar halen zou een taak ten onrechte
 *                     als urgent opvoeren.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriorTask, TaskStatus } from "./task-tracking";
import { sopTypesVanZelfdeKanaal } from "@/lib/analysis/sop-channel-config";

/** Hoeveel taken er hoogstens mee de prompt in gaan. */
const MAX_TAKEN = 40;

/**
 * sop_tasks kent een eigen statusverzameling. "completed" is daar wat task-tracking "done"
 * noemt; alles wat niet herkend wordt geldt als open, want een taak ten onrechte als afgerond
 * bestempelen is de gevaarlijkste kant — dan verdwijnt hij stilzwijgend uit de opvolging.
 */
export function mapTaskStatus(status: string | null | undefined): TaskStatus {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "done": return "done";
    case "in_progress":
    case "bezig": return "in_progress";
    case "skipped": return "skipped";
    case "wont_do":
    case "wont-do": return "wont_do";
    default: return "open";
  }
}

/** De entiteit waar de taak over gaat, in aflopende specificiteit. */
export function entityVanTaak(rij: Record<string, unknown>): string | null {
  const kandidaten = [rij.affected_keyword, rij.affected_adgroup, rij.affected_campaign];
  for (const k of kandidaten) {
    const s = typeof k === "string" ? k.trim() : "";
    if (s) return s;
  }
  return null;
}

/** Mapt ruwe sop_tasks-rijen naar de vorm die buildTaskStatusGrounding verwacht. */
export function toPriorTasks(rijen: Record<string, unknown>[]): PriorTask[] {
  return rijen
    .filter((r) => typeof r.title === "string" && r.title.trim() !== "")
    .map((r) => ({
      handeling: String(r.title).trim(),
      entity_name: entityVanTaak(r),
      status: mapTaskStatus(r.status as string | null),
      execution_status: "unknown" as const,
      deadline_hint: null,
    }));
}

/**
 * Haalt de taken op van vóór de huidige analysedatum. Een fout levert een lege lijst op en
 * daarmee een leeg groundingblok: de analyse draait dan zonder taakhistorie, precies zoals
 * voordat deze module bestond. Dat is beter dan de run laten vallen op een contextblok.
 *
 * `sopType` begrenst de historie tot het EIGEN KANAAL (alle drie de cadansen ervan, zie
 * sopTypesVanZelfdeKanaal). Zonder die begrenzing kreeg de Google-maandprompt de taken van de
 * Meta- en LinkedIn-runs ongelabeld binnen, mét de instructie afgeronde taken niet te herhalen --
 * dan leest een Google-analyse dat een LinkedIn-formulierwijziging al gedaan is en laat hij een
 * echte Google-actie liggen. Weglaten van het argument houdt het oude, ongefilterde gedrag; dat
 * is er voor aanroepers die hun kanaal niet weten.
 *
 * Taken zonder sop_type vallen buiten het filter. Dat is de goede kant om fout te gaan: na
 * migratie 104 is elke productietaak gelabeld, en wat er nog zonder label ligt komt van dagen
 * waarop alle kanalen tegelijk draaiden en dus niet toe te wijzen is. Zo'n taak alsnog meesturen
 * zou precies de vermenging zijn die dit filter opheft, en een verkeerde bewering in de prompt is
 * erger dan een ontbrekende.
 */
export async function priorTasksVoorGrounding(
  supabase: SupabaseClient,
  clientId: string,
  voorDatum: string,
  sopType?: string
): Promise<PriorTask[]> {
  try {
    let query = supabase
      .from("sop_tasks")
      .select("title, status, affected_campaign, affected_adgroup, affected_keyword, analysis_date")
      .eq("client_id", clientId)
      .lt("analysis_date", voorDatum);

    // Een leeg resultaat betekent "geen kanaalfilter mogelijk" (cross_channel): dan liever
    // ongefilterd dan alles weggooien.
    const kanaalTypes = sopType ? sopTypesVanZelfdeKanaal(sopType) : [];
    if (kanaalTypes.length > 0) query = query.in("sop_type", kanaalTypes);

    const { data, error } = await query
      .order("analysis_date", { ascending: false })
      .limit(MAX_TAKEN);
    if (error) return [];
    return toPriorTasks((data ?? []) as Record<string, unknown>[]);
  } catch {
    return [];
  }
}
