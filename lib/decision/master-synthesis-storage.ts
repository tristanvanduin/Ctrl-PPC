// Master Synthesis (Pijler 6), Fase C: het schrijfpad. Twee bestemmingen:
//   1. sprint_hypotheses (via het bestaande saveProposalsReplacingPending-patroon, source
//      "master_synthesis") -- de goedkeuringswachtrij, zelfde tabel als second_opinion,
//      cross_channel, meta_funnel, etc.
//   2. sprint_items (nieuw hier bedraad) -- de gecombineerde sprinttaken, gekoppeld via
//      hypothesis_id aan de zojuist geschreven sprint_hypotheses-rij.
// Plus een sop_analysis_output-record (section "master_synthesis_v1") zodat de analysecatalogus
// (analysis-catalog.ts) "is dit al gedraaid" kan tonen, net als cross_channel_v1.
//
// saveProposalsReplacingPending() geeft geen ids terug (gedeeld met ~15 andere aanroepers,
// bewust niet gewijzigd voor dit ene gebruik); de rijen die na een geslaagde call pending staan
// voor source="master_synthesis" ZIJN exact de rijen die net zijn ingevoegd (dat garandeert de
// replace-pending-semantiek), dus een her-select op de hypothesis-tekst is de betrouwbare
// koppeling naar de gegenereerde id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import type { MasterSynthesisOutput } from "./master-synthesis-schema";

export interface MasterSynthesisStorageResult {
  hypothesesSaved: number;
  tasksSaved: number;
  /** Taken die wel zijn opgeslagen maar zonder hypothesis_id-koppeling (zou niet moeten
   *  voorkomen na een geldige validatie; nooit stil verzwijgen als het toch gebeurt). */
  tasksUnlinked: number;
}

// Puur, apart getest (__master_synthesis_storage_test.ts) -- de rest van dit bestand is de
// LIVE-ONGETESTE grens (Supabase-writes), zelfde laagverdeling als elders in deze codebase.
export function renderMasterSynthesisMarkdown(output: MasterSynthesisOutput): string {
  const lines: string[] = ["## Master Synthesis (Pijler 6)", "", output.narrative, "", "### Hypotheses"];
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

  // 1. sop_analysis_output eerst, want zijn id is de analysis_id op de sprint_hypotheses-rijen
  // hieronder -- zelfde volgorde als persistMonthlyStructuredData() in monthly/route.ts.
  const { data: savedOutput } = await saveAnalysisOutputSection({
    supabase,
    select: "id",
    row: {
      client_id: clientId,
      sop_type: "master_synthesis",
      analysis_date: analysisDate,
      period_start: periodStart,
      period_end: periodEnd,
      section: "master_synthesis_v1",
      output: renderMasterSynthesisMarkdown(output),
      model_used: model,
      tokens_used: tokensUsed,
      step_number: 1,
      step_name: "Master Synthesis",
    },
  });
  const analysisId = savedOutput && typeof savedOutput === "object" && "id" in savedOutput
    ? String((savedOutput as { id: unknown }).id)
    : null;

  // 2. Hypotheses -> sprint_hypotheses.
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
    source: "master_synthesis",
    metadata: { contributing_channels: h.contributing_channels },
  }));
  const hypothesesSaved = await saveProposalsReplacingPending(supabase, clientId, "master_synthesis", hypothesisRows);

  // 2. Taken -> sprint_items, gekoppeld via hypothesis_id.
  let tasksSaved = 0;
  let tasksUnlinked = 0;
  if (hypothesesSaved > 0 && output.tasks.length > 0) {
    const { data: pendingRows } = await supabase
      .from("sprint_hypotheses")
      .select("id, hypothesis")
      .eq("client_id", clientId)
      .eq("source", "master_synthesis")
      .eq("status", "pending");
    const idByHypothesisText = new Map((pendingRows ?? []).map((r) => [String(r.hypothesis), String(r.id)]));

    const itemRows = output.tasks.map((t) => {
      const hypothesisText = output.hypotheses[t.hypothesis_index]?.hypothesis;
      const hypothesisId = hypothesisText ? (idByHypothesisText.get(hypothesisText) ?? null) : null;
      return {
        client_id: clientId,
        hypothesis_id: hypothesisId,
        task: `${t.title}: ${t.description}`,
        status: "todo",
        owner: "Bureau",
        review_timeframe: `${t.frequency}, binnen ${t.due_date_days} dagen`,
        metadata: {
          contributing_channels: t.contributing_channels,
          action_type: t.action_type,
          priority: t.priority,
          frequency: t.frequency,
          due_date_days: t.due_date_days,
          source: "master_synthesis",
        },
      };
    });
    tasksUnlinked = itemRows.filter((r) => r.hypothesis_id === null).length;

    const { error } = await supabase.from("sprint_items").insert(itemRows);
    if (!error) tasksSaved = itemRows.length;
  }

  return { hypothesesSaved, tasksSaved, tasksUnlinked };
}
