// Decision Brief (masterplan 17.21, opgesplitst in 17.22): twee strikt gescheiden documenten,
// geen vervanging van het volledige SOP-rapport en geen nieuwe LLM-call.
//
// ── WAAROM GEEN NIEUWE LLM-CALL, GEEN NIEUWE SYSTEEMPROMPT ──────────────────────────────────
//
// Elk veld dat deze documenten nodig hebben (primary_thread, root_cause, what_is_not_the_problem,
// de containment/validation/recovery/controlled-scale-indeling van recommendations, en de
// accept_if/reject_if/evaluation_window van de eerste hypothese) staat al structureel in
// FinalSopSynthesis en OperatingDetailLayer -- de output die de bestaande pijplijn toch al
// produceert en opslaat. Dit bestand is dus een pure RENDER-transformatie, geen analysestap.
//
// ── WAAROM TWEE FUNCTIES EN TWEE TYPES, NIET ÉÉN GEDEELD DOCUMENT ───────────────────────────
//
// Het klantdocument (Document 1) is naslagwerk VOOR DE SPECIALIST, binnen het bureau -- het gaat
// niet ongefilterd naar de eindklant. De eindklant krijgt zijn eigen, al bestaande
// maandrapportage (dezelfde week, soms dezelfde dag), die al 100% klantgericht is; een los
// klantexportformaat zou grotendeels dubbelop zijn en is bewust niet gebouwd. Mocht een bureau
// ooit willen "pronken" met een analyse naar een klant toe, is dat een apart, later te bouwen
// stuk werk met eigen eisen (taal zonder interne decision-engine-termen als "Primary Thread" of
// "Containment", net als de standaardregel voor de website: nooit de echte werking, alleen
// impact en voordelen) -- niet dit document.
//
// Twee losse types (ClientDecisionBrief, AgencyPortfolioBrief) blijft desondanks de juiste keus:
// Document 1 gaat over ÉÉN account, Document 2 toont het hele bureau naast elkaar. Een gedeeld
// type zou die twee vormen onnodig aan elkaar knopen.
//
// ── GEEN ANONIMISERING NODIG -- BLIJFT BINNEN ÉÉN BUREAU ────────────────────────────────────
//
// Cross-account-analyse BINNEN één bureau hoeft niet anoniem (zelfde besluit als
// portfolio-synthesis.ts zelf al vastlegt): het bureau heeft al volledige inzage in elk van zijn
// eigen klanten. Alleen God View en eventuele toekomstige cross-BUREAU-features (die data van
// MEERDERE bureaus combineren) hebben k-anonimiteit nodig. Beide Decision Brief-documenten blijven
// intern bij één bureau, dus tonen ze portfolio-patronen en klantnamen gewoon, onveranderd.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinalSopSynthesis, OperatingDetailLayer, FinalSopRoute } from "./monthly-structured";
import type { PortfolioSynthesisResult } from "./portfolio-synthesis";
import { lijstAccountsMetSops } from "@/lib/tenancy/sop-dekking";

// ── Woordbudget per veld (klantdocument moet op 1 A4 passen) ────────────────────────────────
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

function phaseFromRecommendations(finalSop: FinalSopSynthesis): string {
  const first = finalSop.recommendations[0];
  return first ? PHASE_LABEL[first.route] : "Onbekend";
}

function findByRoute(finalSop: FinalSopSynthesis, route: FinalSopRoute): string | null {
  const rec = finalSop.recommendations.find((r) => r.route === route);
  return rec ? rec.handeling : null;
}

export interface ClientSprintActions {
  containment: string | null;
  validationRecovery: string | null;
  controlledScale: string | null;
}

/** Niet elk account heeft alle drie de routes -- een account zonder meetprobleem heeft
 *  bijvoorbeeld geen "validation"-aanbeveling, en een account dat nog niet mag schalen heeft
 *  eerlijk geen "controlled scale". Ontbrekend blijft ontbrekend (null), niet verzonnen. */
function buildSprintActions(finalSop: FinalSopSynthesis): ClientSprintActions {
  const containment = findByRoute(finalSop, "containment");
  const validationRecovery = findByRoute(finalSop, "validation") ?? findByRoute(finalSop, "recovery");
  const controlledScale = findByRoute(finalSop, "controlled scale");
  return {
    containment: containment ? truncateWords(containment, WORD_BUDGET.containment) : null,
    validationRecovery: validationRecovery ? truncateWords(validationRecovery, WORD_BUDGET.validationRecovery) : null,
    controlledScale: controlledScale ? truncateWords(controlledScale, WORD_BUDGET.controlledScale) : null,
  };
}

export interface ClientDecisionRule {
  evaluationWindow: string;
  acceptIf: string;
  rejectIf: string;
}

function buildDecisionRule(operatingDetail: OperatingDetailLayer | null | undefined): ClientDecisionRule | null {
  const first = operatingDetail?.hypotheses_and_next_month_proof?.[0];
  if (!first) return null;
  return {
    evaluationWindow: truncateWords(first.evaluation_window, WORD_BUDGET.evaluationWindow),
    acceptIf: truncateWords(first.accept_if, WORD_BUDGET.acceptIf),
    rejectIf: truncateWords(first.reject_if, WORD_BUDGET.rejectIf),
  };
}

// ── DOCUMENT 1: Client Decision Brief ───────────────────────────────────────────────────────

export interface ClientDecisionBrief {
  clientName: string;
  period: string;
  phase: string;
  priority: Priority;
  primaryThread: string;
  rootCause: string;
  whatIsNotTheProblem: string;
  sprintActions: ClientSprintActions;
  decisionRule: ClientDecisionRule | null;
  /** Portfolio-/benchmarkcontext van het bureau, 0-2 regels, alleen patronen die aantoonbaar OVER
   *  dit account gaan (eigen naam/id in de patroontekst). Geen anonimisering -- dit document
   *  blijft intern bij het bureau, zie de toelichting bovenaan dit bestand. Leeg als er geen
   *  portfolio-synthese is of als dit account in geen enkel patroon voorkomt. */
  portfolioContext: string[];
}

export interface ClientBriefInput {
  clientId: string;
  accountName: string;
  finalSop: FinalSopSynthesis;
  operatingDetail?: OperatingDetailLayer | null;
}

function buildPortfolioContext(
  clientId: string,
  accountName: string,
  portfolio: PortfolioSynthesisResult | null | undefined
): string[] {
  if (!portfolio) return [];
  const naam = accountName.toLowerCase();
  const id = clientId.toLowerCase();
  const lines: string[] = [];
  for (const pattern of portfolio.recurring_patterns) {
    const gaatOverDitAccount = pattern.toLowerCase().includes(naam) || pattern.toLowerCase().includes(id);
    // Alleen tonen als het patroon aantoonbaar OVER dit account gaat (eigen naam/id erin) -- een
    // patroon dat alleen ANDERE accounts noemt is niet relevant voor dit account, ook al hoeft
    // het niet geanonimiseerd te worden.
    if (!gaatOverDitAccount) continue;
    lines.push(pattern);
  }
  return lines.slice(0, 2).map((l) => truncateWords(l, 24));
}

/** Pure transformatie (geen IO) -- apart geexporteerd zodat de test 'm zonder Supabase kan
 *  aanroepen. generateClientDecisionBrief() hieronder haalt de data op en roept dit aan. */
export function buildClientDecisionBrief(
  input: ClientBriefInput,
  opts: { period: string; portfolio?: PortfolioSynthesisResult | null }
): ClientDecisionBrief {
  const { finalSop, operatingDetail } = input;
  return {
    clientName: input.accountName,
    period: opts.period,
    phase: phaseFromRecommendations(finalSop),
    priority: priorityFromQaSelfCheck(finalSop),
    primaryThread: truncateWords(finalSop.primary_thread, WORD_BUDGET.primaryThread),
    rootCause: truncateWords(finalSop.root_cause, WORD_BUDGET.rootCause),
    whatIsNotTheProblem: truncateWords(
      finalSop.what_is_not_the_problem[0] ?? "Geen secundair signaal genoteerd.",
      WORD_BUDGET.whatIsNotTheProblem
    ),
    sprintActions: buildSprintActions(finalSop),
    decisionRule: buildDecisionRule(operatingDetail),
    portfolioContext: buildPortfolioContext(input.clientId, input.accountName, opts.portfolio),
  };
}

function formatPeriod(periodStart: string, periodEnd: string): string {
  try {
    const maand = new Date(periodStart).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
    return maand.charAt(0).toUpperCase() + maand.slice(1);
  } catch {
    return `${periodStart} t/m ${periodEnd}`;
  }
}

interface StructuredMonthlyRow {
  final_sop?: FinalSopSynthesis;
  operating_detail?: OperatingDetailLayer;
}

/**
 * Haalt zelf op wat er nodig is en bouwt het klantdocument: de laatste monthly
 * structured_monthly_v2 van deze klant, plus (als het bureau er een heeft) de laatste
 * portfolio-synthese van het bureau, om er patroon-context uit te lichten die over dit account
 * gaat. Dit document blijft intern bij het bureau (zie de toelichting bovenaan dit bestand), dus
 * geen anonimisering en geen aparte klantenlijst-fetch nodig.
 *
 * Null als deze klant geen monthly final_sop heeft -- geen verzonnen brief.
 */
export async function generateClientDecisionBrief(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientDecisionBrief | null> {
  const { data: accountRow } = await supabase.from("accounts").select("name, agency_id").eq("client_id", clientId).maybeSingle();
  const accountName = accountRow?.name ? String(accountRow.name) : clientId;
  const agencyId = accountRow?.agency_id ? String(accountRow.agency_id) : null;

  const { data: sopRow } = await supabase
    .from("sop_analysis_output")
    .select("output, period_start, period_end")
    .eq("client_id", clientId)
    .eq("sop_type", "monthly")
    .eq("section", "structured_monthly_v2")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sopRow?.output) return null;

  let parsed: StructuredMonthlyRow;
  try {
    parsed = (typeof sopRow.output === "string" ? JSON.parse(sopRow.output) : sopRow.output) as StructuredMonthlyRow;
  } catch {
    return null;
  }
  if (!parsed.final_sop) return null;

  let portfolio: PortfolioSynthesisResult | null = null;
  if (agencyId) {
    const { data } = await supabase
      .from("agency_analysis_output")
      .select("output")
      .eq("agency_id", agencyId)
      .eq("section", "portfolio_synthesis_v1")
      .order("analysis_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.output) {
      try {
        portfolio = (typeof data.output === "string" ? JSON.parse(data.output) : data.output) as PortfolioSynthesisResult;
      } catch {
        portfolio = null;
      }
    }
  }

  return buildClientDecisionBrief(
    { clientId, accountName, finalSop: parsed.final_sop, operatingDetail: parsed.operating_detail },
    { period: formatPeriod(String(sopRow.period_start ?? ""), String(sopRow.period_end ?? "")), portfolio }
  );
}

// ── DOCUMENT 2: Agency Portfolio Brief ──────────────────────────────────────────────────────

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

export interface AgencyPortfolioBrief {
  agencyName: string;
  generatedAt: string;
  macroMatrix: MacroMatrixRow[];
  portfolioSynthese: PortfolioSyntheseSection | null;
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

function buildPortfolioSynthese(portfolio: PortfolioSynthesisResult | null | undefined): PortfolioSyntheseSection | null {
  if (!portfolio) return null;
  const portfolioAction = portfolio.synthesized_actions.find((a) => a.clientId === "portfolio");
  return {
    sharedBlockage: portfolio.recurring_patterns[0] ?? null,
    exception: portfolio.outliers[0] ?? null,
    portfolioWarning: portfolioAction?.action ?? null,
  };
}

/** Pure transformatie (geen IO) -- apart geexporteerd voor de test. */
export function buildAgencyPortfolioBrief(
  agencyName: string,
  clients: readonly ClientBriefInput[],
  portfolio?: PortfolioSynthesisResult | null,
  generatedAt: string = new Date().toISOString().slice(0, 10)
): AgencyPortfolioBrief {
  return {
    agencyName,
    generatedAt,
    macroMatrix: clients.map(buildMacroRow),
    portfolioSynthese: buildPortfolioSynthese(portfolio),
  };
}

/**
 * Haalt zelf op wat er nodig is: alle klanten van dit bureau met SOP's aan (zelfde regel als de
 * bestaande dekking-telling, lijstAccountsMetSops), hun laatste monthly final_sop (klanten zonder
 * een geldige final_sop worden overgeslagen, niet als lege rij getoond), en de laatste
 * portfolio-synthese van het bureau.
 *
 * Null als het bureau niet bestaat of geen enkele klant een geldige final_sop heeft.
 */
export async function generateAgencyPortfolioBrief(
  supabase: SupabaseClient,
  agencyId: string
): Promise<AgencyPortfolioBrief | null> {
  const { data: agencyRow } = await supabase.from("agencies").select("name").eq("id", agencyId).maybeSingle();
  if (!agencyRow) return null;
  const agencyName = String(agencyRow.name ?? agencyId);

  const clientIds = await lijstAccountsMetSops(supabase, agencyId);
  if (!clientIds || clientIds.length === 0) return null;

  const { data: accountRows } = await supabase.from("accounts").select("client_id, name").eq("agency_id", agencyId).in("client_id", clientIds);
  const nameByClientId = new Map((accountRows ?? []).map((r) => [String(r.client_id), String(r.name ?? r.client_id)]));

  const structuredRows = await Promise.all(
    clientIds.map(async (clientId) => {
      const { data } = await supabase
        .from("sop_analysis_output")
        .select("output")
        .eq("client_id", clientId)
        .eq("sop_type", "monthly")
        .eq("section", "structured_monthly_v2")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data?.output) return null;
      try {
        const parsed = (typeof data.output === "string" ? JSON.parse(data.output) : data.output) as StructuredMonthlyRow;
        if (!parsed.final_sop) return null;
        return { clientId, finalSop: parsed.final_sop, operatingDetail: parsed.operating_detail };
      } catch {
        return null;
      }
    })
  );

  const clients: ClientBriefInput[] = structuredRows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({ clientId: r.clientId, accountName: nameByClientId.get(r.clientId) ?? r.clientId, finalSop: r.finalSop, operatingDetail: r.operatingDetail }));
  if (clients.length === 0) return null;

  const { data: portfolioRow } = await supabase
    .from("agency_analysis_output")
    .select("output")
    .eq("agency_id", agencyId)
    .eq("section", "portfolio_synthesis_v1")
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  let portfolio: PortfolioSynthesisResult | null = null;
  if (portfolioRow?.output) {
    try {
      portfolio = (typeof portfolioRow.output === "string" ? JSON.parse(portfolioRow.output) : portfolioRow.output) as PortfolioSynthesisResult;
    } catch {
      portfolio = null;
    }
  }

  return buildAgencyPortfolioBrief(agencyName, clients, portfolio);
}

// ── Markdown-rendering ───────────────────────────────────────────────────────────────────────

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function renderSprintActions(actions: ClientSprintActions): string {
  return [
    `- **Containment / Rem:** ${actions.containment ?? "Niet van toepassing -- geen containment-route in deze analyse."}`,
    `- **Validation / Recovery:** ${actions.validationRecovery ?? "Niet van toepassing -- geen validatie- of herstelroute in deze analyse."}`,
    `- **Controlled Scale:** ${actions.controlledScale ?? "Niet gedefinieerd -- schalen is pas aan de orde nadat de voorgaande routes zijn afgerond."}`,
  ].join("\n");
}

function renderDecisionRule(rule: ClientDecisionRule | null): string {
  if (!rule) return "*Geen beslisregel beschikbaar (geen hypothese met succescriteria in deze analyse).*";
  return [
    `- **Evaluatievenster:** ${rule.evaluationWindow}`,
    `- **Accept if:** ${rule.acceptIf}`,
    `- **Reject / Rollback if:** ${rule.rejectIf}`,
  ].join("\n");
}

export function renderClientDecisionBriefMarkdown(brief: ClientDecisionBrief): string {
  const lines = [
    `# Decision Brief: ${brief.clientName}`,
    `**Periode:** ${brief.period} | **Fase:** ${brief.phase} | **Prioriteit:** ${brief.priority}`,
    "",
    "## 1. Diagnose",
    `- **Primary Thread:** ${brief.primaryThread}`,
    `- **Root Cause:** ${brief.rootCause}`,
    `- **What is NOT the problem:** ${brief.whatIsNotTheProblem}`,
    "",
    "## 2. Sprint-Acties",
    renderSprintActions(brief.sprintActions),
    "",
    "## 3. Beslisregel & Falsificatie",
    renderDecisionRule(brief.decisionRule),
  ];
  if (brief.portfolioContext.length > 0) {
    lines.push("", "## Portfolio-context", ...brief.portfolioContext.map((l) => `- ${l}`));
  }
  return lines.join("\n");
}

export function renderAgencyPortfolioBriefMarkdown(brief: AgencyPortfolioBrief): string {
  const header = "| Account / Regio | Primaire Blokkage | Fase | Directe Kernactie | Prioriteit |";
  const sep = "|---|---|---|---|---|";
  const rows = brief.macroMatrix.map(
    (r) =>
      `| ${escapeTableCell(r.accountName)} | ${escapeTableCell(r.primaryBlockage)} | ${escapeTableCell(r.phase)} | ${escapeTableCell(r.coreAction)} | ${r.priority} |`
  );

  const s = brief.portfolioSynthese;
  const synthLines: string[] = [];
  if (s?.sharedBlockage) synthLines.push(`- **Gedeelde Blokkade:** ${s.sharedBlockage}`);
  if (s?.exception) synthLines.push(`- **Uitzondering:** ${s.exception}`);
  if (s?.portfolioWarning) synthLines.push(`- **Portfolio Waarschuwing:** ${s.portfolioWarning}`);
  if (synthLines.length === 0) synthLines.push("*Geen cross-account-synthese beschikbaar voor dit bureau.*");

  return [
    "# Agency Portfolio Brief",
    `**Bureau:** ${brief.agencyName} | **Datum:** ${brief.generatedAt}`,
    "",
    "## Macro Matrix",
    "",
    header,
    sep,
    ...rows,
    "",
    "## Portfolio Synthese",
    "",
    ...synthLines,
  ].join("\n");
}

/** Telt alleen de inhoudsvelden mee (niet de kopjes/labels) -- de "1 A4"-eis voor het
 *  klantdocument. Geëxporteerd zodat de test dezelfde telling gebruikt als de renderer zelf. */
export function wordCountForClientBrief(brief: ClientDecisionBrief): number {
  const parts = [
    brief.primaryThread,
    brief.rootCause,
    brief.whatIsNotTheProblem,
    brief.sprintActions.containment,
    brief.sprintActions.validationRecovery,
    brief.sprintActions.controlledScale,
    brief.decisionRule?.evaluationWindow,
    brief.decisionRule?.acceptIf,
    brief.decisionRule?.rejectIf,
    ...brief.portfolioContext,
  ].filter((v): v is string => typeof v === "string");
  return parts.reduce((sum, text) => sum + countWords(text), 0);
}
