// Decision Brief (masterplan 17.21): een compacte, deterministische export naast het bestaande
// volledige SOP-rapport (sop-pdf-renderer.ts) -- geen vervanging.
//
// ── WAAROM GEEN NIEUWE LLM-CALL, GEEN NIEUWE SYSTEEMPROMPT ──────────────────────────────────
//
// Elk veld dat dit document nodig heeft (primary_thread, root_cause, what_is_not_the_problem, de
// containment/validation/recovery/controlled-scale-indeling van recommendations, en de
// accept_if/reject_if/evaluation_window van de eerste hypothese) staat al structureel in
// FinalSopSynthesis en OperatingDetailLayer -- de output die de bestaande pijplijn toch al
// produceert en opslaat. Dit bestand is dus een pure RENDER-transformatie, geen analysestap. Dat
// is bewust: een tweede LLM-call zou kosten en een tweede faalpunt toevoegen voor iets dat al
// als gestructureerde data bestaat, en zou de rijke, herleidbare output (evidence traces,
// hypotheses-met-succescriteria -- de basis van de leerlus, masterplan §3.3/§4) alleen behouden
// als iemand dat apart blijft opslaan. Deze module haalt uit wat er al is; ze verwijdert niets.
//
// ── WOORDLIMIET IS EEN ECHTE, AFGEDWONGEN GRENS ─────────────────────────────────────────────
//
// "Max 120 woorden per sub-account" is geen richtlijn die het brondata toevallig haalt -- de
// brontekst (final_sop) is voor menselijke specialisten geschreven en kan makkelijk 300+ woorden
// per veld bevatten. Elk veld krijgt daarom een eigen, opgetelde limiet (som = 120) en wordt op
// woordgrens afgekapt met "...", nooit halverwege een woord. __decision_brief_test.ts bewijst dit
// met opzettelijk lange brontekst, niet met toevallig korte testfixtures.

import type { FinalSopSynthesis, OperatingDetailLayer, FinalSopRoute } from "./monthly-structured";
import type { PortfolioSynthesisResult } from "./portfolio-synthesis";

// ── Woordbudget per veld, som = 120 (zie toelichting hierboven) ─────────────────────────────
const WORD_BUDGET = {
  primaryThread: 14,
  rootCause: 20,
  whatIsNotTheProblem: 14,
  containment: 16,
  validationRecovery: 16,
  controlledScale: 14,
  evaluationWindow: 4,
  acceptIf: 12,
  rejectIf: 10,
} as const;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
}

export type Priority = "Hoog" | "Midden" | "Laag";

/** Afgeleid uit qa_self_check (why-score + actionability-score, allebei al berekend door de
 *  bestaande pijplijn) -- geen nieuwe scoring, alleen een drempel op wat er al staat. */
function priorityFromQaSelfCheck(finalSop: FinalSopSynthesis): Priority {
  const avg = (finalSop.qa_self_check.why_score_estimate + finalSop.qa_self_check.actionability_score_estimate) / 2;
  if (avg >= 8) return "Hoog";
  if (avg >= 5) return "Midden";
  return "Laag";
}

const PHASE_LABEL: Record<FinalSopRoute, string> = {
  validation: "Validatie",
  containment: "Beperking (rem)",
  recovery: "Herstel",
  "controlled scale": "Gecontroleerde schaal",
};

/** De route van de eerste (dus meest urgente) aanbeveling bepaalt de fase-label -- `route` is het
 *  dichtstbijzijnde structurele veld dat al bestaat voor "in welke fase zit dit account". */
function phaseFromRecommendations(finalSop: FinalSopSynthesis): string {
  const first = finalSop.recommendations[0];
  return first ? PHASE_LABEL[first.route] : "Onbekend";
}

function findByRoute(finalSop: FinalSopSynthesis, route: FinalSopRoute): string | null {
  const rec = finalSop.recommendations.find((r) => r.route === route);
  return rec ? rec.handeling : null;
}

export interface MacroMatrixRow {
  accountName: string;
  primaryBlockage: string;
  phase: string;
  coreAction: string;
  priority: Priority;
}

export interface PortfolioSyntheseSection {
  sharedBlockage: string | null;
  exception: string | null;
  portfolioWarning: string | null;
}

export interface ClientSprintActions {
  containment: string | null;
  validationRecovery: string | null;
  controlledScale: string | null;
}

export interface ClientDecisionRule {
  evaluationWindow: string;
  acceptIf: string;
  rejectIf: string;
}

export interface ClientActionPlan {
  accountName: string;
  primaryThread: string;
  rootCause: string;
  whatIsNotTheProblem: string;
  sprintActions: ClientSprintActions;
  decisionRule: ClientDecisionRule | null;
}

export interface DecisionBrief {
  generatedAt: string;
  macroMatrix: MacroMatrixRow[];
  portfolioSynthese: PortfolioSyntheseSection | null;
  clientActionPlans: ClientActionPlan[];
}

export interface ClientBriefInput {
  accountName: string;
  finalSop: FinalSopSynthesis;
  operatingDetail?: OperatingDetailLayer | null;
}

function buildMacroRow(input: ClientBriefInput): MacroMatrixRow {
  const { accountName, finalSop } = input;
  return {
    accountName,
    primaryBlockage: truncateWords(finalSop.primary_thread, WORD_BUDGET.primaryThread),
    phase: phaseFromRecommendations(finalSop),
    coreAction: truncateWords(
      finalSop.recommendations[0]?.handeling ?? "Geen aanbeveling beschikbaar.",
      WORD_BUDGET.containment
    ),
    priority: priorityFromQaSelfCheck(finalSop),
  };
}

/** Niet elk account heeft alle drie de routes (validation/containment/recovery/controlled
 *  scale) -- een account zonder meetprobleem heeft bijvoorbeeld geen "validation"-aanbeveling, en
 *  een account dat nog niet mag schalen heeft eerlijk geen "controlled scale". Ontbrekend blijft
 *  ontbrekend (null), niet verzonnen -- zie __decision_brief_test.ts voor het GRA/GRN-scenario
 *  (masterplan 17.20) waar "controlled scale" bewust nooit voorkomt zolang meting kapot is. */
function buildSprintActions(finalSop: FinalSopSynthesis): ClientSprintActions {
  const containment = findByRoute(finalSop, "containment");
  // "Validation/Recovery" is één slot in het beslisdocument-format maar twee routes in de brondata
  // -- validation weegt zwaarder (het blokkeert alles erna), dus die krijgt voorrang als beide
  // bestaan; anders recovery.
  const validationRecovery = findByRoute(finalSop, "validation") ?? findByRoute(finalSop, "recovery");
  const controlledScale = findByRoute(finalSop, "controlled scale");
  return {
    containment: containment ? truncateWords(containment, WORD_BUDGET.containment) : null,
    validationRecovery: validationRecovery ? truncateWords(validationRecovery, WORD_BUDGET.validationRecovery) : null,
    controlledScale: controlledScale ? truncateWords(controlledScale, WORD_BUDGET.controlledScale) : null,
  };
}

/** De eerste hypothese (operating_detail.hypotheses_and_next_month_proof[0]) draagt al
 *  evaluation_window/accept_if/reject_if -- exact de weddenschap die het beslisdocument vraagt.
 *  Null als operatingDetail ontbreekt of leeg is (bewust geen verzonnen beslisregel). */
function buildDecisionRule(operatingDetail: OperatingDetailLayer | null | undefined): ClientDecisionRule | null {
  const first = operatingDetail?.hypotheses_and_next_month_proof?.[0];
  if (!first) return null;
  return {
    evaluationWindow: truncateWords(first.evaluation_window, WORD_BUDGET.evaluationWindow),
    acceptIf: truncateWords(first.accept_if, WORD_BUDGET.acceptIf),
    rejectIf: truncateWords(first.reject_if, WORD_BUDGET.rejectIf),
  };
}

function buildClientActionPlan(input: ClientBriefInput): ClientActionPlan {
  const { accountName, finalSop, operatingDetail } = input;
  return {
    accountName,
    primaryThread: truncateWords(finalSop.primary_thread, WORD_BUDGET.primaryThread),
    rootCause: truncateWords(finalSop.root_cause, WORD_BUDGET.rootCause),
    whatIsNotTheProblem: truncateWords(
      finalSop.what_is_not_the_problem[0] ?? "Geen secundair signaal genoteerd.",
      WORD_BUDGET.whatIsNotTheProblem
    ),
    sprintActions: buildSprintActions(finalSop),
    decisionRule: buildDecisionRule(operatingDetail),
  };
}

/** Portfolio-synthese is optioneel: bij een los account (geen cross-account-synthese gedraaid)
 *  blijft Deel 1's portfolio-sectie leeg in plaats van verzonnen. */
function buildPortfolioSynthese(portfolio: PortfolioSynthesisResult | null | undefined): PortfolioSyntheseSection | null {
  if (!portfolio) return null;
  const sharedPattern = portfolio.recurring_patterns[0] ?? null;
  const exception = portfolio.outliers[0] ?? null;
  // Geen apart "verboden actie"-veld in PortfolioSynthesisResult; de narrative/eerste
  // portfolio-brede actie is de dichtstbijzijnde bestaande bron voor een waarschuwing --
  // afgeleid, niet verzonnen.
  const portfolioAction = portfolio.synthesized_actions.find((a) => a.clientId === "portfolio");
  return {
    sharedBlockage: sharedPattern,
    exception,
    portfolioWarning: portfolioAction?.action ?? null,
  };
}

export function buildDecisionBrief(
  clients: readonly ClientBriefInput[],
  portfolio?: PortfolioSynthesisResult | null,
  generatedAt: string = new Date().toISOString().slice(0, 10)
): DecisionBrief {
  return {
    generatedAt,
    macroMatrix: clients.map(buildMacroRow),
    portfolioSynthese: buildPortfolioSynthese(portfolio),
    clientActionPlans: clients.map(buildClientActionPlan),
  };
}

// ── Markdown-rendering ───────────────────────────────────────────────────────────────────────

/** Campagnenamen als "GRT | Search | NL" bevatten letterlijke pipe-tekens, die in een
 *  Markdown-tabelcel de kolomscheiding zouden breken (elke extra "|" wordt een nieuwe kolom).
 *  Ontdekt bij het eerste keer echt renderen van een Macro Matrix met een campagnenaam erin --
 *  precies waarom dit tegen echte content getest moet worden, niet tegen namen zonder pipe. */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function renderMacroMatrix(rows: readonly MacroMatrixRow[]): string {
  const header = "| Account / Regio | Primaire Blokkade | Fase | Directe Kernactie | Prioriteit |";
  const sep = "|---|---|---|---|---|";
  const body = rows.map(
    (r) =>
      `| ${escapeTableCell(r.accountName)} | ${escapeTableCell(r.primaryBlockage)} | ${escapeTableCell(r.phase)} | ${escapeTableCell(r.coreAction)} | ${r.priority} |`
  );
  return [header, sep, ...body].join("\n");
}

function renderPortfolioSynthese(section: PortfolioSyntheseSection | null): string {
  if (!section) return "*Geen cross-account-synthese beschikbaar voor deze accounts.*";
  const lines: string[] = [];
  if (section.sharedBlockage) lines.push(`- **Gedeelde Blokkade:** ${section.sharedBlockage}`);
  if (section.exception) lines.push(`- **Uitzondering:** ${section.exception}`);
  if (section.portfolioWarning) lines.push(`- **Portfolio Waarschuwing:** ${section.portfolioWarning}`);
  return lines.length > 0 ? lines.join("\n") : "*Geen cross-account-patronen gevonden.*";
}

function renderSprintActions(actions: ClientSprintActions): string {
  const lines = [
    `- **Containment / Rem:** ${actions.containment ?? "Niet van toepassing -- geen containment-route in deze analyse."}`,
    `- **Validation / Recovery:** ${actions.validationRecovery ?? "Niet van toepassing -- geen validatie- of herstelroute in deze analyse."}`,
    `- **Controlled Scale:** ${actions.controlledScale ?? "Niet gedefinieerd -- schalen is pas aan de orde nadat de voorgaande routes zijn afgerond."}`,
  ];
  return lines.join("\n");
}

function renderDecisionRule(rule: ClientDecisionRule | null): string {
  if (!rule) return "*Geen beslisregel beschikbaar (geen hypothese met succescriteria in deze analyse).*";
  return [
    `- **Evaluatievenster:** ${rule.evaluationWindow}`,
    `- **Accept if:** ${rule.acceptIf}`,
    `- **Reject / Rollback if:** ${rule.rejectIf}`,
  ].join("\n");
}

function renderClientActionPlan(plan: ClientActionPlan): string {
  return [
    `### ${plan.accountName}`,
    "",
    "**1. Diagnose**",
    `- **Primary Thread:** ${plan.primaryThread}`,
    `- **Root Cause:** ${plan.rootCause}`,
    `- **What is NOT the problem:** ${plan.whatIsNotTheProblem}`,
    "",
    "**2. Sprint-Acties**",
    renderSprintActions(plan.sprintActions),
    "",
    "**3. Beslisregel & Falsificatie**",
    renderDecisionRule(plan.decisionRule),
  ].join("\n");
}

export function renderDecisionBriefMarkdown(brief: DecisionBrief): string {
  return [
    "# Decision Brief",
    `*Gegenereerd ${brief.generatedAt}*`,
    "",
    "## DEEL 1: PORTFOLIO EXECUTIVE BRIEFING",
    "",
    "**Macro Matrix**",
    "",
    renderMacroMatrix(brief.macroMatrix),
    "",
    "**Portfolio Synthese**",
    "",
    renderPortfolioSynthese(brief.portfolioSynthese),
    "",
    "---",
    "",
    "## DEEL 2: KLANT-ACTIEPLAN",
    "",
    brief.clientActionPlans.map(renderClientActionPlan).join("\n\n---\n\n"),
  ].join("\n");
}

/** Telt alleen de inhoudsvelden van Deel 2 mee (niet de kopjes/labels) -- exact de "max 120
 *  woorden per sub-account"-eis. Geëxporteerd zodat de test en een eventuele lint-stap dezelfde
 *  telling gebruiken als de renderer zelf. */
export function wordCountForClientPlan(plan: ClientActionPlan): number {
  const parts = [
    plan.primaryThread,
    plan.rootCause,
    plan.whatIsNotTheProblem,
    plan.sprintActions.containment,
    plan.sprintActions.validationRecovery,
    plan.sprintActions.controlledScale,
    plan.decisionRule?.evaluationWindow,
    plan.decisionRule?.acceptIf,
    plan.decisionRule?.rejectIf,
  ].filter((v): v is string => typeof v === "string");
  return parts.reduce((sum, text) => sum + countWords(text), 0);
}
