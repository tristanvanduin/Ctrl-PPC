// EXECUTION_PLAN.md Stap 5: de Context Engine als interface, zonder implementatie. Geen
// throw new Error("Fase 2") lichamen: dat is een leeg omhulsel dat als werkend leest terwijl het
// niets doet. Een interface belooft niets en kan dus niet misleiden.

import type { BusinessEvent, ContextAnalysis } from "@/lib/decision/types";

export interface ContextEngine {
  /** Bouwt de contextlaag voor één klant uit zijn business events. Geen implementatie in deze
   *  stap: dat is Fase 2, wanneer een echte consument bepaalt wat er verder in ContextAnalysis
   *  moet staan. */
  analyze(input: { agencyId: string; accountId: string; events: BusinessEvent[] }): Promise<ContextAnalysis>;
}
