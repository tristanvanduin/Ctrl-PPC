// Test voor de twee Decision Brief-documenten (masterplan 17.22). Deterministisch, geen IO --
// test de pure buildClientDecisionBrief()/buildAgencyPortfolioBrief(), niet de generate*()-
// functies die zelf Supabase aanroepen.
// Draaien: npx tsx lib/analysis/__decision_brief_test.ts

import {
  buildClientDecisionBrief, buildAgencyPortfolioBrief,
  renderClientDecisionBriefMarkdown, renderAgencyPortfolioBriefMarkdown,
  anonymizePatternText, wordCountForClientBrief, countWords, truncateWords,
  type ClientBriefInput, type AgencyRosterEntry,
} from "./decision-brief";
import type { FinalSopSynthesis, OperatingDetailLayer } from "./monthly-structured";
import type { PortfolioSynthesisResult } from "./portfolio-synthesis";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

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
      route, handeling: LANG_ZIN(40, `actie${i}`), object: `Object ${i}`, doel: "Doel",
      meet_via: "Metric", voorwaarde: "Voorwaarde", beslisregel: "Beslisregel", risico: "Risico",
    })),
    tasks: [],
    qa_self_check: { chosen_primary_thread: "gekozen", rejected_alternative_threads: [], why_score_estimate: why, actionability_score_estimate: actionability, red_flags_remaining: [] },
    markdown: "",
  };
}

function maakOperatingDetail(): OperatingDetailLayer {
  return {
    primary_thread_anchor: "", root_cause_anchor: "", evidence_trace: [], route_task_map: [],
    hypotheses_and_next_month_proof: [{
      id: "h1", title: "H1", label: "containment", hypothesis_number: 1, route: "containment",
      hypothesis: "hypothese", why_we_think_this: "reden", validation_or_exploitation_step: "stap",
      success_next_month: "succes", expected_change: "verandering", success_metrics: ["metric"], guardrail_metrics: [],
      evaluation_window: LANG_ZIN(10, "venster"), accept_if: LANG_ZIN(30, "accept"), reject_if: LANG_ZIN(30, "reject"),
      linked_primary_thread: "thread", linked_finding_ids: [], linked_recommendation_ids: [], linked_task_ids: [],
      status: "pending", rejected_reason: null, accepted_into_sprint: false,
    }],
    execution_detail: [], data_gaps_and_validation_notes: [], step_backed_rationale: [], markdown: "",
  };
}

console.log("Woordlimiet: elk veld wordt echt afgekapt op het klantdocument");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  const input: ClientBriefInput = { clientId: "c1", accountName: "Test-account", finalSop, operatingDetail: maakOperatingDetail() };
  const brief = buildClientDecisionBrief(input, { period: "Juli 2026" });

  check("primaryThread is afgekapt", countWords(brief.primaryThread) <= 15, String(countWords(brief.primaryThread)));
  check("primaryThread eindigt op afkap-teken", brief.primaryThread.endsWith("…"));
  check("totaal blijft onder de 120 woorden (excl. portfolio-context)", wordCountForClientBrief(brief) <= 120, String(wordCountForClientBrief(brief)));
}

console.log("\ntruncateWords: geen halve woorden");
{
  check("kort genoeg blijft ongewijzigd", truncateWords("een twee drie", 5) === "een twee drie");
  check("te lang wordt op woordgrens afgekapt", truncateWords("een twee drie vier vijf zes", 3) === "een twee drie…");
}

console.log("\nRoute-mapping: GRT-achtig (containment/recovery/controlled scale)");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  const input: ClientBriefInput = { clientId: "grt", accountName: "GRT", finalSop, operatingDetail: maakOperatingDetail() };
  const brief = buildClientDecisionBrief(input, { period: "Juli 2026" });
  check("containment gevuld", brief.sprintActions.containment !== null);
  check("validationRecovery valt terug op recovery", brief.sprintActions.validationRecovery !== null);
  check("controlledScale gevuld", brief.sprintActions.controlledScale !== null);
}

console.log("\nRoute-mapping: GRA/GRN-achtig (validation/containment/recovery, GEEN controlled scale)");
{
  const finalSop = maakFinalSop({ routes: ["validation", "containment", "recovery"] });
  const input: ClientBriefInput = { clientId: "gra", accountName: "GRA", finalSop, operatingDetail: maakOperatingDetail() };
  const brief = buildClientDecisionBrief(input, { period: "Juli 2026" });
  check("validationRecovery gebruikt validation", brief.sprintActions.validationRecovery !== null);
  check("controlledScale is NULL, niet verzonnen", brief.sprintActions.controlledScale === null);
  const md = renderClientDecisionBriefMarkdown(brief);
  check("markdown toont 'Niet gedefinieerd'", md.includes("Niet gedefinieerd"), md);
}

console.log("\nPrioriteit en fase: afgeleid uit bestaande velden, geen nieuwe scoring");
{
  const hoog = maakFinalSop({ routes: ["containment"], why: 9, actionability: 9 });
  const laag = maakFinalSop({ routes: ["validation"], why: 3, actionability: 2 });
  const briefHoog = buildClientDecisionBrief({ clientId: "a", accountName: "A", finalSop: hoog }, { period: "" });
  const briefLaag = buildClientDecisionBrief({ clientId: "b", accountName: "B", finalSop: laag }, { period: "" });
  check("hoge QA-score -> Hoog", briefHoog.priority === "Hoog");
  check("lage QA-score -> Laag", briefLaag.priority === "Laag");
  check("containment-route -> 'Beperking (rem)'-fase", briefHoog.phase === "Beperking (rem)");
  check("validation-route -> 'Validatie'-fase", briefLaag.phase === "Validatie");
}

console.log("\nGeen beslisregel verzonnen zonder operatingDetail");
{
  const finalSop = maakFinalSop({ routes: ["containment"] });
  const brief = buildClientDecisionBrief({ clientId: "c", accountName: "Zonder detail", finalSop }, { period: "" });
  check("decisionRule is null", brief.decisionRule === null);
  check("markdown meldt dat eerlijk", renderClientDecisionBriefMarkdown(brief).includes("Geen beslisregel beschikbaar"));
}

console.log("\nAnonimisering: een sibling-naam komt NOOIT in het klantdocument terecht");
{
  const roster: AgencyRosterEntry[] = [
    { clientId: "gra", accountName: "GreenTech Americas (GRA)" },
    { clientId: "grn", accountName: "GreenTech North America (GRN)" },
    { clientId: "grt", accountName: "GreenTech Amsterdam (GRT)" },
  ];
  const patroon = "GreenTech Americas (GRA) en GreenTech North America (GRN) delen dezelfde meetfout -- conversiewaarde ontbreekt.";
  const geanonimiseerd = anonymizePatternText(patroon, "grt", roster);
  check("geen 'GRA' meer in de tekst", !geanonimiseerd.includes("GRA"), geanonimiseerd);
  check("geen 'GRN' meer in de tekst", !geanonimiseerd.includes("GRN"), geanonimiseerd);
  check("de opeenvolgende vervangingen zijn samengevoegd tot 'gekoppelde accounts'", geanonimiseerd.toLowerCase().includes("gekoppelde accounts"), geanonimiseerd);

  const portfolio: PortfolioSynthesisResult = {
    headline: "", narrative: "",
    recurring_patterns: [patroon],
    outliers: [],
    synthesized_actions: [],
    clients_used: ["gra", "grn", "grt"],
    markdown: "",
  };
  const finalSop = maakFinalSop({ routes: ["containment"] });
  // GRT zelf komt niet voor in het patroon (dat gaat over GRA en GRN) -- hoort dus GEEN
  // portfolio-context te tonen, in plaats van 'm generiek te tonen voor een account waar het
  // patroon niet aantoonbaar over gaat.
  const briefGrt = buildClientDecisionBrief(
    { clientId: "grt", accountName: "GreenTech Amsterdam (GRT)", finalSop },
    { period: "", portfolio, agencyRoster: roster }
  );
  check("GRT zelf ziet geen portfolio-context (patroon gaat niet over GRT)", briefGrt.portfolioContext.length === 0, JSON.stringify(briefGrt.portfolioContext));

  const briefGra = buildClientDecisionBrief(
    { clientId: "gra", accountName: "GreenTech Americas (GRA)", finalSop },
    { period: "", portfolio, agencyRoster: roster }
  );
  check("GRA ziet wel portfolio-context (patroon gaat over GRA)", briefGra.portfolioContext.length === 1, JSON.stringify(briefGra.portfolioContext));
  check("die context noemt GRN nergens bij naam", !briefGra.portfolioContext.some((l) => l.includes("GRN") || l.includes("North America")), JSON.stringify(briefGra.portfolioContext));
  const mdGra = renderClientDecisionBriefMarkdown(briefGra);
  check("de gerenderde markdown van GRA bevat geen 'GRN' of 'North America'", !mdGra.includes("GRN") && !mdGra.includes("North America"), mdGra);
}

console.log("\nAgency Portfolio Brief: macro matrix + synthese, geen per-klant diagnose");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  finalSop.primary_thread = "Campagne: GRT | Search | NL mist vraag door budgetbeperking.";
  const clients: ClientBriefInput[] = [
    { clientId: "grt", accountName: "GreenTech Amsterdam (GRT)", finalSop, operatingDetail: maakOperatingDetail() },
  ];
  const portfolio: PortfolioSynthesisResult = {
    headline: "", narrative: "",
    recurring_patterns: ["gedeeld patroon X"],
    outliers: ["account Y wijkt af"],
    synthesized_actions: [{ clientId: "portfolio", clientName: "Hele portfolio", action: "verschuif geen budget van meetbaar naar onmeetbaar", rationale: "", priority: "hoog" }],
    clients_used: ["grt"],
    markdown: "",
  };
  const brief = buildAgencyPortfolioBrief("Testbureau", clients, portfolio, "2026-08-18");
  check("macroMatrix heeft 1 rij", brief.macroMatrix.length === 1);
  check("sharedBlockage gevuld", brief.portfolioSynthese?.sharedBlockage === "gedeeld patroon X");
  check("exception gevuld", brief.portfolioSynthese?.exception === "account Y wijkt af");
  check("portfolioWarning gevuld", brief.portfolioSynthese?.portfolioWarning?.includes("verschuif geen budget") === true);

  const md = renderAgencyPortfolioBriefMarkdown(brief);
  check("bevat 'Agency Portfolio Brief'", md.includes("# Agency Portfolio Brief"));
  check("bevat 'Macro Matrix'", md.includes("## Macro Matrix"));
  check("bevat GEEN per-klant Diagnose/Sprint-Acties-secties", !md.includes("## 1. Diagnose") && !md.includes("## 2. Sprint-Acties"));
  check("de pipe in de campagnenaam is geëscaped in de matrixregel", md.includes("GRT \\| Search \\| NL"), md);
  check("de onge-escapete vorm komt niet meer voor", !md.includes("GRT | Search | NL"));
  check("bevat geen stap-dump", !/stap 1\b|stap 13\b/i.test(md));
  check("bevat geen QA-scores of tokenaantallen", !/why.?score|actionability.?score|tokens?:/i.test(md));
}

console.log("\nKlantdocument-markdown volgt het gevraagde format letterlijk");
{
  const finalSop = maakFinalSop({ routes: ["containment", "recovery", "controlled scale"] });
  const brief = buildClientDecisionBrief(
    { clientId: "grt", accountName: "GreenTech Amsterdam (GRT)", finalSop, operatingDetail: maakOperatingDetail() },
    { period: "Juli 2026" }
  );
  const md = renderClientDecisionBriefMarkdown(brief);
  check("titel bevat de klantnaam", md.startsWith("# Decision Brief: GreenTech Amsterdam (GRT)"));
  check("metaregel bevat Periode/Fase/Prioriteit", md.includes("**Periode:**") && md.includes("**Fase:**") && md.includes("**Prioriteit:**"));
  check("bevat '## 1. Diagnose'", md.includes("## 1. Diagnose"));
  check("bevat '## 2. Sprint-Acties'", md.includes("## 2. Sprint-Acties"));
  check("bevat '## 3. Beslisregel & Falsificatie'", md.includes("## 3. Beslisregel & Falsificatie"));
  check("bevat geen macro-matrixtabel (dat hoort bij het bureaudocument)", !md.includes("| Account / Regio |"));
  check("bevat geen stap-dump", !/stap 1\b|stap 13\b/i.test(md));
  check("bevat geen QA-scores of tokenaantallen", !/why.?score|actionability.?score|tokens?:/i.test(md));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
