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
//
// ── HERBOUW 2 SEPTEMBER 2026: ALLE KANALEN, EERLIJKE DEKKING, FOUT IS FOUT ─────────────────
//
// De eerste versie las uitsluitend sop_type "monthly" -- dat is Google. Een klant met alleen
// Meta- of LinkedIn-maandanalyses kreeg een 404 "geen analyse", en in het bureaudocument viel
// hij stil uit de matrix. Nu wordt over alle maand-sop-types gelezen (MONTHLY_SOP_TYPES) en
// staat het kanaal in het document. Verder slikte elke query zijn fout ("geen brief" bij een
// kapotte kolom), gaf formatPeriod letterlijk "Invalid Date" bij een lege period_start, en
// werd een ontbrekende zelfscore stil "Laag". Zie db-veilig.ts voor de datalaagregels.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FinalSopSynthesis, FinalSopQaSelfCheck, FinalSopRecommendation, OperatingDetailLayer, FinalSopRoute,
} from "./monthly-structured";
import type { PortfolioSynthesisResult } from "./portfolio-synthesis";
import { lijstAccountsMetSops } from "@/lib/tenancy/sop-dekking";
import { alleRijen, DataLaagFout, eis } from "@/lib/analysis/db-veilig";
import { ALLE_SOP_CHANNELS, CHANNEL_CONFIG, MONTHLY_SOP_TYPES } from "@/lib/analysis/sop-channel-config";
import { dekkingUitPeriode } from "@/lib/analysis/dekking-tekst";
import { formatMonth, isValidMonth } from "@/lib/period/period-range";
import { opsomming } from "@/lib/util/tekst";
import { today } from "@/lib/reporting-date";

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

// ── Kanaal ──────────────────────────────────────────────────────────────────────────────────

const KANAAL_LABEL_PER_MAAND_SOP_TYPE: ReadonlyMap<string, string> = new Map(
  ALLE_SOP_CHANNELS.map((kanaal) => [CHANNEL_CONFIG[kanaal].sopTypeKey.monthly, CHANNEL_CONFIG[kanaal].headerLabel])
);

/** De kanaalnamen die de briefs doorzoeken, voor een 404 die zegt wát er gecontroleerd is. */
export const GECONTROLEERDE_KANALEN: readonly string[] = ALLE_SOP_CHANNELS.map(
  (kanaal) => CHANNEL_CONFIG[kanaal].headerLabel
);

/** "meta_monthly" -> "Meta Ads". Een onbekende sleutel komt onvertaald terug, niet als lege tekst. */
export function kanaalLabelVanSopType(sopType: string | null | undefined): string {
  if (!sopType) return "Onbekend";
  return KANAAL_LABEL_PER_MAAND_SOP_TYPE.get(sopType) ?? sopType;
}

// ── Prioriteit en fase ──────────────────────────────────────────────────────────────────────

export type Priority = "Hoog" | "Midden" | "Laag" | "Onbekend";

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Afgeleid van de zelfscore van de analyse. Oudere structured_monthly_v2-rijen hebben geen
 * qa_self_check -- het type zegt "verplicht", de database niet. Ontbreekt een van de twee
 * scores, dan is de prioriteit "Onbekend": NaN werd eerder stil "Laag", en "Laag" is een
 * oordeel dat een lezer als beslisinformatie leest.
 */
function priorityFromQaSelfCheck(finalSop: FinalSopSynthesis): Priority {
  const qa = finalSop.qa_self_check as Partial<FinalSopQaSelfCheck> | undefined;
  const why = score(qa?.why_score_estimate);
  const actionability = score(qa?.actionability_score_estimate);
  if (why === null || actionability === null) return "Onbekend";
  const avg = (why + actionability) / 2;
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

/** Ontbrekende of misvormde lijsten op oudere rijen lezen als leeg, niet als TypeError. */
function recommendationsOf(finalSop: FinalSopSynthesis): FinalSopRecommendation[] {
  return Array.isArray(finalSop.recommendations) ? finalSop.recommendations : [];
}

function tekstOf(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function phaseFromRecommendations(finalSop: FinalSopSynthesis): string {
  const first = recommendationsOf(finalSop)[0];
  return first ? (PHASE_LABEL[first.route] ?? "Onbekend") : "Onbekend";
}

function findByRoute(finalSop: FinalSopSynthesis, route: FinalSopRoute): string | null {
  const rec = recommendationsOf(finalSop).find((r) => r.route === route);
  return rec ? tekstOf(rec.handeling, "") || null : null;
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
    evaluationWindow: truncateWords(tekstOf(first.evaluation_window, "onbekend"), WORD_BUDGET.evaluationWindow),
    acceptIf: truncateWords(tekstOf(first.accept_if, "niet vastgelegd"), WORD_BUDGET.acceptIf),
    rejectIf: truncateWords(tekstOf(first.reject_if, "niet vastgelegd"), WORD_BUDGET.rejectIf),
  };
}

// ── Periode ─────────────────────────────────────────────────────────────────────────────────

const MAAND_PREFIX = /^(\d{4}-\d{2})/;

/** "2026-08-01" of "2026-08" -> "Augustus 2026"; null als het geen maand is. */
function maandTekst(waarde: string): string | null {
  const match = MAAND_PREFIX.exec(waarde);
  if (!match || !isValidMonth(match[1])) return null;
  const naam = formatMonth(match[1]);
  return naam.charAt(0).toUpperCase() + naam.slice(1);
}

/**
 * De periode als leesbare tekst. Nooit "Invalid Date": de vorige versie liet dat aan
 * `new Date(...)` over, en die gooit bij een lege string geen fout maar geeft een Date die
 * als "Invalid Date" formatteert -- de catch-fallback was dood en de PDF toonde het letterlijk.
 *
 * Eén maand (begin en eind in dezelfde maand, of alleen een begin) wordt "Augustus 2026";
 * meerdere maanden "Juni 2026 t/m Augustus 2026"; iets wat geen datum is komt letterlijk
 * terug als "a t/m b"; helemaal niets is "onbekend".
 */
export function formatPeriod(periodStart: string | null | undefined, periodEnd: string | null | undefined): string {
  const start = periodStart ? String(periodStart).trim() : "";
  const eind = periodEnd ? String(periodEnd).trim() : "";
  if (!start && !eind) return "onbekend";
  const startMaand = start ? maandTekst(start) : null;
  const eindMaand = eind ? maandTekst(eind) : null;
  if (startMaand && (!eind || eind.slice(0, 7) === start.slice(0, 7))) return startMaand;
  if (startMaand && eindMaand) return `${startMaand} t/m ${eindMaand}`;
  if (!start && eindMaand) return eindMaand;
  return [start, eind].filter(Boolean).join(" t/m ");
}

// ── DOCUMENT 1: Client Decision Brief ───────────────────────────────────────────────────────

export interface ClientDecisionBrief {
  clientName: string;
  period: string;
  /** Het kanaal van de gebruikte maandanalyse ("SEA", "Meta Ads", ...). */
  channel: string;
  /** De analysis_date van de gebruikte rij; null als die niet bekend is (pure builder). */
  analysisDate: string | null;
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
  /** Kanaal en periode van de gebruikte rij; alleen het bureaudocument gebruikt ze per klant. */
  channel?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  analysisDate?: string | null;
}

export interface ClientBriefOpties {
  period: string;
  channel?: string;
  analysisDate?: string | null;
  portfolio?: PortfolioSynthesisResult | null;
}

function buildPortfolioContext(
  clientId: string,
  accountName: string,
  portfolio: PortfolioSynthesisResult | null | undefined
): string[] {
  if (!portfolio || !Array.isArray(portfolio.recurring_patterns)) return [];
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
export function buildClientDecisionBrief(input: ClientBriefInput, opts: ClientBriefOpties): ClientDecisionBrief {
  const { finalSop, operatingDetail } = input;
  const nietHetProbleem = Array.isArray(finalSop.what_is_not_the_problem) ? finalSop.what_is_not_the_problem : [];
  return {
    clientName: input.accountName,
    period: opts.period,
    channel: opts.channel ?? input.channel ?? "Onbekend",
    analysisDate: opts.analysisDate ?? input.analysisDate ?? null,
    phase: phaseFromRecommendations(finalSop),
    priority: priorityFromQaSelfCheck(finalSop),
    primaryThread: truncateWords(tekstOf(finalSop.primary_thread, "Geen primary thread vastgelegd."), WORD_BUDGET.primaryThread),
    rootCause: truncateWords(tekstOf(finalSop.root_cause, "Geen root cause vastgelegd."), WORD_BUDGET.rootCause),
    whatIsNotTheProblem: truncateWords(
      tekstOf(nietHetProbleem[0], "Geen secundair signaal genoteerd."),
      WORD_BUDGET.whatIsNotTheProblem
    ),
    sprintActions: buildSprintActions(finalSop),
    decisionRule: buildDecisionRule(operatingDetail),
    portfolioContext: buildPortfolioContext(input.clientId, input.accountName, opts.portfolio),
  };
}

// ── Datalaag ────────────────────────────────────────────────────────────────────────────────

const SECTION = "structured_monthly_v2";
const SOP_CONTEXT = `sop_analysis_output (${SECTION})`;

interface StructuredMonthlyRow {
  final_sop?: FinalSopSynthesis;
  operating_detail?: OperatingDetailLayer;
}

/** Null bij lege of onleesbare output; de aanroeper bepaalt of dat een fout is. */
function parseStructuredOutput(output: unknown): StructuredMonthlyRow | null {
  if (!output) return null;
  try {
    const parsed = typeof output === "string" ? JSON.parse(output) : output;
    return parsed && typeof parsed === "object" ? (parsed as StructuredMonthlyRow) : null;
  } catch {
    return null;
  }
}

/**
 * De laatste portfolio-synthese van het bureau, of null. Een queryfout gooit (eis); een rij
 * met onleesbare JSON geeft null, want de portfolio-context is verrijking -- het document is
 * zonder haar nog steeds correct, en een kapotte synthese hoort de brief niet te blokkeren.
 */
async function leesPortfolioSynthese(supabase: SupabaseClient, agencyId: string): Promise<PortfolioSynthesisResult | null> {
  const [rij] = eis(
    await supabase
      .from("agency_analysis_output")
      .select("output")
      .eq("agency_id", agencyId)
      .eq("section", "portfolio_synthesis_v1")
      .order("analysis_date", { ascending: false })
      .limit(1),
    "agency_analysis_output (portfolio_synthesis_v1)"
  );
  if (!rij?.output) return null;
  try {
    return (typeof rij.output === "string" ? JSON.parse(rij.output) : rij.output) as PortfolioSynthesisResult;
  } catch {
    return null;
  }
}

/**
 * Haalt zelf op wat er nodig is en bouwt het klantdocument: de nieuwste structured_monthly_v2
 * van deze klant over ALLE kanalen (Google, Meta, LinkedIn, Microsoft -- de nieuwste wint),
 * plus (als het bureau er een heeft) de laatste portfolio-synthese van het bureau, om er
 * patroon-context uit te lichten die over dit account gaat. Dit document blijft intern bij het
 * bureau (zie de toelichting bovenaan dit bestand), dus geen anonimisering.
 *
 * Null als deze klant op geen enkel kanaal een maandanalyse heeft -- geen verzonnen brief.
 * Een queryfout, of een nieuwste rij zonder leesbare final_sop, gooit DataLaagFout: dat is
 * geen "geen analyse" maar een kapotte bron, en de route hoort dat als 500 te melden.
 */
export async function generateClientDecisionBrief(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientDecisionBrief | null> {
  const [accountRow] = eis(
    await supabase.from("accounts").select("name, agency_id").eq("client_id", clientId).limit(1),
    "accounts"
  );
  const accountName = accountRow?.name ? String(accountRow.name) : clientId;
  const agencyId = accountRow?.agency_id ? String(accountRow.agency_id) : null;

  const [sopRow] = eis(
    await supabase
      .from("sop_analysis_output")
      .select("sop_type, output, period_start, period_end, analysis_date")
      .eq("client_id", clientId)
      .in("sop_type", [...MONTHLY_SOP_TYPES])
      .eq("section", SECTION)
      .order("created_at", { ascending: false })
      .limit(1),
    SOP_CONTEXT
  );
  if (!sopRow) return null;

  const channel = kanaalLabelVanSopType(sopRow.sop_type ? String(sopRow.sop_type) : null);
  const analysisDate = sopRow.analysis_date ? String(sopRow.analysis_date) : null;
  const parsed = parseStructuredOutput(sopRow.output);
  if (!parsed?.final_sop) {
    throw new DataLaagFout(
      SOP_CONTEXT,
      `de nieuwste rij (${channel}, analyse van ${analysisDate ?? "onbekende datum"}) heeft geen leesbare final_sop`
    );
  }

  const portfolio = agencyId ? await leesPortfolioSynthese(supabase, agencyId) : null;

  return buildClientDecisionBrief(
    { clientId, accountName, finalSop: parsed.final_sop, operatingDetail: parsed.operating_detail },
    {
      period: formatPeriod(sopRow.period_start ? String(sopRow.period_start) : null, sopRow.period_end ? String(sopRow.period_end) : null),
      channel,
      analysisDate,
      portfolio,
    }
  );
}

// ── DOCUMENT 2: Agency Portfolio Brief ──────────────────────────────────────────────────────

export interface MacroMatrixRow {
  accountName: string;
  /** Kanaal van de gebruikte maandanalyse. */
  channel: string;
  /** Periode van de gebruikte maandanalyse, leesbaar ("Augustus 2026"). */
  period: string;
  /** True als de analysemaand ouder is dan de laatste afgesloten maand: januari naast augustus
   *  in dezelfde tabel is geen vergelijking, en de lezer hoort dat te zien. */
  verouderd: boolean;
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
  /** Accountnamen (met SOP's aan) zonder enige structured_monthly_v2, op welk kanaal ook. Eerder
   *  vielen die stil uit de matrix; een bureaudocument dat drie van de vijf klanten toont zonder
   *  te zeggen dat er vijf zijn, is geen managementoverzicht. */
  zonderAnalyse: string[];
  portfolioSynthese: PortfolioSyntheseSection | null;
}

export interface AgencyBriefOpties {
  zonderAnalyse?: string[];
  /** De laatste afgesloten maand ("YYYY-MM") waartegen "verouderd" wordt bepaald; standaard
   *  de echte. Alleen de test zet hem vast. */
  nu?: string;
}

function buildMacroRow(input: ClientBriefInput, nu: string | undefined): MacroMatrixRow {
  const { accountName, finalSop } = input;
  const dekking = dekkingUitPeriode(input.periodStart, input.periodEnd, nu);
  return {
    accountName,
    channel: input.channel ?? "Onbekend",
    period: formatPeriod(input.periodStart, input.periodEnd),
    verouderd: dekking?.verouderd ?? false,
    primaryBlockage: truncateWords(tekstOf(finalSop.primary_thread, "Geen primary thread vastgelegd."), WORD_BUDGET.primaryThread),
    phase: phaseFromRecommendations(finalSop),
    coreAction: truncateWords(
      tekstOf(recommendationsOf(finalSop)[0]?.handeling, "Geen aanbeveling beschikbaar."),
      WORD_BUDGET.containment
    ),
    priority: priorityFromQaSelfCheck(finalSop),
  };
}

function buildPortfolioSynthese(portfolio: PortfolioSynthesisResult | null | undefined): PortfolioSyntheseSection | null {
  if (!portfolio) return null;
  const acties = Array.isArray(portfolio.synthesized_actions) ? portfolio.synthesized_actions : [];
  const portfolioAction = acties.find((a) => a.clientId === "portfolio");
  return {
    sharedBlockage: portfolio.recurring_patterns?.[0] ?? null,
    exception: portfolio.outliers?.[0] ?? null,
    portfolioWarning: portfolioAction?.action ?? null,
  };
}

/** Pure transformatie (geen IO) -- apart geexporteerd voor de test. */
export function buildAgencyPortfolioBrief(
  agencyName: string,
  clients: readonly ClientBriefInput[],
  portfolio?: PortfolioSynthesisResult | null,
  generatedAt: string = today(),
  opts: AgencyBriefOpties = {}
): AgencyPortfolioBrief {
  return {
    agencyName,
    generatedAt,
    macroMatrix: clients.map((client) => buildMacroRow(client, opts.nu)),
    zonderAnalyse: opts.zonderAnalyse ?? [],
    portfolioSynthese: buildPortfolioSynthese(portfolio),
  };
}

interface StructuredIndexRij {
  id: string;
  client_id: string;
  sop_type: string;
  period_start: string | null;
  period_end: string | null;
  analysis_date: string | null;
  created_at: string;
}

/**
 * Haalt zelf op wat er nodig is: alle klanten van dit bureau met SOP's aan (zelfde regel als de
 * bestaande dekking-telling, lijstAccountsMetSops), per klant de nieuwste maandanalyse over alle
 * kanalen, en de laatste portfolio-synthese van het bureau. Klanten zonder analyse staan in
 * `zonderAnalyse`, niet stil weggelaten.
 *
 * Twee gebundelde queries in plaats van één per klant: eerst een lichte index (id, klant,
 * kanaal, periode, aflopend op created_at) waaruit in het geheugen de nieuwste rij per klant
 * wordt gekozen, dan alleen de `output` van die gekozen rijen. De output van een
 * structured_monthly_v2 is groot (final_sop plus operating_detail, elk met markdown); alle
 * historische outputs van alle klanten ophalen om er per klant één te houden zou tientallen
 * megabytes per brief kosten, en elke maand meer.
 *
 * Null als het bureau niet bestaat of geen enkele klant met SOP's aan heeft. Een bureau waarvan
 * geen enkele klant een analyse heeft krijgt WEL een document: een lege matrix met alle namen
 * onder "Zonder analyse" is de eerlijke stand van zaken, een 404 niet.
 */
export async function generateAgencyPortfolioBrief(
  supabase: SupabaseClient,
  agencyId: string
): Promise<AgencyPortfolioBrief | null> {
  const [agencyRow] = eis(await supabase.from("agencies").select("name").eq("id", agencyId).limit(1), "agencies");
  if (!agencyRow) return null;
  const agencyName = String(agencyRow.name ?? agencyId);

  // lijstAccountsMetSops geeft null bij een leesfout (en een lege lijst bij "geen klanten");
  // die null is hier een fout, geen leeg bureau.
  const clientIds = await lijstAccountsMetSops(supabase, agencyId);
  if (clientIds === null) throw new DataLaagFout("accounts (sops_enabled)", "de klantenlijst van het bureau kon niet gelezen worden");
  if (clientIds.length === 0) return null;

  const accountRows = (await alleRijen<{ client_id: string; name: string | null }>(
    (van, tot) => supabase
      .from("accounts")
      .select("client_id, name")
      .eq("agency_id", agencyId)
      .in("client_id", clientIds)
      .order("client_id", { ascending: true })
      .range(van, tot),
    "accounts"
  )).rijen;
  const nameByClientId = new Map(accountRows.map((r) => [String(r.client_id), String(r.name ?? r.client_id)]));

  // Aflopend op created_at: de eerste rij per klant is de nieuwste, over alle kanalen heen.
  // Een afkap op het plafond raakt daardoor alleen oude rijen en nooit de keuze hieronder.
  const index = await alleRijen<StructuredIndexRij>(
    (van, tot) => supabase
      .from("sop_analysis_output")
      .select("id, client_id, sop_type, period_start, period_end, analysis_date, created_at")
      .in("client_id", clientIds)
      .in("sop_type", [...MONTHLY_SOP_TYPES])
      .eq("section", SECTION)
      .order("created_at", { ascending: false })
      .range(van, tot),
    SOP_CONTEXT,
    { max: 25_000 }
  );
  const nieuwstePerKlant = new Map<string, StructuredIndexRij>();
  for (const rij of index.rijen) {
    const id = String(rij.client_id);
    if (!nieuwstePerKlant.has(id)) nieuwstePerKlant.set(id, rij);
  }

  const gekozenIds = Array.from(nieuwstePerKlant.values()).map((rij) => String(rij.id));
  const outputById = new Map<string, unknown>();
  if (gekozenIds.length > 0) {
    const outputRows = (await alleRijen<{ id: string; output: unknown }>(
      (van, tot) => supabase
        .from("sop_analysis_output")
        .select("id, output")
        .in("id", gekozenIds)
        .order("id", { ascending: true })
        .range(van, tot),
      `${SOP_CONTEXT} output`
    )).rijen;
    for (const rij of outputRows) outputById.set(String(rij.id), rij.output);
  }

  const clients: ClientBriefInput[] = [];
  const zonderAnalyse: string[] = [];
  for (const clientId of clientIds) {
    const accountName = nameByClientId.get(clientId) ?? clientId;
    const rij = nieuwstePerKlant.get(clientId);
    if (!rij) {
      zonderAnalyse.push(accountName);
      continue;
    }
    const parsed = parseStructuredOutput(outputById.get(String(rij.id)));
    if (!parsed?.final_sop) {
      // Er is wél een rij, maar er valt niets uit te lezen. Dat is een andere toestand dan
      // "geen analyse" en de lezer hoort het verschil te zien.
      zonderAnalyse.push(`${accountName} (nieuwste analyse zonder leesbare final_sop)`);
      continue;
    }
    clients.push({
      clientId,
      accountName,
      finalSop: parsed.final_sop,
      operatingDetail: parsed.operating_detail,
      channel: kanaalLabelVanSopType(rij.sop_type),
      periodStart: rij.period_start ? String(rij.period_start) : null,
      periodEnd: rij.period_end ? String(rij.period_end) : null,
      analysisDate: rij.analysis_date ? String(rij.analysis_date) : null,
    });
  }
  const opNaam = (a: string, b: string) => a.localeCompare(b, "nl");
  clients.sort((a, b) => opNaam(a.accountName, b.accountName));
  zonderAnalyse.sort(opNaam);

  const portfolio = await leesPortfolioSynthese(supabase, agencyId);
  return buildAgencyPortfolioBrief(agencyName, clients, portfolio, today(), { zonderAnalyse });
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

/** "Augustus 2026 · Meta Ads", met "(verouderd)" als de analysemaand achterloopt. */
export function periodeKanaalTekst(row: Pick<MacroMatrixRow, "period" | "channel" | "verouderd">): string {
  return `${row.period} · ${row.channel}${row.verouderd ? " (verouderd)" : ""}`;
}

export function renderClientDecisionBriefMarkdown(brief: ClientDecisionBrief): string {
  const meta = [
    `**Periode:** ${brief.period}`,
    `**Kanaal:** ${brief.channel}`,
    ...(brief.analysisDate ? [`**Analyse van:** ${brief.analysisDate}`] : []),
    `**Fase:** ${brief.phase}`,
    `**Prioriteit:** ${brief.priority}`,
  ].join(" | ");
  const lines = [
    `# Decision Brief: ${brief.clientName}`,
    meta,
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
  const header = "| Account / Regio | Periode · Kanaal | Primaire Blokkage | Fase | Directe Kernactie | Prioriteit |";
  const sep = "|---|---|---|---|---|---|";
  const rows = brief.macroMatrix.map(
    (r) =>
      `| ${escapeTableCell(r.accountName)} | ${escapeTableCell(periodeKanaalTekst(r))} | ${escapeTableCell(r.primaryBlockage)} | ${escapeTableCell(r.phase)} | ${escapeTableCell(r.coreAction)} | ${r.priority} |`
  );
  if (rows.length === 0) rows.push("", "*Geen enkele klant heeft een maandanalyse; zie \"Zonder analyse\".*");

  const s = brief.portfolioSynthese;
  const synthLines: string[] = [];
  if (s?.sharedBlockage) synthLines.push(`- **Gedeelde Blokkade:** ${s.sharedBlockage}`);
  if (s?.exception) synthLines.push(`- **Uitzondering:** ${s.exception}`);
  if (s?.portfolioWarning) synthLines.push(`- **Portfolio Waarschuwing:** ${s.portfolioWarning}`);
  if (synthLines.length === 0) synthLines.push("*Geen cross-account-synthese beschikbaar voor dit bureau.*");

  const lines = [
    "# Agency Portfolio Brief",
    `**Bureau:** ${brief.agencyName} | **Datum:** ${brief.generatedAt}`,
    "",
    "## Macro Matrix",
    "",
    header,
    sep,
    ...rows,
  ];
  if (brief.zonderAnalyse.length > 0) {
    lines.push(
      "",
      "## Zonder analyse",
      "",
      `Geen maandanalyse (structured_monthly_v2) op enig kanaal voor: ${opsomming(brief.zonderAnalyse)}.`
    );
  }
  lines.push("", "## Portfolio Synthese", "", ...synthLines);
  return lines.join("\n");
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
