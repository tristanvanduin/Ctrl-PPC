// Verificatie van build 3: misvormde beslisregels structureel gevangen,
// en de onmogelijke 8.5-score-poort verwijderd.
// Draaien: npx tsx lib/analysis/__qa_gate_recal_test.ts

// De echte validateFinalSopSynthesis. Hier stond een kopie van alleen de beslisregel-tak; nu gaat
// een minimale synthese door de hele validatie, en kijken de checks naar de fouten die over de
// beslisregel en de scores gaan. De overige structuurfouten (lege markdown, te weinig secties) horen
// bij deze minimale invoer en zijn hier niet het onderwerp.
import { validateFinalSopSynthesis, type FinalSopSynthesis } from "./monthly-structured";

function validateScores(opts: {
  recommendationRules: string[];
  taskRules: string[];
  whyScore: number;
  actionabilityScore: number;
}): string[] {
  const synthese = {
    primary_thread: "Het account verliest rendement in de landset Noord.",
    root_cause: "De landset Noord trekt budget zonder conversies.",
    supporting_evidence: ["a", "b", "c"],
    what_is_not_the_problem: [],
    recommendations: opts.recommendationRules.map((beslisregel, i) => ({
      route: "containment", handeling: `Verlaag budget ${i}`, object: `Campagne ${i}`, doel: "x", meet_via: "CPA",
      voorwaarde: "x", beslisregel, risico: "x",
    })),
    tasks: opts.taskRules.map((beslisregel, i) => ({
      linked_recommendation: 1, handeling: `Sluit zoekterm ${i} uit`, object: `Zoekterm ${i}`, meet_via: "CPA",
      voorwaarde: "x", beslisregel, risico: "x",
    })),
    qa_self_check: { why_score: opts.whyScore, actionability_score: opts.actionabilityScore, red_flags_remaining: [] },
    markdown: "",
  } as unknown as FinalSopSynthesis;
  return validateFinalSopSynthesis(synthese);
}

// Replica van de OUDE validatie-tak, puur voor contrast.
function oldValidateScores(opts: { whyScore: number; actionabilityScore: number }): string[] {
  const errors: string[] = [];
  if (opts.whyScore < 8.5) errors.push("Why-score below threshold");
  if (opts.actionabilityScore < 8.5) errors.push("Actionability-score below threshold");
  return errors;
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const malformed = "Continueer alleen als doorzetten alleen als de CPA onder 25 blijft";
const wellFormed = "Continueer als de CPA onder 25 euro blijft gedurende 2 weken";

console.log("\n1. De structurele check vangt een misvormde beslisregel (was eerder alleen in de score)");
{
  const errs = validateScores({ recommendationRules: [malformed], taskRules: [], whyScore: 8.4, actionabilityScore: 8.4 });
  check("misvormde regel levert een structurele fout", errs.includes("Malformed decision rule present"), errs.join(","));
}

console.log("\n2. Een nette beslisregel levert geen fout");
{
  const errs = validateScores({ recommendationRules: [wellFormed], taskRules: [wellFormed], whyScore: 8.4, actionabilityScore: 8.4 });
  check("nette regel: geen structurele fout", !errs.includes("Malformed decision rule present"), errs.join(","));
}

console.log("\n3. De eerlijke why-score van 8.4 levert GEEN fout meer (de onmogelijke poort is weg)");
{
  const nieuw = validateScores({ recommendationRules: [wellFormed], taskRules: [wellFormed], whyScore: 8.4, actionabilityScore: 8.4 });
  const oud = oldValidateScores({ whyScore: 8.4, actionabilityScore: 8.4 });
  console.log(`     nieuw aantal fouten = ${nieuw.length} | oud aantal fouten = ${oud.length} (${oud.join(", ")})`);
  check("nieuw: geen 'below threshold' fout bij eerlijke 8.4", !nieuw.some((e) => e.includes("below threshold")));
  check("oud: floorde-of-faalde, want 8.4 < 8.5 gaf altijd een fout", oud.includes("Why-score below threshold"));
}

console.log("\n4. Een misvormde regel wordt nu gevangen ZELFS als de score-poort weg is");
{
  const errs = validateScores({ recommendationRules: [], taskRules: [malformed], whyScore: 8.4, actionabilityScore: 6.2 });
  check("misvormde taakregel gevangen, ondanks verwijderde score-poort", errs.includes("Malformed decision rule present"));
  check("geen valse 'below threshold' op de eerlijke 6.2", !errs.some((e) => e.includes("below threshold")));
}

console.log(`\nRESULTAAT: ${passed} geslaagd, ${failed} gefaald`);
console.log("Kernpunt: detectie van de echte fout (misvormde regel) blijft, nu objectief structureel; de onmogelijke 8.5-poort die de pipeline zou breken is weg.\n");
if (failed > 0) process.exit(1);