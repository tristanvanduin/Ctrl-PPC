// Regressietests voor de PDF-template-optimalisaties (sop-pdf-renderer.ts), 19-20 augustus 2026:
// - stripInternalRefs(): interne stap-/taaknummering ("Steps 1, 6, 7, 13", "uit stap 12") hoort
//   niet in een klant-PDF -- dat is werkbenaming van de AI-pijplijn.
// - findConcreteEvidence()/formatEvidenceValue(): koppelt een taak aan de meest ernstige finding
//   op dezelfde entiteit voor een echt cijfer op de taakkaart, i.p.v. alleen de abstracte
//   beslisregel te herhalen -- zonder een cijfer te verzinnen als er geen match is.
// - parseCoverageLine(): parseert een coverage-appendix-regel terug naar velden voor de
//   2-koloms data-dekkingsgrid i.p.v. een lopend tekstblok.
// Draaien: npx tsx lib/analysis/__sop_pdf_strip_internal_refs_test.ts

import { stripInternalRefs, findConcreteEvidence, formatEvidenceValue, parseCoverageLine, type SopFinding } from "./sop-pdf-renderer";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

function finding(overrides: Partial<SopFinding>): SopFinding {
  return {
    title: "t", description: "d", severity: "medium", insight_type: "performance",
    affected_entity: "Campagne: GRT | Search | NL", affected_entity_type: "campaign",
    metric: "CPA", current_value: 100, previous_value: null, change_pct: null,
    action_required: true,
    ...overrides,
  };
}

console.log("1. 'uit stap N, M' wordt verwijderd zonder een weeswoord of dubbele punt achter te laten");
{
  const out = stripInternalRefs("account: gedekt (4 signalen uit stap 1, 6, 7, 13). Account- of doelstellingsanalyse.");
  check("geen 'stap' meer in de tekst", !/stap/i.test(out), out);
  check("geen dubbele spatie of losstaand 'uit' vlak voor de punt", !/\buit\)?\./i.test(out), out);
  check("leest nog grammaticaal correct", out === "account: gedekt (4 signalen). Account- of doelstellingsanalyse.", out);
}

console.log("\n1b. Een kop die met 'Stap N: ' begint verliest nummer EN dubbele punt in één keer");
{
  const out = stripInternalRefs("Stap 1: Account Health Check & Tracking");
  check("geen 'Stap' meer", !/stap/i.test(out), out);
  check("geen hangende dubbele punt vooraan", !out.startsWith(":"), out);
  check("titel blijft intact", out === "Account Health Check & Tracking", out);
}

console.log("\n2. 'Steps X, Y' en 'Tasks X, Y' (Engelse operatingDetail-vorm) worden verwijderd");
{
  const out = stripInternalRefs("R1 validation: Valideer de oorzaak | Tasks 1, 2 | Steps 1, 6, 7, 13");
  check("geen 'Steps' meer", !/steps?\s+\d/i.test(out), out);
  check("geen 'Tasks' meer", !/tasks?\s+\d/i.test(out), out);
}

console.log("\n3. Een losstaande '(stap N)' laat geen lege haakjes achter");
{
  const out = stripInternalRefs("Campagne combineert een hoge CPA (stap 12).");
  check("geen lege haakjes", !/\(\s*\)/.test(out), out);
  check("geen 'stap' meer", !/stap/i.test(out), out);
}

console.log("\n4. Tekst zonder stap-/taakverwijzingen blijft ongewijzigd (geen overijverige scrub)");
{
  const input = "Campagne: GRT | Search | NL mist vraag door budgetbeperking.";
  check("ongewijzigd", stripInternalRefs(input) === input, stripInternalRefs(input));
}

console.log("\n5. findConcreteEvidence() vindt de meest ernstige finding op dezelfde entiteit");
{
  const findings = [
    finding({ affected_entity: "Campagne: GRT | Search | NL", metric: "Search IS", current_value: 28, severity: "high" }),
    finding({ affected_entity: "Campagne: GRT | Search | NL", metric: "Spend", current_value: 550, severity: "critical" }),
    finding({ affected_entity: "Campagne: GRA | Search | US", metric: "CPA", current_value: 999, severity: "critical" }),
  ];
  const match = findConcreteEvidence({ object: "GRT | Search | NL", meet_via: "Search Lost IS (Budget)" }, findings);
  check("match gevonden", match !== null);
  check("kiest de kritieke finding op dezelfde entiteit, niet het andere account", match?.metric === "Spend" && match?.current_value === 550, JSON.stringify(match));
}

console.log("\n6. findConcreteEvidence() verzint niets als er geen entiteit-match is");
{
  const findings = [finding({ affected_entity: "Campagne: Onbekend", metric: "CPA", current_value: 1 })];
  const match = findConcreteEvidence({ object: "GRT | Search | NL", meet_via: "CPA" }, findings);
  check("geen match, geen fabricage", match === null);
}

console.log("\n7. formatEvidenceValue() geeft alleen een eenheid bij ondubbelzinnige metrics");
{
  check("Spend krijgt euro", formatEvidenceValue("Spend", 550) === "€550");
  check("ROAS krijgt x-suffix", formatEvidenceValue("ROAS", 3.85) === "3.85x");
  check("Search Lost IS krijgt GEEN verzonnen eenheid (schaal is inconsistent in de brondata)", formatEvidenceValue("Search Lost IS (Budget)", 28) === "28");
}

console.log("\n8. parseCoverageLine() parseert een coverage-appendix-regel naar velden");
{
  const row = parseCoverageLine("- campaign: gedekt (8 signalen uit stap 1, 2, 4, 7). Campagneperformance en portfolio-allocatie.");
  check("dimension geparsed", row?.dimension === "campaign", JSON.stringify(row));
  check("statusLabel geparsed", row?.statusLabel === "gedekt", JSON.stringify(row));
  check("detail bevat het signaalaantal", Boolean(row?.detail.includes("8 signalen")), JSON.stringify(row));
  check("note geparsed", row?.note === "Campagneperformance en portfolio-allocatie.", JSON.stringify(row));

  const noMatch = parseCoverageLine("Geen bullet-regel, dus geen match.");
  check("niet-matchende regel geeft null", noMatch === null);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
