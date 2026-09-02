// De brug tussen de negen kwaliteitspoorten (quality-gates.ts) en de echte, live maandanalyse.
//
// Tot 2026-08-15 hing runGates() nergens aan app/api/analysis/monthly/route.ts -- alleen aan een
// admin-diagnosescherm en een niet-blootgestelde skeleton-route. Deze functie is het eerste,
// bewust NIET-blokkerende contact: aan het eind van elke echte run draaien de negen poorten op de
// data die de run toch al in het geheugen heeft, en het resultaat gaat naar
// quality_gate_observations. Niets in de analyse zelf verandert hierdoor.
//
// HERBOUW 2 SEPTEMBER 2026: de uitkomst wordt teruggegeven in plaats van weggeslikt. Migratie
// 083 maakt agency_id `uuid not null`; de aanroepers vulden bij een klant zonder bureau
// "onbekend" in, de insert faalde op een ongeldige uuid en er landde niets -- stil, want de
// enige melding was een logregel. Nu: zonder bureau-uuid wordt er niet geprobeerd en zegt de
// uitkomst waarom; een insertfout komt als tekst terug. Nog steeds faalzacht (nooit gooien naar
// de run), maar niet meer onzichtbaar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runGates, type GateInput } from "./quality-gates";
import { logger } from "@/lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GateObservatieUitkomst {
  geschreven: number;
  /** Waarom er niets (of minder) is geschreven; null als alles landde. */
  overgeslagen: string | null;
}

export async function recordGateObservations(supabase: SupabaseClient, input: GateInput): Promise<GateObservatieUitkomst> {
  try {
    const resultaten = runGates(input);
    if (!UUID_RE.test(input.agencyId)) {
      const reden = `geen bureau-uuid voor klant ${input.accountId} (agency_id is verplicht in quality_gate_observations)`;
      logger.warn("quality_gate_observations overgeslagen", { runId: input.runId, reden });
      return { geschreven: 0, overgeslagen: reden };
    }
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
      return { geschreven: 0, overgeslagen: error.message };
    }
    return { geschreven: rijen.length, overgeslagen: null };
  } catch (fout) {
    // Nooit de aanroepende run laten struikelen over een observatie die zelf niet werkte.
    const tekst = fout instanceof Error ? fout.message : String(fout);
    logger.warn("quality_gate_observations onverwacht mislukt", { fout: tekst, runId: input.runId });
    return { geschreven: 0, overgeslagen: tekst };
  }
}
