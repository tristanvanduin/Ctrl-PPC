// Fase 4 (docs/MASTERPLAN.md sectie 9): de enige schrijfweg naar agency_memory_events. Eén
// functie, zodat het eventtype-vocabulaire (de tien types, zie migratie 091) op één plek leeft
// in plaats van als losse stringliterals bij elke aanroeper.
//
// De vier producenten: lib/second-opinion/findings-to-hypotheses.ts (hypothesis_proposed),
// app/api/insights/monthly-hypotheses/route.ts + components/insights/proposal-queue.tsx
// (hypothesis_accepted/hypothesis_rejected), en app/api/cron/evaluate-hypotheses/route.ts
// (hypothesis_executed/not_executed/outcome_met/outcome_missed/unmeasurable/expired).

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export type AgencyMemoryEventType =
  | "hypothesis_proposed"
  | "hypothesis_accepted"
  | "hypothesis_rejected"
  | "hypothesis_executed"
  | "hypothesis_not_executed"
  | "hypothesis_outcome_met"
  | "hypothesis_outcome_missed"
  | "hypothesis_unmeasurable"
  | "hypothesis_expired"
  /** Loop 5 (sectie 4): nog geen automatische schrijver. Zie migratie 091. */
  | "confidence_recalibrated";

export interface AgencyMemoryEventInput {
  clientId: string | null;
  hypothesisId: string | null;
  eventType: AgencyMemoryEventType;
  reason?: string | null;
  metrics?: Record<string, unknown> | null;
}

/**
 * De evaluatiecron (app/api/cron/evaluate-hypotheses/route.ts) verrijkt zijn metriek-verdict
 * met uitvoeringsdetectie tot zeven mogelijke eindwaarden. Eén verdict kan tot twee events
 * leiden: uitvoering en uitkomst zijn twee losse feiten (een hypothese kan uitgevoerd zijn EN
 * de voorspelde uitkomst gehaald hebben -- allebei het vermelden waard). Onbekende waarden
 * leveren bewust een lege lijst op i.p.v. een gok of een crash.
 */
export function memoryEventsForVerdict(verdict: string): AgencyMemoryEventType[] {
  switch (verdict) {
    case "uitgevoerd_en_gehaald": return ["hypothesis_executed", "hypothesis_outcome_met"];
    case "uitgevoerd_en_niet_gehaald": return ["hypothesis_executed", "hypothesis_outcome_missed"];
    case "niet_uitgevoerd": return ["hypothesis_not_executed"];
    case "accepted": return ["hypothesis_outcome_met"];
    case "rejected": return ["hypothesis_outcome_missed"];
    case "unmeasurable": return ["hypothesis_unmeasurable"];
    case "expired": return ["hypothesis_expired"];
    default: return [];
  }
}

/**
 * Schrijft één memory-event. Faalt zacht (gelogd, niet gegooid) — zelfde discipline als
 * lib/progress/server.ts's upsertEvent: een geheugen-event dat niet wegschrijft mag de
 * hoofdactie (een hypothese accepteren/afwijzen, een verdict schrijven) niet laten mislukken.
 */
export async function recordMemoryEvent(supabase: SupabaseClient, input: AgencyMemoryEventInput): Promise<void> {
  const { error } = await supabase.from("agency_memory_events").insert({
    client_id: input.clientId,
    hypothesis_id: input.hypothesisId,
    event_type: input.eventType,
    reason: input.reason ?? null,
    metrics: input.metrics ?? null,
  });
  if (error) {
    logger.error(`[agency-memory-events] schrijven van ${input.eventType} mislukt: ${error.message}`);
  }
}
