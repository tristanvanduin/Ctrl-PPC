// De negen bestaande kwaliteitsmodules als poorten in shadow mode.
//
// ── WAT "WRAPPER" HIER ECHT BETEKENT ─────────────────────────────────────────
//
// Elke poort roept de ECHTE functie aan uit zijn bronbestand -- geen enkele logica is hier
// opnieuw geschreven. Wat wél nieuw is: een uniforme QualityGateResult eromheen, en een
// try/catch-vangnet in runGates() zodat een falende poort de pijplijn nooit kan meeslepen.
//
// ── VIER VAN DE NEGEN DRAAIEN VANDAAG AL OP ECHTE DATA, VIJF NIET ────────────
//
// Onderzocht per module welke invoer hij nodig heeft, tegen wat er vandaag in de database staat
// (9 augustus 2026):
//
//   Data Quality Gate    computeDataReliability    ads_account_monthly + ads_campaign_monthly.
//                        VOLLEDIG voedbaar.
//   Math Gate            classifyRankLossCause     ads_campaign_impression_share +
//                        ads_keyword_performance_monthly (de module zegt dit zelf in zijn kop).
//                        VOLLEDIG voedbaar.
//   Evidence Gate        validateFindingClaims     sop_insights (entity_name/entity_type/metric/
//                        current_value) tegen een canonical map uit ads_campaign_monthly /
//                        ads_account_monthly. VOLLEDIG voedbaar.
//   Causal Chain Gate    computeKpiChain           twee ads_account_monthly-rijen. VOLLEDIG
//                        voedbaar.
//
//   Contradiction Gate   resolveContradictions     RecommendationLike vereist action_intent_
//                        class, action_unit_value, primary_entity_scope/key -- GEEN van deze
//                        kolommen bestaat in sop_recommendations.
//   Step Purity Gate     validateStepOutput        StepOutput vereist log_entries en top_3_
//                        findings als structuur; sop_analysis_output bewaart alleen de
//                        narratieve tekst, niet deze structuur.
//   Coverage Gate        enforceSopCoverage        IssueCluster vereist entity_scope,
//                        entity_identity_key, coverage_dimensions -- niet opgeslagen.
//   Action Gating Gate   applyActionGating         Finding vereist issue_cluster (verplicht,
//                        geen kolom-equivalent) en step -- niet opgeslagen.
//   Publish Gate         buildMonthlyQualityGate   ThreadRecommendation/ThreadTask/StepResult
//                        bestaan alleen als in-memory objecten TIJDENS een levende 13-staps-run.
//
// Dat is geen gok maar een meting per module, hieronder bij elke poort herhaald. De vijf rechts
// zijn dus vandaag nog niet te vullen zonder de 13-staps-pijplijn zelf aan te raken -- en dat mag
// niet in deze fase. Ze retourneren eerlijk `warn: input ontbreekt` in plaats van een verzonnen
// pass. Dat IS shadow mode: een poort die nog niet gevoed kan worden, meldt dat met een reden,
// en blokkeert niets. Zodra Fase 2 ze in de levende pijplijn aansluit, hoeft alleen de aanroep in
// de route te veranderen -- deze wrapper-functies zijn al correct.

import type { GateStatus, QualityGateResult } from "./types";
import { logger } from "@/lib/logger";

import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { spendWeightedQualityScore, classifyRankLossCause, type KeywordQsRow } from "@/lib/analysis/metric-cross-checks";
import { buildCanonicalMetricMap, validateFindingClaims } from "@/lib/analysis/claim-consistency";
import { computeKpiChain } from "@/lib/analysis/kpi-chain";
import { resolveContradictions, type RecommendationLike, type TaskLike } from "@/lib/analysis/contradiction-resolver";
import { validateStepOutput } from "@/lib/analysis/step-validator";
import { enforceSopCoverage } from "@/lib/analysis/coverage-enforcer";
import { applyActionGating } from "@/lib/analysis/action-gating";
import { validateMonthlyAcceptance, buildMonthlyQualityGate } from "@/lib/analysis/monthly-acceptance";
import type { IssueCluster, CoverageDimension } from "@/lib/analysis/canonicalize";
import type { Finding, Recommendation, StepOutput } from "@/lib/schema/analysis-schema";

// ── De invoer, per poort optioneel ───────────────────────────────────────────
//
// `Parameters<typeof fn>[0]` in plaats van het invoertype handmatig overtypen: die typen zijn in
// hun bronbestand niet geëxporteerd, en een handmatige kopie zou op de dag dat het echte type
// verandert stilzwijgend gaan afwijken -- exact het soort tweede-definitie-drift waar
// scripts/check-hygiene.mjs op let, alleen dan op een structural type in plaats van een naam.

export interface GateInput {
  runId: string;
  agencyId: string;
  accountId: string;
  analysisDate: string;

  dataQuality?: Parameters<typeof computeDataReliability>[0];
  rankLoss?: { keywords: KeywordQsRow[]; rankLostIs: number };
  claimCheck?: {
    stepNumber: number;
    findings: Array<Pick<Finding, "entity_name" | "entity_type" | "metric" | "current_value">>;
    campaignRows: Record<string, unknown>[];
    accountRows: Record<string, unknown>[];
    periodStart: string;
    periodEnd: string;
  };
  kpiChain?: Parameters<typeof computeKpiChain>[0];
  contradiction?: { recommendations: RecommendationLike[]; tasks: TaskLike[] };
  stepPurity?: { stepNumber: number; output: StepOutput; priorStepConclusion?: string };
  coverage?: { clusters: IssueCluster[]; dimensionAvailability: Partial<Record<CoverageDimension, boolean>> };
  actionGating?: { findings: Finding[]; recommendations: Recommendation[] };
  monthlyAcceptance?: Parameters<typeof validateMonthlyAcceptance>[0];
}

function ontbrekendeInvoer(gateName: string, reden: string): QualityGateResult {
  return { gateName, status: "warn", blocking: false, reason: `input ontbreekt: ${reden}`, repairAttempted: false, finalStatus: "warn" };
}

function resultaat(gateName: string, status: GateStatus, reason: string, affectedEntity?: string): QualityGateResult {
  return { gateName, status, blocking: false, reason, affectedEntity, finalStatus: status };
}

// 1. Data Quality Gate — ads_account_monthly + ads_campaign_monthly.
const CONFIDENCE_NAAR_STATUS: Record<string, GateStatus> = { high: "pass", medium: "pass", low: "warn", critical: "fail" };

function dataQualityGate(input: GateInput): QualityGateResult {
  if (!input.dataQuality) return ontbrekendeInvoer("Data Quality Gate", "geen accountMonthly/campaignMonthly meegegeven");
  const assessment = computeDataReliability(input.dataQuality);
  const status = CONFIDENCE_NAAR_STATUS[assessment.overallConfidence] ?? "warn";
  return resultaat("Data Quality Gate", status, assessment.overallExplanation);
}

// 2. Math Gate — rank-verlies: kwaliteit of bod. ads_campaign_impression_share + ads_keyword_performance_monthly.
function mathGate(input: GateInput): QualityGateResult {
  if (!input.rankLoss) return ontbrekendeInvoer("Math Gate", "geen rank_lost_is / keyword-QS meegegeven");
  const qs = spendWeightedQualityScore(input.rankLoss.keywords);
  const diagnose = classifyRankLossCause(input.rankLoss.rankLostIs, qs);
  const status: GateStatus = diagnose.cause === "geen_qs_data" ? "warn" : "pass";
  return resultaat("Math Gate", status, diagnose.detail);
}

// 3. Evidence Gate — geclaimde waarden in sop_insights tegen de canonical ads_*_monthly-cijfers.
function evidenceGate(input: GateInput): QualityGateResult {
  if (!input.claimCheck) return ontbrekendeInvoer("Evidence Gate", "geen findings/canonical rijen meegegeven");
  const { stepNumber, findings, campaignRows, accountRows, periodStart, periodEnd } = input.claimCheck;
  const map = buildCanonicalMetricMap(campaignRows, accountRows, periodStart, periodEnd);
  const issues = validateFindingClaims(stepNumber, findings, map);
  if (issues.length === 0) return resultaat("Evidence Gate", "pass", "geen claims wijken af van de canonical cijfers");
  return resultaat(
    "Evidence Gate", "warn",
    `${issues.length} claim(s) wijken af: ${issues.slice(0, 3).map((i) => i.message).join(" | ")}`,
    issues[0].entity_name
  );
}

// 4. Causal Chain Gate — welke metric verklaart de verandering in het resultaat.
function causalChainGate(input: GateInput): QualityGateResult {
  if (!input.kpiChain) return ontbrekendeInvoer("Causal Chain Gate", "geen currentMonth/previousMonth meegegeven");
  const chain = computeKpiChain(input.kpiChain);
  return resultaat("Causal Chain Gate", "pass", chain.formattedChain);
}

// 5. Contradiction Gate — botsende aanbevelingen op dezelfde entiteit/metriek.
// LIVE-INVOER ONTBREEKT VANDAAG: RecommendationLike vereist action_intent_class, action_unit_key,
// primary_entity_scope, primary_entity_key en canonical_entity_name; geen van deze kolommen
// bestaat in sop_recommendations (gemeten 9 augustus 2026).
function contradictionGate(input: GateInput): QualityGateResult {
  if (!input.contradiction) {
    return ontbrekendeInvoer(
      "Contradiction Gate",
      "RecommendationLike vereist action_intent_class/action_unit_key/primary_entity_scope/" +
      "primary_entity_key, niet aanwezig in sop_recommendations; alleen te vullen vanuit de levende 13-staps-run"
    );
  }
  const opgelost = resolveContradictions(input.contradiction.recommendations, input.contradiction.tasks);
  const samengevoegd = input.contradiction.recommendations.length - opgelost.recommendations.length;
  if (samengevoegd === 0) return resultaat("Contradiction Gate", "pass", "geen tegenstrijdige aanbevelingen gevonden");
  return resultaat("Contradiction Gate", "warn", `${samengevoegd} aanbeveling(en) samengevoegd wegens een conflict op dezelfde entiteit`);
}

// 6. Step Purity Gate — narratief, log-format en step-purity van één stapoutput.
// LIVE-INVOER ONTBREEKT VANDAAG: StepOutput vereist log_entries en top_3_findings als structuur;
// sop_analysis_output bewaart alleen de narratieve tekst van een stap, niet deze structuur.
function stepPurityGate(input: GateInput): QualityGateResult {
  if (!input.stepPurity) {
    return ontbrekendeInvoer(
      "Step Purity Gate",
      "StepOutput (log_entries, top_3_findings als structuur) wordt niet apart opgeslagen; " +
      "alleen te vullen vanuit de levende 13-staps-run"
    );
  }
  const { stepNumber, output, priorStepConclusion } = input.stepPurity;
  const validatie = validateStepOutput(stepNumber, output, priorStepConclusion);
  if (validatie.errors.length > 0) return resultaat("Step Purity Gate", "fail", validatie.errors.join(" | "));
  if (validatie.warnings.length > 0) return resultaat("Step Purity Gate", "warn", validatie.warnings.join(" | "));
  return resultaat("Step Purity Gate", "pass", `stap ${stepNumber} zonder waarschuwingen`);
}

// 7. Coverage Gate — welke SOP-dimensies zijn behandeld tegenover wat beschikbaar was.
// LIVE-INVOER ONTBREEKT VANDAAG: IssueCluster vereist entity_scope, entity_identity_key en
// coverage_dimensions; deze velden worden niet opgeslagen.
function coverageGate(input: GateInput): QualityGateResult {
  if (!input.coverage) {
    return ontbrekendeInvoer(
      "Coverage Gate",
      "IssueCluster (entity_scope, entity_identity_key, coverage_dimensions) bestaat alleen " +
      "tijdens de levende 13-staps-run"
    );
  }
  const uitkomst = enforceSopCoverage(input.coverage.clusters, input.coverage.dimensionAvailability);
  if (!uitkomst.traceabilityOk) return resultaat("Coverage Gate", "fail", "een gedekte dimensie verwijst naar een cluster dat niet bestaat");
  if (uitkomst.missingAvailableDimensions.length > 0) {
    return resultaat("Coverage Gate", "warn", `beschikbare dimensies zonder signaal: ${uitkomst.missingAvailableDimensions.join(", ")}`);
  }
  return resultaat("Coverage Gate", "pass", `${uitkomst.surfacedDimensions.length} dimensie(s) gedekt`);
}

// 8. Sprint Readiness Gate — mag een aanbeveling als direct_action de deur uit.
// LIVE-INVOER ONTBREEKT VANDAAG: Finding vereist issue_cluster (verplicht veld, geen kolom-
// equivalent) en step; sop_insights bewaart geen van beide.
function sprintReadinessGate(input: GateInput): QualityGateResult {
  if (!input.actionGating) {
    return ontbrekendeInvoer(
      "Sprint Readiness Gate",
      "Finding.issue_cluster (verplicht) en Finding.step hebben geen kolom-equivalent in " +
      "sop_insights; alleen te vullen vanuit de levende 13-staps-run"
    );
  }
  const voor = input.actionGating.recommendations.filter((r) => (r as Record<string, unknown>).action_readiness === "direct_action").length;
  const na = applyActionGating(input.actionGating.findings, input.actionGating.recommendations)
    .filter((r) => (r as Record<string, unknown>).action_readiness === "direct_action").length;
  if (na === voor) return resultaat("Sprint Readiness Gate", "pass", `${na} aanbeveling(en) blijven direct_action`);
  return resultaat("Sprint Readiness Gate", "warn", `${voor - na} aanbeveling(en) afgewaardeerd van direct_action`);
}

// 9. Publish Gate — mag de maandrun naar structured save/export.
// LIVE-INVOER ONTBREEKT VANDAAG: ThreadRecommendation/ThreadTask/StepResult zijn in-memory
// objecten die alleen bestaan tijdens een levende maandrun.
function publishGate(input: GateInput): QualityGateResult {
  if (!input.monthlyAcceptance) {
    return ontbrekendeInvoer(
      "Publish Gate",
      "ThreadRecommendation/ThreadTask/StepResult bestaan alleen tijdens een levende 13-staps-run"
    );
  }
  const acceptance = validateMonthlyAcceptance(input.monthlyAcceptance);
  const rapport = buildMonthlyQualityGate({ stepValidations: input.monthlyAcceptance.stepValidations ?? [], acceptance });
  if (rapport.passed) return resultaat("Publish Gate", "pass", "alle acceptatiecriteria gehaald");
  return resultaat("Publish Gate", rapport.state === "blocked_invalid_steps" ? "fail" : "warn", rapport.blocking_reasons.join(" | "));
}

export const GATES: ReadonlyArray<{ name: string; run: (input: GateInput) => QualityGateResult }> = [
  { name: "Data Quality Gate", run: dataQualityGate },
  { name: "Math Gate", run: mathGate },
  { name: "Evidence Gate", run: evidenceGate },
  { name: "Causal Chain Gate", run: causalChainGate },
  { name: "Contradiction Gate", run: contradictionGate },
  { name: "Step Purity Gate", run: stepPurityGate },
  { name: "Coverage Gate", run: coverageGate },
  { name: "Sprint Readiness Gate", run: sprintReadinessGate },
  { name: "Publish Gate", run: publishGate },
];

/**
 * Draait alle negen poorten. Elke poort in zijn eigen try/catch, zodat een fout in de ene poort
 * de andere acht niet meesleept -- de "Shadow Mode Safety Rule" uit de blueprint, op één plek
 * geconcentreerd in plaats van in elke poort apart, zodat hij maar één keer getest hoeft te
 * worden. Zie __quality_gates_test.ts voor het bewijs: een poort die gegarandeerd gooit, en de
 * eis dat de andere acht toch hun eigen resultaat teruggeven.
 */
export function runGates(
  input: GateInput,
  // Override alleen voor de zelftest: een gegarandeerd falende poort toevoegen zonder de
  // productielijst in GATES aan te raken.
  gates: ReadonlyArray<{ name: string; run: (input: GateInput) => QualityGateResult }> = GATES
): QualityGateResult[] {
  return gates.map(({ name, run }) => {
    try {
      return run(input);
    } catch (fout) {
      logger.warn("quality-gate faalde", { gate: name, runId: input.runId, fout: String(fout) });
      return {
        gateName: name, status: "warn" as const, blocking: false,
        reason: `poort wierp een fout: ${String(fout instanceof Error ? fout.message : fout)}`,
        repairAttempted: false, finalStatus: "warn" as const,
      };
    }
  });
}
