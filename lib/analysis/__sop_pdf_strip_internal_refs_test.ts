// Regressietest voor stripInternalRefs() (sop-pdf-renderer.ts), toegevoegd na klantfeedback op
// de eerste PDF-versie (19 aug 2026): interne stap-/taaknummering ("Steps 1, 6, 7, 13", "Tasks 1,
// 2", "uit stap 12") hoort niet in een klant-PDF -- dat is werkbenaming van de AI-pijplijn, geen
// informatie die een specialist iets zegt. Deze scrub draait op tekst uit finalSop en
// coverageMarkdown vlak voor render.
// Draaien: npx tsx lib/analysis/__sop_pdf_strip_internal_refs_test.ts

import { stripInternalRefs } from "./sop-pdf-renderer";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

console.log("1. 'uit stap N, M' wordt verwijderd zonder een weeswoord of dubbele punt achter te laten");
{
  const out = stripInternalRefs("account: gedekt (4 signalen uit stap 1, 6, 7, 13). Account- of doelstellingsanalyse.");
  check("geen 'stap' meer in de tekst", !/stap/i.test(out), out);
  check("geen dubbele spatie of losstaand 'uit' vlak voor de punt", !/\buit\)?\./i.test(out), out);
  check("leest nog grammaticaal correct", out === "account: gedekt (4 signalen). Account- of doelstellingsanalyse.", out);
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

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
