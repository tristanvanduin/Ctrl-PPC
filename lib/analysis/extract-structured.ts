/**
 * Shared structured extraction pipeline for SOP analyses.
 *
 * Adds Zod-validated findings, recommendations, and tasks extraction
 * to any SOP analysis output. Used by weekly, biweekly, and monthly routes.
 *
 * Flow:
 * 1. Run findings extraction step (JSON mode)
 * 2. Run recommendations+tasks extraction step (JSON mode)
 * 3. Parse with Zod (with partial recovery)
 * 4. Apply deterministic action gating
 * 5. Save to sop_insights, sop_recommendations, sop_tasks, sprint_hypotheses
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { runStep, type StepResult } from "./helpers";
import {
  parseFindings,
  parseRecommendations,
  type Finding,
  type Recommendation,
  type Task,
} from "../schema/analysis-schema";
import { applyActionGating } from "./action-gating";
import { saveProposalsReplacingPending, proposalSourceForSopType, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { extractGroundedNumbers, gateItemFields } from "./weekly-number-gate";
import type { DataReliabilityAssessment } from "./data-reliability";
import type { DroppedItems } from "@/lib/schema/analysis-schema";
import { logger } from "@/lib/logger";
import { toPromptTable } from "./prompt-table";
import { bouwBronFeiten, type BevindingToets, type BronFeiten } from "./brondata-toets";
import { afgevallenWaarschuwing, bevindingBeschrijving, bevindingTitel, toetsExtractie } from "./bevinding-weergave";
import { beoordeelMeetbaarheid, meetbaarheidTekst, type Meetbaarheid } from "@/lib/learning/hypothesis-parser";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  findings: Finding[];
  recommendations: Recommendation[];
  tasks: Task[];
  findingsParseOk: boolean;
  recsParseOk: boolean;
  /**
   * Wat het herstelpad heeft weggegooid omdat het niet valideerde, of null als er niets
   * wegviel. Stond hier niet, waardoor "geparsed" en "volledig geparsed" niet te
   * onderscheiden waren: recsParseOk was true terwijl er taken ontbraken.
   */
  recsDropped: DroppedItems | null;
  /** Idem voor de bevindingen: wat afviel en waarom, of null. */
  findingsDropped: DroppedItems | null;
  saved: boolean;
  /** Waarom het wegschrijven mislukte, als het mislukte. */
  saveError: string | null;
  steps: StepResult[];
  /**
   * De uitkomst van de brondata-toets, of null als de route geen brondata meegaf. Een bevinding
   * met een niet-herleidbaar kerngetal staat gemarkeerd op het scherm; deze tellingen zeggen
   * hoeveel, zodat de run het ook in zijn eigen melding kan noemen.
   */
  brondata: { bevindingenNietHerleidbaar: number; cijfersNietHerleidbaar: number } | null;
  /** Waarschuwingen voor de jobmelding en het antwoord: wat de gebruiker van deze run moet weten. */
  waarschuwingen: string[];
}

interface ExtractionOptions {
  supabase: SupabaseClient;
  apiKey: string;
  clientId: string;
  sopType: "weekly" | "biweekly" | "monthly" | "meta_weekly" | "linkedin_weekly" | "meta_biweekly" | "linkedin_biweekly" | "microsoft_weekly" | "microsoft_biweekly";
  analysisDate: string;
  periodStart: string;
  periodEnd: string;
  /** The full analysis text output to extract from */
  analysisOutput: string;
  /** System prompt for findings extraction */
  findingsSystemPrompt: string;
  /** System prompt for recommendations extraction */
  recsSystemPrompt: string;
  /** Step number offset (findings step = offset+1, recs step = offset+2) */
  stepOffset: number;
  /** The analysis_id from sop_analysis_output (for FK linking) */
  analysisId: string | null;
  /** Optional data reliability assessment — downgrades direct_actions if low/critical */
  reliability?: DataReliabilityAssessment;
  /** Optional: TOP 3 BEVINDINGEN text extracted from analysis steps */
  topFindings?: string;
  /**
   * De cijfers die het model kreeg: databaserijen, doelen en door code geschreven context. NOOIT
   * modeluitvoer (eerdere stappen, het geheugen, de maandoverdracht): de brondata-toets legt elk
   * getal in de bevindingen en aanbevelingen hiertegen. Zonder dit valt de route terug op de oude
   * cijferpoort, die model met model vergelijkt.
   */
  bronFeiten?: unknown[];
  /**
   * Run-sleutel (jobId) voor de llm_usage-kostenregistratie. Zonder deze sleutel logt runStep
   * niets, en dan stonden de twee extractiestappen -- de enige JSON-stappen van 16.000 tokens --
   * buiten het uitgavenplafond, dat juist op llm_usage telt.
   */
  runKey?: string;
  /** Optional progress callback */
  onPhase?: (phaseKey: "extract_findings" | "extract_recommendations" | "save_outputs", message?: string) => Promise<void>;
}

// ── Uitvoerplafond van de twee extractiestappen ──────────────────────────
//
// De standaard voor een JSON-stap is 8192 tokens. Op 1 september 2026 liep de Microsoft-biweekly
// daar in stap 6 ("Aanbevelingen & Taken") tegenaan: het antwoord werd afgekapt na 26.809 tekens,
// de JSON was onleesbaar en de hele run mislukte. Deze stap zet ALLE bevindingen van de analyse om
// in aanbevelingen plus taken; hoe rijker de analyse, hoe langer de JSON. Het plafond verhogen kost
// alleen iets bij een langer antwoord -- de prijs is per geschreven token, niet per plafond.
export const EXTRACTIE_MAX_TOKENS = 16000;

// ── Main extraction function ──────────────────────────────────────────────

export async function extractStructuredData(opts: ExtractionOptions): Promise<ExtractionResult> {
  const {
    supabase, apiKey, clientId, sopType,
    analysisDate, periodStart, periodEnd,
    analysisOutput, findingsSystemPrompt, recsSystemPrompt,
    stepOffset, analysisId, reliability, topFindings,
    runKey, onPhase, bronFeiten,
  } = opts;
  const waarschuwingen: string[] = [];

  const shared = { supabase, apiKey, clientId, sopType, periodStart, periodEnd, runKey };
  const steps: StepResult[] = [];

  // ── Step A: Extract findings (JSON mode) ─────────────────────────

  const findingsUserMessage = topFindings
    ? `Extraheer alle significante bevindingen uit deze analyse.

## TOP 3 BEVINDINGEN per stap
${topFindings}

## Volledige analyse
${analysisOutput}`
    : `Extraheer alle significante bevindingen uit deze analyse.

## Volledige analyse
${analysisOutput}`;

  await onPhase?.("extract_findings", "Findings uit de analyse halen...");
  const findingsStep = await runStep({
    ...shared,
    stepNumber: stepOffset + 1,
    stepName: "Findings Extractie",
    systemPrompt: findingsSystemPrompt,
    userMessage: findingsUserMessage,
    jsonMode: true,
    maxTokens: EXTRACTIE_MAX_TOKENS,
  });
  steps.push(findingsStep);

  const findingsResult = parseFindings(findingsStep.output);
  const findings: Finding[] = findingsResult.success ? findingsResult.data : [];
  if (!findingsResult.success) {
    logger.error(`[${sopType}] Findings parse failed:`, findingsResult.error);
    waarschuwingen.push(`De bevindingen konden niet worden ingelezen: ${findingsResult.error.slice(0, 200)}`);
  }
  const findingsDropped = findingsResult.success ? (findingsResult.dropped ?? null) : null;
  const afgevallen = afgevallenWaarschuwing(findingsDropped, findings.length);
  if (afgevallen) {
    // Zelfde reden als bij de aanbevelingen hieronder: een schemafout mag niet stil bepalen welke
    // bevindingen de specialist te zien krijgt.
    logger.error(`[${sopType}] ${afgevallen} | ${findingsDropped?.reasons.join(" | ")}`);
    waarschuwingen.push(afgevallen);
  }

  // ── Step B: Extract recommendations + tasks (JSON mode) ──────────

  await onPhase?.("extract_recommendations", "Aanbevelingen en taken genereren...");
  const recsStep = await runStep({
    ...shared,
    stepNumber: stepOffset + 2,
    stepName: "Aanbevelingen & Taken",
    systemPrompt: recsSystemPrompt,
    // De index staat als eigen kolom in de tabel. In de JSON-versie moest het model de positie
    // in de array tellen om `finding_index` in te vullen, terwijl de prompt nergens uitlegt dat
    // die twee met elkaar te maken hebben. Een index buiten bereik leverde stil `insight_id:
    // null` op — de aanbeveling belandde dan zonder de bevinding waar hij uit voortkomt in de
    // database. Aflezen is minder foutgevoelig dan tellen.
    userMessage: `## Bevindingen
Gebruik de kolom finding_index als waarde voor "finding_index" in je uitvoer.

${toPromptTable(findings.map((f, i) => ({ finding_index: i, ...f })))}

## Volledige analyse tekst
${analysisOutput}`,
    jsonMode: true,
    maxTokens: EXTRACTIE_MAX_TOKENS,
  });
  steps.push(recsStep);

  const recsResult = parseRecommendations(recsStep.output);
  let recs: Recommendation[] = recsResult.success ? recsResult.data.recommendations : [];
  let tasks: Task[] = recsResult.success ? recsResult.data.tasks : [];
  if (!recsResult.success) {
    logger.error(`[${sopType}] Recommendations parse failed:`, recsResult.error);
  } else if (recsResult.dropped) {
    // Het herstelpad heeft items weggegooid. Dat is beter dan alles verliezen, maar het hoort
    // niet stil te gebeuren: een LLM die systematisch een veld verkeerd invult raakt zo het
    // gros van zijn voorstellen kwijt zonder dat iemand het merkt.
    const { counts, reasons } = recsResult.dropped;
    const wat = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" en ");
    logger.error(`[${sopType}] ${wat} weggevallen bij het parsen omdat ze niet valideerden: ${reasons.join(" | ")}`);
  }

  // ── Apply deterministic action gating ────────────────────────────

  // F5 fase2.5: sopType draagt het kanaal al in de naam (meta_weekly, linkedin_biweekly, ...);
  // alleen het kanaal-voorvoegsel is relevant voor kanaalspecifieke gating-regels.
  const channel = sopType.startsWith("linkedin_") ? "linkedin_ads" : sopType.startsWith("meta_") ? "meta_ads" : sopType.startsWith("microsoft_") ? "microsoft_ads" : "google_ads";

  // ── De voorstellenbron: per SOP-variant, niet één gedeelde ────────────────
  //
  // Dit stond op de vaste string "analysis", en dat was op twee manieren fout.
  //
  // 1. DATAVERLIES. saveProposalsReplacingPending verwijdert de bestaande pending-rijen van de
  //    opgegeven bron. Alle zes de weekly-/bi-weekly-varianten schreven onder dezelfde bron, dus
  //    draaide de Meta-weekly ná de Google-weekly, dan waren Google's openstaande voorstellen weg.
  //    Van de zes hield alleen de laatst gedraaide iets over. De 22 kleinere deelanalyses kregen
  //    juist élk een eigen bron om precies dat te voorkomen.
  //
  // 2. ONZICHTBAARHEID. "analysis" is de bron van de MAANDpijplijn, en
  //    components/insights/proposal-queue.tsx sluit die bewust uit ("de maand-bron heeft zijn eigen
  //    workflow-block"). Weekly- en bi-weekly-voorstellen werden dus weggeschreven en daarna
  //    verborgen. Met een eigen bron verschijnen ze voor het eerst in de wachtrij -- dat is geen
  //    neveneffect maar het herstel: die uitsluitingsreden geldt niet voor hen.
  //
  // Het patroon is niet nieuw: app/api/insights/monthly-hypotheses/route.ts doet al
  // `sopType === "monthly" ? "analysis" : sopType`. extractStructuredData wordt nooit met "monthly"
  // aangeroepen (alleen de zes varianten), maar de ternary blijft staan zodat de betekenis van
  // "analysis" op één plek leesbaar blijft: dat is de maand, en niets anders.
  const voorstelBron = proposalSourceForSopType(sopType);
  recs = applyActionGating(findings, recs, { channel });

  // De brondata-toets: elk bedrag, aantal en percentage in bevindingen, aanbevelingen en taken
  // tegen de cijfers die het model KREEG, niet tegen wat het model schreef. Zonder brondata valt de
  // route terug op de oude cijferpoort hieronder, die de analysetekst zelf als gegrond neemt.
  let bevindingToetsen: BevindingToets[] | null = null;
  let brondata: ExtractionResult["brondata"] = null;
  if (bronFeiten && bronFeiten.length > 0) {
    const feiten: BronFeiten = bouwBronFeiten(bronFeiten);
    const toets = toetsExtractie(findings, recs, tasks, feiten);
    bevindingToetsen = toets.bevindingen;
    recs = toets.recommendations;
    tasks = toets.tasks;
    brondata = { bevindingenNietHerleidbaar: toets.bevindingenNietHerleidbaar, cijfersNietHerleidbaar: toets.cijfersNietHerleidbaar };
    if (toets.bevindingenNietHerleidbaar > 0) {
      waarschuwingen.push(`${toets.bevindingenNietHerleidbaar} van de ${findings.length} bevindingen hebben een kerngetal dat niet in de brondata staat; ze staan gemarkeerd bij Bevindingen.`);
    }
    if (toets.cijfersNietHerleidbaar > 0) {
      waarschuwingen.push(`${toets.cijfersNietHerleidbaar} getallen in aanbevelingen en taken kwamen niet uit de brondata en zijn vervangen door een markering.`);
    }
  } else if (sopType.endsWith("weekly") || sopType.endsWith("biweekly")) {
    // W2.5 (W2): de oude number-gate, als terugval. Vergelijkt met de analysetekst zelf (model
    // tegen model); alleen nog voor een aanroeper die geen brondata meegeeft.
    const allowed = extractGroundedNumbers(analysisOutput + " " + findings.map((f) => JSON.stringify(f)).join(" "));
    let flaggedNumbers = 0;
    recs = recs.map((rec) => {
      const gated = gateItemFields(rec, ["hypothesis", "expected_result"], allowed);
      if (gated.hadUngrounded) flaggedNumbers += gated.ungrounded.length;
      return gated.item;
    });
    tasks = tasks.map((task) => {
      const gated = gateItemFields(task, ["title", "description"], allowed);
      if (gated.hadUngrounded) flaggedNumbers += gated.ungrounded.length;
      return gated.item;
    });
    if (flaggedNumbers > 0) {
      console.warn(`[${sopType}] number-gate markeerde ${flaggedNumbers} ongegronde cijfers in aanbevelingen of taken`);
    }
  }

  // Downgrade direct_actions if data reliability is low/critical
  if (reliability && (reliability.overallConfidence === "critical" || reliability.overallConfidence === "low")) {
    for (const rec of recs) {
      const r = rec as Record<string, unknown>;
      if (r.action_readiness === "direct_action") {
        r.action_readiness = "investigate_first";
      }
    }
  }

  // ── Meetbaarheid van elk voorstel, bij het wegschrijven ──────────
  //
  // Niet pas maanden later in de evaluator: dan is het te laat om de tekst te verbeteren. Een
  // niet-meetbaar voorstel wordt niet weggegooid (het kan een goed idee zijn), maar staat er
  // zichtbaar als zodanig: de onderbouwing begint met de reden, en de metadata draagt de uitkomst.
  const meetbaarheden: Meetbaarheid[] = recs.map((r) => beoordeelMeetbaarheid({
    expectedResult: r.expected_result, measurementMetric: r.measurement_metric, timeframe: r.timeframe, bron: voorstelBron,
  }));
  const nietMeetbaar = meetbaarheden.filter((m) => !m.meetbaar).length;
  if (nietMeetbaar > 0) {
    waarschuwingen.push(`${nietMeetbaar} van de ${recs.length} voorstellen zijn niet meetbaar geformuleerd en staan zo gemarkeerd.`);
  }
  const rationaleMetMeetbaarheid = (rec: Recommendation, i: number): string =>
    meetbaarheden[i]?.meetbaar === false ? `${meetbaarheidTekst(meetbaarheden[i])} ${rec.rationale}` : rec.rationale;

  // ── Save to Supabase ─────────────────────────────────────────────

  let saved = false;
  let saveError: string | null = null;
  // Een insert die door de database geweigerd wordt gaf eerder gewoon saved: true, omdat alleen
  // data werd uitgelezen en nooit error. Nu breekt een weigering het opslaan af met de reden.
  const eis = <T>(uitkomst: { data: T | null; error: { message: string } | null }, wat: string): T | null => {
    if (uitkomst.error) throw new Error(`${wat}: ${uitkomst.error.message}`);
    return uitkomst.data;
  };

  if (findings.length > 0) {
    try {
      await onPhase?.("save_outputs", "Structured output opslaan...");
      // 1. Insert findings → sop_insights
      const insightRows = findings.map((f, i) => ({
        client_id: clientId,
        analysis_id: analysisId,
        sop_type: sopType,
        analysis_date: analysisDate,
        insight_type: f.insight_type,
        title: bevindingTitel(f, bevindingToetsen?.[i]),
        description: bevindingBeschrijving(f, bevindingToetsen?.[i]),
        severity: f.severity,
        affected_entity: f.entity_name,
        affected_entity_type: f.entity_type,
        metric: f.metric,
        current_value: f.current_value ?? null,
        previous_value: f.previous_value ?? null,
        change_pct: f.change_pct ?? null,
        is_seasonal: f.is_seasonal,
        is_structural: f.is_structural,
        action_required: f.action_required,
      }));

      const insertedInsights = eis(await supabase
        .from("sop_insights")
        .insert(insightRows)
        .select("id"), "inzichten opslaan");

      const insightIds = (insertedInsights ?? []).map((r: { id: string }) => r.id);

      // 2. Insert recommendations → sop_recommendations
      // finding_index komt uit de LLM en het schema legt er geen bereik op (z.number().int()).
      // Een index van 5 bij 2 bevindingen werd daardoor stil insight_id: null, en dan staat er
      // een aanbeveling in de database zonder de bevinding waar hij uit voortkomt. Juist die
      // koppeling is waar de rest van de tool op steunt om een advies te kunnen verantwoorden.
      let verbrokenKoppelingen = 0;
      const recRows = recs.map((rec, i) => {
        const findingIdx = rec.finding_index;
        const buitenBereik = findingIdx !== null && (findingIdx < 0 || findingIdx >= insightIds.length);
        if (buitenBereik) verbrokenKoppelingen += 1;
        return {
          client_id: clientId,
          analysis_id: analysisId,
          insight_id: findingIdx !== null && !buitenBereik ? insightIds[findingIdx] : null,
          sop_type: sopType,
          analysis_date: analysisDate,
          hypothesis: rec.hypothesis,
          expected_result: rec.expected_result,
          measurement_metric: rec.measurement_metric,
          timeframe: rec.timeframe,
          rationale: rationaleMetMeetbaarheid(rec, i),
          ice_impact: rec.ice_impact,
          ice_confidence: rec.ice_confidence,
          ice_ease: rec.ice_ease,
          ice_total: rec.ice_total,
          status: "open",
        };
      });

      if (verbrokenKoppelingen > 0) {
        logger.error(`[${sopType}] ${verbrokenKoppelingen} van de ${recs.length} aanbevelingen verwees naar een bevinding die niet bestaat (finding_index buiten bereik); die staan nu zonder koppeling in de database`);
      }

      const insertedRecs = eis(await supabase
        .from("sop_recommendations")
        .insert(recRows)
        .select("id"), "aanbevelingen opslaan");

      const recIds = (insertedRecs ?? []).map((r: { id: string }) => r.id);

      // 3. Insert tasks → sop_tasks
      // Zelfde verhaal voor de koppeling taak -> aanbeveling.
      let verbrokenTaakKoppelingen = 0;
      const taskRows = tasks.map((task) => {
        const recIdx = task.recommendation_index;
        if (recIdx < 0 || recIdx >= recIds.length) verbrokenTaakKoppelingen += 1;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + task.due_date_days);

        return {
          client_id: clientId,
          recommendation_id: recIds[recIdx] ?? null,
          sop_type: sopType,
          analysis_date: analysisDate,
          title: task.title,
          description: task.description,
          action_type: task.action_type,
          affected_campaign: task.affected_campaign,
          affected_adgroup: task.affected_adgroup,
          affected_keyword: task.affected_keyword,
          current_value: task.current_value,
          target_value: task.target_value,
          priority: task.priority,
          frequency: task.frequency,
          status: "open",
          due_date: dueDate.toISOString().split("T")[0],
        };
      });

      if (verbrokenTaakKoppelingen > 0) {
        logger.error(`[${sopType}] ${verbrokenTaakKoppelingen} van de ${tasks.length} taken verwees naar een aanbeveling die niet bestaat (recommendation_index buiten bereik)`);
      }

      const insertedTasks = eis(await supabase.from("sop_tasks").insert(taskRows).select("id"), "taken opslaan");
      const taskIds = (insertedTasks ?? []).map((r: { id: string }) => r.id);

      // Een nieuwe run van dezelfde soort sluit de vorige af. Zonder dit stapelde Bevindingen alle
      // runs op elkaar: 141 open aanbevelingen en 394 open taken bij demo-greentech, de top 20 uit
      // dertien verschillende runs, "demo3 pauzeren" zes keer. Wat nog open stond van een eerdere
      // run van deze sop_type krijgt status "vervangen"; in behandeling, afgerond of afgewezen
      // blijft staan, dat zijn genomen beslissingen. Faalt dit, dan blijft de run zelf geslaagd:
      // het is opruimwerk, en het staat in de waarschuwingen.
      const vervang = async (tabel: "sop_recommendations" | "sop_tasks", nieuw: string[]): Promise<void> => {
        let q = supabase.from(tabel).update({ status: "vervangen" })
          .eq("client_id", clientId).eq("sop_type", sopType).eq("status", "open");
        if (nieuw.length > 0) q = q.not("id", "in", `(${nieuw.join(",")})`);
        const { error } = await q;
        if (error) {
          logger.error(`[${sopType}] vorige ${tabel} afsluiten mislukt: ${error.message}`);
          waarschuwingen.push(`De open punten van de vorige ${sopType}-run konden niet als vervangen worden gemarkeerd (${error.message}).`);
        }
      };
      await vervang("sop_recommendations", recIds);
      await vervang("sop_tasks", taskIds);

      // 4. Hypothesis-sourced recs naar sprint_hypotheses.
      // SI6: dit liep als enige via een rauwe insert, terwijl second_opinion en
      // search_terms al saveProposalsReplacingPending gebruiken. Nu loopt alles via die
      // ene writer: dezelfde veilige semantiek (nieuwe rijen eerst inserten, oude pending
      // pas daarna opruimen, geaccepteerde voorstellen blijven altijd staan) en een
      // expliciete bron in plaats van de kolomdefault.
      const hypotheseRows: SprintHypothesisRow[] = recs
        .map((rec, i) => ({ rec, i }))
        .filter(({ rec }) => rec.source === "hypothesis")
        .map(({ rec, i }) => ({
          client_id: clientId,
          analysis_id: analysisId,
          hypothesis: rec.hypothesis,
          expected_result: rec.expected_result,
          measurement_metric: rec.measurement_metric,
          timeframe: rec.timeframe,
          rationale: rationaleMetMeetbaarheid(rec, i),
          ice_impact: rec.ice_impact,
          ice_confidence: rec.ice_confidence,
          ice_ease: rec.ice_ease,
          ice_total: rec.ice_total,
          status: "pending",
          source: voorstelBron,
          // Migratie 088 (metadata jsonb): wat de evaluator straks gaat meten, of waarom niet.
          metadata: { meetbaarheid: meetbaarheden[i] },
        }));
      await saveProposalsReplacingPending(supabase, clientId, voorstelBron, hypotheseRows);

      saved = true;
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
      logger.error(`[${sopType}] Failed to save structured data:`, saveError);
      waarschuwingen.push(`Opslaan van de bevindingen mislukte: ${saveError}`);
    }
  }

  if (recsResult.success && recsResult.dropped) {
    const wat = Object.entries(recsResult.dropped.counts).map(([k, v]) => `${v} ${k === "tasks" ? "taken" : "aanbevelingen"}`).join(" en ");
    waarschuwingen.push(`${wat} vielen af bij het inlezen.`);
  }

  return {
    findings,
    recommendations: recs,
    tasks,
    findingsParseOk: findingsResult.success,
    recsParseOk: recsResult.success,
    recsDropped: recsResult.success ? (recsResult.dropped ?? null) : null,
    findingsDropped,
    saved,
    saveError,
    steps,
    brondata,
    waarschuwingen,
  };
}
