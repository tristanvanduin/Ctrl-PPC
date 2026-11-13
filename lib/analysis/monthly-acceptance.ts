import type { StepResult } from "@/lib/analysis/helpers";
import type { ThreadRecommendation, ThreadTask, FinalSopRecommendation, FinalSopTask } from "@/lib/analysis/monthly-structured";
import { hasDoubleConditional, normalizeText } from "@/lib/analysis/monthly-structured";
import type { SopCoverage } from "@/lib/analysis/canonicalize";
import type { AcceptanceCriterionResult, AcceptanceReport } from "@/lib/schema/monthly-pipeline-schema";
import type { StepValidationResult } from "@/lib/analysis/step-validator";

const FORBIDDEN_WORDS = ["consolideer", "optimaliseer", "onderzoek", "analyseer"];

function hasForbiddenWord(text: string): boolean {
  const normalized = text.toLowerCase();
  return FORBIDDEN_WORDS.some((word) => normalized.includes(word));
}

function dedupKey(entity: string, metric: string): string {
  return `${entity.toLowerCase()}::${metric.toLowerCase()}`;
}

/** Het model-label waarmee een stap zonder data wordt weggeschreven (geen modelaanroep). */
export const GEEN_DATA_MODEL = "runtime-fallback";

/** De stappen die zonder data zijn "uitgevoerd": weggeschreven zonder modelaanroep. */
export function stappenZonderData(narrativeSteps: StepResult[]): StepResult[] {
  return narrativeSteps.filter((step) => step.model === GEEN_DATA_MODEL);
}

/**
 * De dekkingsregel bovenaan de maandanalyse: op hoeveel stappen de conclusie rust en welke niet
 * bekeken zijn. Null als elke stap data had. Op 19 augustus hadden demo-grt, demo-gra en demo-grn
 * elk 5 van 12 stappen zonder data, en de eindtekst noemde een hoofdoorzaak met een why-score van
 * 9,2 zonder te zeggen dat bijna de helft van de dimensies niet bekeken was.
 */
export function dekkingsRegel(narrativeSteps: StepResult[]): string | null {
  const leeg = stappenZonderData(narrativeSteps);
  if (leeg.length === 0) return null;
  const metData = narrativeSteps.length - leeg.length;
  return `> **Dekking:** gebaseerd op ${metData} van de ${narrativeSteps.length} stappen met data. Niet bekeken, want geen data: ${leeg.map((s) => s.stepName).join(", ")}. Een oorzaak in die dimensies is met deze analyse niet uitgesloten.`;
}

export function validateMonthlyAcceptance(opts: {
  narrativeSteps: StepResult[];
  recommendations: ThreadRecommendation[];
  tasks: ThreadTask[];
  coverage: SopCoverage[];
  findings: Array<{ canonical_entity_name: string; canonical_metric: string }>;
  checkpointsRun: number;
  stepValidations?: StepValidationResult[];
  finalSop?: { recommendations: FinalSopRecommendation[]; tasks: FinalSopTask[] };
  stepCount?: number;
  // F4 fase2: expliciete stapnummer-set voor adapters waar die geen aaneengesloten 1..stepCount
  // reeks meer is (zie ChannelAdapter.expectedStepNumbers). Ontbreekt dit, dan blijft het gedrag
  // exact de oude aaneengesloten 1..stepCount-check.
  expectedStepNumbers?: number[];
  // F4 fase2: verwacht aantal checkpoints (default 3 = A/B/C, ongewijzigd gedrag). Google
  // draait na het bundelen van stap 1-3 nog maar 2 checkpoints (B, C) -- Checkpoint A's
  // consolidatiewerk zit nu in stap 1 zelf.
  expectedCheckpointCount?: number;
  /**
   * De eindtekst zoals de lezer hem krijgt. AC-19 eist dat elke stap zonder data daarin bij naam
   * genoemd wordt. Ontbreekt dit veld terwijl er lege stappen zijn, dan faalt AC-19: zwijgen over
   * ontbrekende dekking is precies wat de poort moet tegenhouden.
   */
  deliverableMarkdown?: string;
}): AcceptanceReport {
  const { narrativeSteps, recommendations, tasks, coverage, findings, checkpointsRun, stepValidations = [], finalSop, stepCount = 13, expectedStepNumbers, expectedCheckpointCount = 3, deliverableMarkdown } = opts;
  const criteria: AcceptanceCriterionResult[] = [];

  // AC-01 hieronder telt een stap zonder data als uitgevoerd. Dat mag, maar alleen als de
  // uitvoer het zegt: anders leest een conclusie op 7 van 12 dimensies als een volledige analyse.
  const leeg = stappenZonderData(narrativeSteps);
  const nietGenoemd = leeg.filter((s) => !(deliverableMarkdown ?? "").includes(s.stepName));
  criteria.push({
    id: "AC-19",
    label: "Stappen zonder data staan in de uitvoer benoemd",
    passed: nietGenoemd.length === 0,
    detail: leeg.length === 0
      ? "Alle stappen hadden data."
      : nietGenoemd.length === 0
        ? `${leeg.length} stap(pen) zonder data, alle benoemd: ${leeg.map((s) => s.stepName).join(", ")}.`
        : `${nietGenoemd.length} stap(pen) zonder data niet benoemd in de uitvoer: ${nietGenoemd.map((s) => s.stepName).join(", ")}.`,
  });

  const stepNumberSet = expectedStepNumbers ?? Array.from({ length: stepCount }, (_, i) => i + 1);
  const deepDiveSteps = narrativeSteps.filter((step) => stepNumberSet.includes(step.stepNumber));
  criteria.push({
    id: "AC-01",
    label: `Alle ${stepNumberSet.length} SOP-stappen aanwezig`,
    passed: deepDiveSteps.length === stepNumberSet.length,
    detail: `${deepDiveSteps.length}/${stepNumberSet.length} stappen uitgevoerd`,
  });

  criteria.push({
    id: "AC-03",
    label: "Max 30 unieke bevindingen",
    passed: findings.length <= 30,
    detail: `${findings.length} unieke bevindingen`,
  });

  const findingKeys = new Set<string>();
  let duplicateFindings = 0;
  for (const finding of findings) {
    const key = dedupKey(finding.canonical_entity_name, finding.canonical_metric);
    if (findingKeys.has(key)) duplicateFindings += 1;
    findingKeys.add(key);
  }
  criteria.push({
    id: "AC-14",
    label: "Geen duplicate entiteit+metric bevindingen",
    passed: duplicateFindings === 0,
    detail: duplicateFindings === 0 ? "0 duplicaten" : `${duplicateFindings} duplicaten gevonden`,
  });

  criteria.push({
    id: "AC-04",
    label: "Max 15 taken, geen duplicaten",
    passed: tasks.length <= 15,
    detail: `${tasks.length} taken`,
  });

  criteria.push({
    id: "AC-05",
    label: "Max 10 aanbevelingen, concreet",
    passed: recommendations.length <= 10 && recommendations.every((recommendation) => !hasForbiddenWord(recommendation.hypothesis)),
    detail: `${recommendations.length} aanbevelingen`,
  });

  criteria.push({
    id: "AC-11",
    label: `${expectedCheckpointCount} checkpoints uitgevoerd`,
    passed: checkpointsRun === expectedCheckpointCount,
    detail: `${checkpointsRun}/${expectedCheckpointCount} checkpoints`,
  });

  criteria.push({
    id: "AC-10",
    label: "3-lagen structuur aanwezig",
    passed: coverage.length > 0,
    detail: "Executive, bevindingen/acties en deep-dive worden opgebouwd in de route-output",
  });

  const officialStepValidations = stepValidations.filter((validation) => validation.stepNumber >= 1 && validation.stepNumber <= 13);
  const invalidOfficialSteps = officialStepValidations
    .filter((validation) => !validation.valid)
    .map((validation) => validation.stepNumber);
  criteria.push({
    id: "AC-15",
    label: "Geen invalid step-outputs in de finale 13 stappen",
    passed: invalidOfficialSteps.length === 0,
    detail: invalidOfficialSteps.length === 0
      ? `${officialStepValidations.length || 0} finale stapvalidaties akkoord`
      : `Invalid steps: ${invalidOfficialSteps.join(", ")}`,
  });

  const finalRecommendations = finalSop?.recommendations ?? [];
  const finalTasks = finalSop?.tasks ?? [];
  const normalizedHandelingen = finalRecommendations.map((recommendation) => normalizeText(recommendation.handeling));
  const duplicateHandelingen = normalizedHandelingen.length - new Set(normalizedHandelingen).size;
  criteria.push({
    id: "AC-16",
    label: "Geen twee finale aanbevelingen met dezelfde handeling",
    passed: duplicateHandelingen === 0,
    detail: duplicateHandelingen === 0
      ? "Alle finale aanbevelingen hebben een unieke handeling."
      : `${duplicateHandelingen} duplicaat-handeling(en) in de finale aanbevelingen.`,
  });

  const doubleConditionalCount =
    finalRecommendations.filter((recommendation) => hasDoubleConditional(recommendation.beslisregel)).length +
    finalTasks.filter((task) => hasDoubleConditional(task.beslisregel)).length;
  criteria.push({
    id: "AC-17",
    label: "Geen beslisregel met dubbele conditie",
    passed: doubleConditionalCount === 0,
    detail: doubleConditionalCount === 0
      ? "Geen dubbelconditie-beslisregels."
      : `${doubleConditionalCount} beslisregel(s) met een dubbele conditie.`,
  });

  const officialValidations = stepValidations.filter((validation) => validation.stepNumber >= 1 && validation.stepNumber <= 13);
  const stepsWithoutAC08 = officialValidations.filter((validation) => !validation.warnings.some((warning) => warning.startsWith("AC-08"))).length;
  const ac08Pct = officialValidations.length > 0 ? Math.round((stepsWithoutAC08 / officialValidations.length) * 100) : 100;
  criteria.push({
    id: "AC-18",
    label: "Aandeel stappen dat het SOP-logformat volgt (rapporterend)",
    passed: true,
    detail: `${ac08Pct}% van de stappen zonder AC-08-logformat-waarschuwing (${stepsWithoutAC08}/${officialValidations.length}).`,
  });

  const passed = criteria.every((criterion) => criterion.passed);
  return { passed, criteria };
}

export interface MonthlyQualityGateReport {
  passed: boolean;
  state: "passed" | "blocked_invalid_steps" | "blocked_acceptance";
  invalid_steps: number[];
  blocking_reasons: string[];
}

export function buildMonthlyQualityGate(opts: {
  stepValidations: StepValidationResult[];
  acceptance: AcceptanceReport;
}): MonthlyQualityGateReport {
  const officialStepValidations = opts.stepValidations.filter((validation) => validation.stepNumber >= 1 && validation.stepNumber <= 13);
  const invalidSteps = Array.from(new Set(
    officialStepValidations
      .filter((validation) => !validation.valid)
      .map((validation) => validation.stepNumber)
  )).sort((a, b) => a - b);

  if (invalidSteps.length > 0) {
    return {
      passed: false,
      state: "blocked_invalid_steps",
      invalid_steps: invalidSteps,
      blocking_reasons: invalidSteps.map((stepNumber) => `Step ${stepNumber} is invalid en mag niet door naar structured save/export.`),
    };
  }

  if (!opts.acceptance.passed) {
    const failedCriteria = opts.acceptance.criteria
      .filter((criterion) => !criterion.passed)
      .map((criterion) => `${criterion.id}: ${criterion.label} (${criterion.detail})`);
    return {
      passed: false,
      state: "blocked_acceptance",
      invalid_steps: [],
      blocking_reasons: failedCriteria.length > 0
        ? failedCriteria
        : ["Acceptance faalde zonder expliciete criteria-detail."],
    };
  }

  return {
    passed: true,
    state: "passed",
    invalid_steps: [],
    blocking_reasons: [],
  };
}
