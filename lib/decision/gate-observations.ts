// De brug tussen de negen kwaliteitspoorten (quality-gates.ts) en de echte, live maandanalyse.
//
// Tot 2026-08-15 hing runGates() nergens aan app/api/analysis/monthly/route.ts -- alleen aan een
// admin-diagnosescherm en een niet-blootgestelde skeleton-route (zie de kop van migratie 083).
// Deze functie is het eerste, bewust NIET-blokkerende contact: aan het eind van elke echte run
// draaien de negen poorten op de data die de run toch al in het geheugen heeft, en het resultaat
// gaat naar quality_gate_observations. Niets in de analyse zelf verandert hierdoor -- geen enkele
// aanroeper mag hierop wachten voor iets anders dan logging.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runGates, type GateInput } from "./quality-gates";
import { logger } from "@/lib/logger";

export async function recordGateObservations(supabase: SupabaseClient, input: GateInput): Promise<void> {
  try {
    const resultaten = runGates(input);
    const rijen = resultaten.map((r) => ({
      run_id: input.runId,
      client_id: input.accountId,
      agency_id: input.agencyId,
      analysis_date: input.analysisDate,
      gate_name: r.gateName,
      status: r.status,
      reason: r.reason,
      affected_entity: r.affectedEntity ?? null,
    }));
    const { error } = await supabase.from("quality_gate_observations").insert(rijen);
    if (error) {
      logger.warn("quality_gate_observations wegschrijven mislukt", { fout: error.message, runId: input.runId });
    }
  } catch (fout) {
    // Nooit de aanroepende run laten struikelen over een observatie die zelf niet werkte.
    logger.warn("kwaliteitspoorten observeren mislukt", { fout: String(fout instanceof Error ? fout.message : fout), runId: input.runId });
  }
}
