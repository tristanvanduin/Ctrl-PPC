// Master Synthesis, Fase C: het schrijfpad. Drie bestemmingen, in deze volgorde:
//   1. sop_analysis_output (section "master_synthesis_v1"): de leesbare uitkomst voor de kaart,
//      en zijn id is de analysis_id op de sprint_hypotheses-rijen -- zelfde volgorde als
//      persistMonthlyStructuredData() in monthly/route.ts.
//   2. sprint_hypotheses via saveProposalsReplacingPending (source "master_synthesis"): de
//      goedkeuringswachtrij, dezelfde tabel als second_opinion, cross_channel, meta_funnel.
//   3. sprint_items: de gecombineerde sprinttaken, gekoppeld via hypothesis_id.
//
// HERBOUW 2 SEPTEMBER 2026
// - Elke schrijffout werd geslikt en de route meldde "opgeslagen". Zo kon de kaart groen staan
//   terwijl de tabel leeg bleef -- de meest waarschijnlijke verklaring voor nul
//   master_synthesis-rijen in de database. Nu gooit elke stap (DataLaagFout) en de route
//   antwoordt met een 500 die de tabel noemt.
// - sprint_items viel buiten de replace-pending-semantiek: bij een herrun werden de oude
//   pending-hypotheses vervangen (ON DELETE SET NULL op sprint_items.hypothesis_id) en de
//   nieuwe taken erbíj gezet. Elke herrun liet N weestaken "todo" achter in de sprintplanning.
//   Nu worden de weestaken van deze bron eerst opgeruimd.
// - saveProposalsReplacingPending() geeft geen ids terug (gedeeld met ~15 bronnen, bewust niet
//   gewijzigd); de pending rijen van source "master_synthesis" ná een geslaagde call ZIJN de
//   zojuist ingevoegde rijen, dus een her-select op de hypothese-tekst is de koppeling.
//   Gelijke teksten worden gemeld (tasksUnlinked), niet stil verkeerd gekoppeld.

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { OWNER_TEAM } from "@/lib/branding/brand";
import { DataLaagFout, eis } from "@/lib/analysis/db-veilig";
import type { MasterSynthesisOutput } from "./master-synthesis-schema";

export const MASTER_SYNTHESIS_SOP_TYPE = "master_synthesis";
export const MASTER_SYNTHESIS_SECTION = "master_synthesis_v1";
const BRON = "master_synthesis";

export interface MasterSynthesisStorageResult {
  hypothesesSaved: number;
  tasksSaved: number;
  /** Taken die wel zijn opgeslagen maar zonder hypothesis_id-koppeling (gelijke hypothese-
   *  teksten of een ontbrekende rij). Nooit stil verzwijgen. */
  tasksUnlinked: number;
  /** Weestaken van een eerdere run die zijn opgeruimd vóór het schrijven. */
  wezenOpgeruimd: number;
}

// Puur, apart getest (__master_synthesis_storage_test.ts).
export function renderMasterSynthesisMarkdown(output: MasterSynthesisOutput): string {
  const lines: string[] = ["## Master Synthesis", "", output.narrative, "", "### Hypotheses"];
  output.hypotheses.forEach((h, i) => {
    lines.push(`${i + 1}. **${h.hypothesis}** — kanalen: ${h.contributing_channels.join(", ")}, ICE ${h.ice_total}`);
    lines.push(`   ${h.rationale}`);
  });
  if (output.tasks.length > 0) {
    lines.push("", "### Sprinttaken");
    output.tasks.forEach((t) => {
      lines.push(`- **${t.title}** (${t.contributing_channels.join(", ")}, ${t.priority}) — ${t.description}`);
    });
  }
  lines.push("", "### Conclusie", output.step_conclusion);
  return lines.join("\n");
}

export async function saveMasterSynthesis(opts: {
  supabase: SupabaseClient;
  clientId: string;
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  output: MasterSynthesisOutput;
  model: string;
  tokensUsed: number;
}): Promise<MasterSynthesisStorageResult> {
  const { supabase, clientId, analysisDate, periodStart, periodEnd, output, model, tokensUsed } = opts;

  // 1. sop_analysis_output.
  const { data: savedOutput, error: saveError } = await saveAnalysisOutputSection({
    supabase,
    select: "id",
    row: {
      client_id: clientId,
      sop_type: MASTER_SYNTHESIS_SOP_TYPE,
      analysis_date: analysisDate,
      period_start: periodStart,
      period_end: periodEnd,
      section: MASTER_SYNTHESIS_SECTION,
      output: renderMasterSynthesisMarkdown(output),
      model_used: model,
      tokens_used: tokensUsed,
      step_number: 1,
      step_name: "Master Synthesis",
    },
  });
  if (saveError) throw new DataLaagFout("sop_analysis_output (master_synthesis_v1)", saveError.message);
  const analysisId = savedOutput && typeof savedOutput === "object" && "id" in savedOutput
    ? String((savedOutput as { id: unknown }).id)
    : null;

  // 2. Hypotheses -> sprint_hypotheses (vervangt de pending van deze bron).
  const hypothesisRows: SprintHypothesisRow[] = output.hypotheses.map((h) => ({
    client_id: clientId,
    analysis_id: analysisId,
    hypothesis: h.hypothesis,
    expected_result: h.expected_result,
    measurement_metric: h.measurement_metric,
    timeframe: h.timeframe,
    rationale: h.rationale,
    ice_impact: h.ice_impact,
    ice_confidence: h.ice_confidence,
    ice_ease: h.ice_ease,
    ice_total: h.ice_total,
    status: "pending",
    source: BRON,
    metadata: { contributing_channels: h.contributing_channels },
  }));
  const hypothesesSaved = await saveProposalsReplacingPending(supabase, clientId, BRON, hypothesisRows);
  // Het schema eist minstens één hypothese; nul opgeslagen betekent dus dat de lees- of
  // insertstap faalde (saveProposalsReplacingPending logt en geeft 0). Niet als succes melden.
  if (hypothesisRows.length > 0 && hypothesesSaved === 0) {
    throw new DataLaagFout("sprint_hypotheses (master_synthesis)", "voorstellen niet opgeslagen: lees- of insertfout, oude pending bleef staan (zie serverlog)");
  }

  // 3. Weestaken van deze bron opruimen: de vervangen pending-hypotheses hebben hun taken net
  // losgekoppeld (ON DELETE SET NULL). Alleen rijen van deze bron zonder koppeling.
  const bestaandeWezen = eis(
    await supabase
      .from("sprint_items")
      .select("id")
      .eq("client_id", clientId)
      .eq("metadata->>source", BRON)
      .is("hypothesis_id", null)
      .limit(500),
    "sprint_items (wezen tellen)"
  ) as { id: string }[];
  let wezenOpgeruimd = 0;
  if (bestaandeWezen.length > 0) {
    const del = await supabase.from("sprint_items").delete().in("id", bestaandeWezen.map((r) => r.id));
    if (del.error) throw new DataLaagFout("sprint_items (wezen opruimen)", del.error.message);
    wezenOpgeruimd = bestaandeWezen.length;
  }

  // 4. Taken -> sprint_items, gekoppeld via hypothesis_id.
  let tasksSaved = 0;
  let tasksUnlinked = 0;
  if (hypothesesSaved > 0 && output.tasks.length > 0) {
    const pendingRows = eis(
      await supabase
        .from("sprint_hypotheses")
        .select("id, hypothesis")
        .eq("client_id", clientId)
        .eq("source", BRON)
        .eq("status", "pending")
        .limit(100),
      "sprint_hypotheses (koppeling master_synthesis)"
    ) as { id: unknown; hypothesis: unknown }[];
    const idByHypothesisText = new Map<string, string>();
    const dubbeleTeksten = new Set<string>();
    for (const r of pendingRows) {
      const tekst = String(r.hypothesis);
      if (idByHypothesisText.has(tekst)) dubbeleTeksten.add(tekst);
      idByHypothesisText.set(tekst, String(r.id));
    }

    const itemRows = output.tasks.map((t) => {
      const hypothesisText = output.hypotheses[t.hypothesis_index]?.hypothesis;
      // Bij gelijke teksten is de koppeling een gok; dan liever geen koppeling en tellen.
      const hypothesisId = hypothesisText && !dubbeleTeksten.has(hypothesisText)
        ? (idByHypothesisText.get(hypothesisText) ?? null)
        : null;
      return {
        client_id: clientId,
        hypothesis_id: hypothesisId,
        task: `${t.title}: ${t.description}`,
        status: "todo",
        owner: OWNER_TEAM,
        review_timeframe: `${t.frequency}, binnen ${t.due_date_days} dagen`,
        metadata: {
          contributing_channels: t.contributing_channels,
          action_type: t.action_type,
          priority: t.priority,
          frequency: t.frequency,
          due_date_days: t.due_date_days,
          source: BRON,
        },
      };
    });
    tasksUnlinked = itemRows.filter((r) => r.hypothesis_id === null).length;

    const ins = await supabase.from("sprint_items").insert(itemRows);
    if (ins.error) throw new DataLaagFout("sprint_items (master_synthesis)", ins.error.message);
    tasksSaved = itemRows.length;
  }

  return { hypothesesSaved, tasksSaved, tasksUnlinked, wezenOpgeruimd };
}
