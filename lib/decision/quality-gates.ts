// De negen bestaande kwaliteitsmodules als poorten in shadow mode.
//
// ── WAT "WRAPPER" HIER ECHT BETEKENT ─────────────────────────────────────────
//
// Elke poort roept de ECHTE functie aan uit zijn bronbestand -- geen enkele logica is hier
// opnieuw geschreven. Wat wél nieuw is: een uniforme QualityGateResult eromheen, en een
// try/catch-vangnet in runGates() zodat een falende poort de pijplijn nooit kan meeslepen.
//
// ── LEGE INVOER IS GEEN PASS (herbouw 2 september 2026) ──────────────────────
//
// Zes van de negen poorten gaven "pass" op een AANWEZIGE-MAAR-LEGE invoer: nul findings wijken
// nooit af, nul aanbevelingen spreken elkaar nooit tegen, nul dimensies zijn "gedekt". Zo
// kleurde quality_gate_observations groen op runs waar niets te toetsen viel. Een lege lijst is
// nu, net als `undefined`, "input ontbreekt" (warn) -- pass betekent weer: getoetst en goed.
//
// ── FASE 2: DE VIJF ONTBREKENDE POORTEN BLIJKEN AL GEVOED TE WORDEN ─────────
//
// Fase 1 concludeerde dat vijf poorten hun invoer alleen als in-memory object tijdens een
// levende 13-staps-run hebben, en dus zonder de pijplijn aan te raken niet te vullen zijn.
// Uitgezocht in app/api/analysis/monthly/route.ts of dat klopt: de route bewaart ALLES wat
// deze poorten nodig hebben, elke run, als JSON in sop_analysis_output --
//
//   section "structured_monthly_v2"   recommendations (ThreadRecommendation[]), tasks
//                                      (ThreadTask[]), findings (NormalizedFinding[]),
//                                      parsed_steps (narrative/log_entries/findings/actions
//                                      per stap), coverage (SopCoverage[])
//   section "quality_gate_monthly_v2" step_validations (StepValidationResult[]),
//                                      acceptance (AcceptanceReport), passed/state/
//                                      blocking_reasons (het Publish-oordeel zelf)
//
// ThreadRecommendation extends Recommendation MET action_intent_class, action_unit_key,
// primary_entity_scope, primary_entity_key, canonical_entity_name en dependencies -- exact
// RecommendationLike. ThreadTask extends Task op dezelfde manier -- exact TaskLike.
// NormalizedFinding extends Finding, dus voldoet aan Finding[] zonder meer. Geen van deze
// objecten hoeft dus uit de LEVENDE pijplijn te komen: ze liggen al in de database, als
// bijproduct van een write die er toch al was. Vandaar GEEN interceptor in monthly-v2.ts of
// pump-plan.ts, en geen enkele regel in de 13-staps-route gewijzigd voor Fase 2 -- lezen uit
// wat er al staat is de veiligere weg naar hetzelfde doel.
//
// Drie poorten (Step Purity, Coverage, Publish) krijgen daarom een SNEL PAD: in plaats van
// zelf te herberekenen wat de levende run al berekende (en daarmee het risico te lopen een
// andere uitkomst te geven dan de run zelf gaf), lezen ze het AL BEREKENDE resultaat direct.
// Het oude pad (zelf herberekenen vanuit ruwe StepOutput/IssueCluster/opts) blijft bestaan
// voor een aanroeper die die ruwe vorm wél heeft -- vandaar "of/of", nooit een breking wijziging.
//
// Twee poorten (Contradiction, Sprint Readiness) hadden geen bestaande berekening om op mee
// te liften -- resolveContradictions en applyActionGating worden vandaag nergens in de
// pijplijn aangeroepen. Die draaien dus voor het eerst, als een ECHTE tweede mening naast de
// dedup-logica die al inline in monthly-structured.ts zit. Onenigheid daartussen is precies
// het soort signaal waar shadow mode voor bestaat.

import type { GateStatus, QualityGateResult } from "./types";
import { logger } from "@/lib/logger";

import { computeDataReliability } from "@/lib/analysis/data-reliability";
import { spendWeightedQualityScore, classifyRankLossCause, type KeywordQsRow } from "@/lib/analysis/metric-cross-checks";
import { buildCanonicalMetricMap, validateFindingClaims } from "@/lib/analysis/claim-consistency";
import { computeKpiChain } from "@/lib/analysis/kpi-chain";
import { resolveContradictions, type RecommendationLike, type TaskLike } from "@/lib/analysis/contradiction-resolver";
import { validateStepOutput, type StepValidationResult } from "@/lib/analysis/step-validator";
import { enforceSopCoverage } from "@/lib/analysis/coverage-enforcer";
import { applyActionGating } from "@/lib/analysis/action-gating";
import { validateMonthlyAcceptance, buildMonthlyQualityGate } from "@/lib/analysis/monthly-acceptance";
import type { IssueCluster, CoverageDimension, SopCoverage } from "@/lib/analysis/canonicalize";
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

  // Step Purity: het snelle pad (al gevalideerd door de levende run) of het ruwe pad (zelf
  // valideren vanuit één StepOutput).
  stepValidationsReport?: StepValidationResult[];
  stepPurity?: { stepNumber: number; output: StepOutput; priorStepConclusion?: string };

  // Coverage: het snelle pad (SopCoverage[], het resultaat van enforceSopCoverage in de
  // levende run) of het ruwe pad (zelf enforceSopCoverage draaien vanuit IssueCluster[]).
  coverageReport?: SopCoverage[];
  coverage?: { clusters: IssueCluster[]; dimensionAvailability: Partial<Record<CoverageDimension, boolean>> };

  actionGating?: { findings: Finding[]; recommendations: Recommendation[] };

  // Publish: het snelle pad (het MonthlyQualityGateReport dat de levende run al opsloeg) of
  // het ruwe pad (zelf validateMonthlyAcceptance + buildMonthlyQualityGate draaien).
  publishReport?: { passed: boolean; state: string; blockingReasons: string[] };
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
  if (input.rankLoss.keywords.length === 0) return ontbrekendeInvoer("Math Gate", "keyword-lijst is leeg (wel meegegeven, niets te wegen)");
  const qs = spendWeightedQualityScore(input.rankLoss.keywords);
  const diagnose = classifyRankLossCause(input.rankLoss.rankLostIs, qs);
  const status: GateStatus = diagnose.cause === "geen_qs_data" ? "warn" : "pass";
  return resultaat("Math Gate", status, diagnose.detail);
}

// 3. Evidence Gate — geclaimde waarden in sop_insights tegen de canonical ads_*_monthly-cijfers.
function evidenceGate(input: GateInput): QualityGateResult {
  if (!input.claimCheck) return ontbrekendeInvoer("Evidence Gate", "geen findings/canonical rijen meegegeven");
  const { stepNumber, findings, campaignRows, accountRows, periodStart, periodEnd } = input.claimCheck;
  if (findings.length === 0) return ontbrekendeInvoer("Evidence Gate", "geen findings om te toetsen (lege lijst is geen bewijs van consistentie)");
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
  // Beschrijvend, geen toets: computeKpiChain legt uit welke metric de verandering draagt en kan
  // niet "falen". Dat staat in de reden, zodat een groene rij hier nooit als bewijs leest.
  return resultaat("Causal Chain Gate", "pass", `beschrijvend (geen toets): ${chain.formattedChain}`);
}

// 5. Contradiction Gate — botsende aanbevelingen op dezelfde entiteit/metriek. Draait voor het
// eerst als expliciete tweede mening: resolveContradictions wordt nergens anders aangeroepen in
// de pijplijn, dus onenigheid met de dedup die al inline in monthly-structured.ts zit is een
// echt signaal en geen ruis.
function contradictionGate(input: GateInput): QualityGateResult {
  if (!input.contradiction) {
    return ontbrekendeInvoer("Contradiction Gate", "geen ThreadRecommendation[]/ThreadTask[] meegegeven");
  }
  if (input.contradiction.recommendations.length === 0) {
    return ontbrekendeInvoer("Contradiction Gate", "geen aanbevelingen om tegen elkaar te houden");
  }
  const opgelost = resolveContradictions(input.contradiction.recommendations, input.contradiction.tasks);
  const samengevoegd = input.contradiction.recommendations.length - opgelost.recommendations.length;
  if (samengevoegd === 0) return resultaat("Contradiction Gate", "pass", "geen tegenstrijdige aanbevelingen gevonden");
  return resultaat("Contradiction Gate", "warn", `${samengevoegd} aanbeveling(en) zou resolveContradictions samenvoegen wegens een conflict op dezelfde entiteit`);
}

// 6. Step Purity Gate — narratief, log-format en step-purity van de stapoutputs.
function stepPurityGate(input: GateInput): QualityGateResult {
  if (input.stepValidationsReport) {
    const validaties = input.stepValidationsReport;
    if (validaties.length === 0) return resultaat("Step Purity Gate", "warn", "de opgeslagen run bevat geen stapvalidaties");
    const ongeldig = validaties.filter((v) => !v.valid).map((v) => v.stepNumber);
    const waarschuwingen = validaties.flatMap((v) => v.warnings);
    if (ongeldig.length > 0) {
      const fouten = validaties.filter((v) => !v.valid).flatMap((v) => v.errors);
      return resultaat("Step Purity Gate", "fail", `${ongeldig.length} ongeldige stap(pen) (${ongeldig.join(", ")}): ${fouten.slice(0, 2).join(" | ")}`);
    }
    if (waarschuwingen.length > 0) return resultaat("Step Purity Gate", "warn", `${waarschuwingen.length} waarschuwing(en) over ${validaties.length} stappen`);
    return resultaat("Step Purity Gate", "pass", `${validaties.length} stappen zonder waarschuwing`);
  }
  if (!input.stepPurity) {
    return ontbrekendeInvoer("Step Purity Gate", "geen stepValidationsReport (opgeslagen run) of stepPurity (ruwe StepOutput) meegegeven");
  }
  const { stepNumber, output, priorStepConclusion } = input.stepPurity;
  const validatie = validateStepOutput(stepNumber, output, priorStepConclusion);
  if (validatie.errors.length > 0) return resultaat("Step Purity Gate", "fail", validatie.errors.join(" | "));
  if (validatie.warnings.length > 0) return resultaat("Step Purity Gate", "warn", validatie.warnings.join(" | "));
  return resultaat("Step Purity Gate", "pass", `stap ${stepNumber} zonder waarschuwingen`);
}

// 7. Coverage Gate — welke SOP-dimensies zijn behandeld tegenover wat beschikbaar was.
function coverageGate(input: GateInput): QualityGateResult {
  if (input.coverageReport) {
    const rijen = input.coverageReport;
    if (rijen.length === 0) return ontbrekendeInvoer("Coverage Gate", "de opgeslagen run bevat geen dekkingsrapport");
    const ontbrekend = rijen.filter((r) => r.status === "no_signal" && r.data_available);
    const gedekt = rijen.filter((r) => r.status === "covered");
    if (ontbrekend.length > 0) {
      return resultaat("Coverage Gate", "warn", `beschikbare dimensies zonder signaal: ${ontbrekend.map((r) => r.dimension).join(", ")}`);
    }
    return resultaat("Coverage Gate", "pass", `${gedekt.length} dimensie(s) gedekt (uit de opgeslagen run)`);
  }
  if (!input.coverage) {
    return ontbrekendeInvoer("Coverage Gate", "geen coverageReport (opgeslagen run) of coverage (ruwe IssueCluster[]) meegegeven");
  }
  const uitkomst = enforceSopCoverage(input.coverage.clusters, input.coverage.dimensionAvailability);
  if (!uitkomst.traceabilityOk) return resultaat("Coverage Gate", "fail", "een gedekte dimensie verwijst naar een cluster dat niet bestaat");
  if (uitkomst.missingAvailableDimensions.length > 0) {
    return resultaat("Coverage Gate", "warn", `beschikbare dimensies zonder signaal: ${uitkomst.missingAvailableDimensions.join(", ")}`);
  }
  return resultaat("Coverage Gate", "pass", `${uitkomst.surfacedDimensions.length} dimensie(s) gedekt`);
}

// 8. Sprint Readiness Gate — mag een aanbeveling als direct_action de deur uit. Draait, net als
// de Contradiction Gate, voor het eerst als expliciete controle: applyActionGating wordt
// nergens in de pijplijn zelf aangeroepen.
function sprintReadinessGate(input: GateInput): QualityGateResult {
  if (!input.actionGating) {
    return ontbrekendeInvoer("Sprint Readiness Gate", "geen NormalizedFinding[]/ThreadRecommendation[] meegegeven");
  }
  if (input.actionGating.recommendations.length === 0) {
    return ontbrekendeInvoer("Sprint Readiness Gate", "geen aanbevelingen om te toetsen");
  }
  const voor = input.actionGating.recommendations.filter((r) => (r as Record<string, unknown>).action_readiness === "direct_action").length;
  const na = applyActionGating(input.actionGating.findings, input.actionGating.recommendations)
    .filter((r) => (r as Record<string, unknown>).action_readiness === "direct_action").length;
  if (na === voor) return resultaat("Sprint Readiness Gate", "pass", `${na} aanbeveling(en) blijven direct_action`);
  return resultaat("Sprint Readiness Gate", "warn", `${voor - na} aanbeveling(en) zou applyActionGating afwaarderen van direct_action`);
}

// 9. Publish Gate — mag de maandrun naar structured save/export.
function publishGate(input: GateInput): QualityGateResult {
  if (input.publishReport) {
    const r = input.publishReport;
    if (r.passed) return resultaat("Publish Gate", "pass", "alle acceptatiecriteria gehaald (uit de opgeslagen run)");
    return resultaat("Publish Gate", r.state === "blocked_invalid_steps" ? "fail" : "warn", r.blockingReasons.join(" | "));
  }
  if (!input.monthlyAcceptance) {
    return ontbrekendeInvoer("Publish Gate", "geen publishReport (opgeslagen run) of monthlyAcceptance (ruwe opts) meegegeven");
  }
  const acceptance = validateMonthlyAcceptance(input.monthlyAcceptance);
  const rapport = buildMonthlyQualityGate({ stepValidations: input.monthlyAcceptance.stepValidations ?? [], acceptance });
  if (rapport.passed) return resultaat("Publish Gate", "pass", "alle acceptatiecriteria gehaald");
  return resultaat("Publish Gate", rapport.state === "blocked_invalid_steps" ? "fail" : "warn", rapport.blocking_reasons.join(" | "));
}

/**
 * Het rank-verlies van de laatste maand, gewogen naar impressies per campagne. Het ongewogen
 * gemiddelde (dat monthly/route.ts en het admin-scherm elk apart uitrekenden) liet een campagne
 * met 40 impressies even zwaar tellen als een met 40.000 -- precies de ongewogen wiskunde die
 * de sloop-audit overal wegwerkte. Zonder impressies valt hij terug op het gewone gemiddelde,
 * en zonder rijen op null: "geen data" is geen 0% rankverlies.
 */
export function gewogenRankLostIs(rijen: ReadonlyArray<Record<string, unknown>>): number | null {
  if (rijen.length === 0) return null;
  const metGewicht = rijen.map((r) => ({ verlies: Number(r.search_rank_lost_is ?? 0), gewicht: Number(r.impressions ?? 0) }));
  const totaalGewicht = metGewicht.reduce((som, r) => som + (r.gewicht > 0 ? r.gewicht : 0), 0);
  if (totaalGewicht > 0) {
    return metGewicht.reduce((som, r) => som + r.verlies * Math.max(r.gewicht, 0), 0) / totaalGewicht;
  }
  return metGewicht.reduce((som, r) => som + r.verlies, 0) / metGewicht.length;
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
