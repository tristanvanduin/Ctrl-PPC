// Test voor het Decision Brief (masterplan 17.21). Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__decision_brief_test.ts

import {
  buildDecisionBrief, renderDecisionBriefMarkdown, wordCountForClientPlan, countWords, truncateWords,
  type ClientBriefInput,
} from "./decision-brief";
import type { FinalSopSynthesis, OperatingDetailLayer } from "./monthly-structured";
import type { PortfolioSynthesisResult } from "./portfolio-synthesis";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Opzettelijk LANGE brontekst -- de echte final_sop is voor specialisten geschreven en kan
// makkelijk 300+ woorden per veld bevatten. De woordlimiet moet dat echt afkappen, niet toevallig
// al kort brondata testen.
const LANG_ZIN = (n: number, woord = "woord") => Array.from({ length: n }, (_, i) => `${woord}${i + 1}`).join(" ") + ".";

function maakFinalSop(opts: {
  routes: Array<"validation" | "containment" | "recovery" | "controlled scale">;
  why?: number;
  actionability?: number;
}): FinalSopSynthesis {
  const { routes, why = 9, actionability = 9 } = opts;
  return {
    primary_thread: LANG_ZIN(40, "hoofddraad"),
    root_cause: LANG_ZIN(40, "oorzaak"),
    supporting_evidence: ["bewijs 1", "bewijs 2"],
    what_is_not_the_problem: [LANG_ZIN(40, "nietprobleem")],
    recommendations: routes.map((route, i) => ({
      route,
      handeling: LANG_ZIN(40, `actie${i}`),
      object: `Object ${i}`,
      doel: "Doel",
      meet_via: "Metric",
      voorwaarde: "Voorwaarde",
      beslisregel: "Beslisregel",
      risico: "Risico",
    })),
    tasks: [],
    qa_self_check: {
      chosen_primary_thread: "gekozen",
      rejected_alternative_threads: [],
      why_score_estimate: why,
      actionability_score_estimate: actionability,
      red_flags_remaining: [],
    },
    markdown: "",
  };
}

function maakOperatingDetail(): OperatingDetailLayer {
  return {
    primary_thread_anchor: "anchor",
    root_cause_anchor: "anchor",
    evidence_trace: [],
    route_task_map: [],
    hypotheses_and_next_month_proof: [{
      id: "h1", title: "H1", label: "containment", hypothesis_number: 1, route: "containment",
      hypothesis: "hypothese", why_we_think_this: "reden",
      validation_or_exploitation_step: "stap", success_next_month: "succes",
      expected_change: "verandering",
      success_metrics: ["metric"], guardrail_metrics: [],
      evaluation_window: LANG_ZIN(10, "venster"),
      accept_if: LANG_ZIN(30, "accept"),
      reject_if: LANG_ZIN(30, "reject"),
      linked_primary_thread: "thread", linked_finding_ids: [], linked_recommendation_ids: [],
      linked_task_ids: [], status: "pending", rejected_reason: null, accepted_into_sprint: false,
    }],
    execution_detail: [],
    data_gaps_and_validation_notes: [],
    step_backed_rationale: [],
    markdown: "",
  };
}

console.log("Woordlimiet: elk veld wordt echt afgekapt, niet toevallig kort");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  const operatingDetail = maakOperatingDetail();
  const input: ClientBriefInput = { accountName: "Test-account", finalSop, operatingDetail };
  const brief = buildDecisionBrief([input]);
  const plan = brief.clientActionPlans[0];

  check("primaryThread is afgekapt (bron had 40 woorden)", countWords(plan.primaryThread) <= 15, String(countWords(plan.primaryThread)));
  check("primaryThread eindigt op afkap-teken bij afkapping", plan.primaryThread.endsWith("…"));
  check("rootCause is afgekapt", countWords(plan.rootCause) <= 21, String(countWords(plan.rootCause)));
  check("totaal per klant blijft onder de 120 woorden", wordCountForClientPlan(plan) <= 120, String(wordCountForClientPlan(plan)));
}

console.log("\ntruncateWords: geen halve woorden, geen afkapping als het al past");
{
  check("kort genoeg blijft ongewijzigd", truncateWords("een twee drie", 5) === "een twee drie");
  check("te lang wordt op woordgrens afgekapt", truncateWords("een twee drie vier vijf zes", 3) === "een twee drie…");
}

console.log("\nRoute-mapping: containment/recovery/controlled scale (GRT-achtig scenario)");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  const input: ClientBriefInput = { accountName: "GRT", finalSop, operatingDetail: maakOperatingDetail() };
  const brief = buildDecisionBrief([input]);
  const plan = brief.clientActionPlans[0];
  check("containment gevuld", plan.sprintActions.containment !== null);
  check("validationRecovery valt terug op recovery (geen validation aanwezig)", plan.sprintActions.validationRecovery !== null);
  check("controlledScale gevuld", plan.sprintActions.controlledScale !== null);
}

console.log("\nRoute-mapping: validation/containment/recovery zonder controlled scale (GRA/GRN-achtig scenario)");
{
  // Exact het echte scenario uit de live testrun (masterplan 17.20): GRA/GRN hadden nooit een
  // 'controlled scale'-aanbeveling zolang de meting kapot was. Dat hoort NIET verzonnen te worden.
  const finalSop = maakFinalSop({ routes: ["validation", "containment", "recovery"] });
  const input: ClientBriefInput = { accountName: "GRA", finalSop, operatingDetail: maakOperatingDetail() };
  const brief = buildDecisionBrief([input]);
  const plan = brief.clientActionPlans[0];
  check("validationRecovery gebruikt validation (weegt zwaarder dan recovery)", plan.sprintActions.validationRecovery !== null);
  check("containment gevuld", plan.sprintActions.containment !== null);
  check("controlledScale is NULL, niet verzonnen", plan.sprintActions.controlledScale === null);

  const md = renderDecisionBriefMarkdown(brief);
  check("markdown toont 'Niet gedefinieerd' voor de ontbrekende controlled-scale-actie", md.includes("Niet gedefinieerd"), md);
}

console.log("\nPrioriteit: afgeleid uit qa_self_check, geen nieuwe scoring");
{
  const hoog = maakFinalSop({ routes: ["containment"], why: 9, actionability: 9 });
  const midden = maakFinalSop({ routes: ["containment"], why: 6, actionability: 5 });
  const laag = maakFinalSop({ routes: ["containment"], why: 3, actionability: 2 });
  const brief = buildDecisionBrief([
    { accountName: "A", finalSop: hoog },
    { accountName: "B", finalSop: midden },
    { accountName: "C", finalSop: laag },
  ]);
  check("hoge QA-score -> Hoog", brief.macroMatrix[0].priority === "Hoog");
  check("gemiddelde QA-score -> Midden", brief.macroMatrix[1].priority === "Midden");
  check("lage QA-score -> Laag", brief.macroMatrix[2].priority === "Laag");
}

console.log("\nFase: afgeleid uit de route van de eerste aanbeveling");
{
  const validatieEerst = maakFinalSop({ routes: ["validation", "containment"] });
  const containmentEerst = maakFinalSop({ routes: ["containment", "recovery"] });
  const brief = buildDecisionBrief([
    { accountName: "A", finalSop: validatieEerst },
    { accountName: "B", finalSop: containmentEerst },
  ]);
  check("validation-route -> 'Validatie'-fase", brief.macroMatrix[0].phase === "Validatie");
  check("containment-route -> 'Beperking (rem)'-fase", brief.macroMatrix[1].phase === "Beperking (rem)");
}

console.log("\nGeen beslisregel verzonnen als operatingDetail ontbreekt");
{
  const finalSop = maakFinalSop({ routes: ["containment"] });
  const brief = buildDecisionBrief([{ accountName: "Zonder detail", finalSop }]); // geen operatingDetail
  const plan = brief.clientActionPlans[0];
  check("decisionRule is null zonder operatingDetail", plan.decisionRule === null);
  const md = renderDecisionBriefMarkdown(brief);
  check("markdown meldt eerlijk dat er geen beslisregel is", md.includes("Geen beslisregel beschikbaar"));
}

console.log("\nPortfolio-synthese: aanwezig vs. afwezig, niets verzonnen");
{
  const finalSop = maakFinalSop({ routes: ["containment"] });
  const zonderPortfolio = buildDecisionBrief([{ accountName: "A", finalSop }]);
  check("portfolioSynthese is null zonder input", zonderPortfolio.portfolioSynthese === null);
  const mdZonder = renderDecisionBriefMarkdown(zonderPortfolio);
  check("markdown meldt eerlijk dat er geen cross-account-synthese is", mdZonder.includes("Geen cross-account-synthese"));

  const portfolio: PortfolioSynthesisResult = {
    headline: "kop", narrative: "verhaal",
    recurring_patterns: ["gedeeld patroon X"],
    outliers: ["account Y wijkt af"],
    synthesized_actions: [
      { clientId: "portfolio", clientName: "Hele portfolio", action: "verschuif geen budget van meetbaar naar onmeetbaar", rationale: "r", priority: "hoog" },
    ],
    clients_used: ["a"],
    markdown: "",
  };
  const metPortfolio = buildDecisionBrief([{ accountName: "A", finalSop }], portfolio);
  check("sharedBlockage gevuld uit recurring_patterns[0]", metPortfolio.portfolioSynthese?.sharedBlockage === "gedeeld patroon X");
  check("exception gevuld uit outliers[0]", metPortfolio.portfolioSynthese?.exception === "account Y wijkt af");
  check("portfolioWarning gevuld uit de 'portfolio'-actie", metPortfolio.portfolioSynthese?.portfolioWarning?.includes("verschuif geen budget") === true);
}

console.log("\nMarkdown-structuur volgt het gevraagde format letterlijk");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  const brief = buildDecisionBrief([{ accountName: "GRT", finalSop, operatingDetail: maakOperatingDetail() }]);
  const md = renderDecisionBriefMarkdown(brief);
  check("bevat 'DEEL 1: PORTFOLIO EXECUTIVE BRIEFING'", md.includes("DEEL 1: PORTFOLIO EXECUTIVE BRIEFING"));
  check("bevat 'DEEL 2: KLANT-ACTIEPLAN'", md.includes("DEEL 2: KLANT-ACTIEPLAN"));
  check("bevat de Macro Matrix-tabelkoppen", md.includes("| Account / Regio | Primaire Blokkade | Fase | Directe Kernactie | Prioriteit |"));
  check("bevat geen stap-dump ('Stap 1' of 'Stap 13')", !/stap 1\b|stap 13\b/i.test(md), "zou geen ruwe stapnummers moeten tonen");
  check("bevat geen QA-scores of tokenaantallen", !/why.?score|actionability.?score|tokens?:/i.test(md));
}

console.log("\nCampagnenamen met een letterlijke pipe ('GRT | Search | NL') breken de Markdown-tabel niet");
{
  // Live testrun 18 augustus 2026 (masterplan 17.20): elke echte GreenTech-campagnenaam bevat
  // pipe-tekens. Een ongeëscapte "|" in een tabelcel splitst 'm in extra kolommen -- gevonden bij
  // de eerste keer echt renderen met echte content, niet met verzonnen testnamen zonder pipe.
  const finalSop = maakFinalSop({ routes: ["containment"] });
  finalSop.primary_thread = "Campagne: GRT | Search | NL mist vraag door budgetbeperking.";
  finalSop.recommendations[0].handeling = "Beperk verdere schaal op GRT | Search | NL";
  const brief = buildDecisionBrief([{ accountName: "GreenTech Amsterdam (GRT)", finalSop }]);
  const md = renderDecisionBriefMarkdown(brief);
  const matrixLine = md.split("\n").find((l) => l.includes("GreenTech Amsterdam"));
  check("de pipe in de campagnenaam is geëscaped in de matrixregel", matrixLine?.includes("GRT \\| Search \\| NL") === true, matrixLine);
  check("de onge-escapete vorm komt nergens meer voor in de matrixregel", matrixLine?.includes("GRT | Search | NL") === false, matrixLine);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
