// Kernbegrippen voor de kwaliteitspoorten. Bewust klein: de bredere Decision Engine-typen uit
// EXECUTION_PLAN.md (Signal, Hypothesis, DecisionThread, ...) staan hier NIET, want niets in deze
// stap consumeert ze. Ze bouwen zonder consument is precies het patroon dat TOEGESTANE_WEZEN in
// scripts/check-hygiene.mjs bijhoudt -- gebouwd, nergens op aangesloten. Ze komen erbij zodra een
// route ze nodig heeft, niet vooruitlopend erop.

export type GateStatus = "pass" | "warn" | "fail";

export interface QualityGateResult {
  gateName: string;
  status: GateStatus;
  /** In Fase 1 altijd false: shadow mode, geen poort blokkeert de pijplijn. */
  blocking: boolean;
  reason?: string;
  affectedEntity?: string;
  repairAttempted?: boolean;
  finalStatus: GateStatus;
}

export interface TenantScoped {
  agencyId: string;
  accountId: string;
}
