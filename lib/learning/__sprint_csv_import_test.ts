// Test voor de gedeelde sprintplanning-CSV-import. Puur waar het kan (parseCsvRows,
// parseSprintCsv); de schrijvende kant (importSprintCsv) leunt op dbInsert en hoort bij de
// componenten die hem aanroepen, niet hier.
// Draaien: npx tsx lib/learning/__sprint_csv_import_test.ts

import { parseCsvRows, parseSprintCsv } from "./sprint-csv-import";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── CSV-ontleding met aanhalingstekens ──
const metQuotes = parseCsvRows('Taak,Hypothese\n"Budget verhogen, en A/B testen",De CPA daalt\nGewone taak,Andere hypothese');
assert(metQuotes.length === 2, "twee datarijen, header niet meegeteld");
assert(metQuotes[0]["Taak"] === "Budget verhogen, en A/B testen", "een komma binnen aanhalingstekens breekt de kolom niet");

const leeg = parseCsvRows("Taak,Hypothese");
assert(leeg.length === 0, "alleen een header levert geen rijen");

// ── Formaatdetectie: full (met Taak) ──
const volledig = parseSprintCsv(
  "Taak,Hypothese,Status,Metrics,Looptijd tot Beoordeling,Week,Verwacht Resultaat\n" +
  "Budget verhogen,De CPA daalt,To Do,CPA,4 weken,3,CPA daalt met 15%\n" +
  "Bod aanpassen,De CPA daalt,Klaar,CPA,4 weken,3,CPA daalt met 15%\n" +
  "Nieuwe taak,Andere hypothese,To Do,ROAS,2 weken,1,"
);
assert(volledig.format === "full", "een Taak-kolom levert het volledige formaat op");
assert(volledig.hypotheses.length === 2, "twee hypotheses uit drie taken, gegroepeerd op Hypothese");

const cpaHyp = volledig.hypotheses.find((h) => h.hypothesis === "De CPA daalt");
assert(cpaHyp !== undefined && cpaHyp.tasks.length === 2, "beide taken van dezelfde hypothese staan onder elkaar");
assert(cpaHyp !== undefined && cpaHyp.status === "accepted", "niet alle taken klaar: status blijft accepted, niet completed");
assert(cpaHyp !== undefined && cpaHyp.expectedResult === "CPA daalt met 15%", "de nieuwe kolom Verwacht Resultaat wordt gelezen");

const roasHyp = volledig.hypotheses.find((h) => h.hypothesis === "Andere hypothese");
assert(roasHyp !== undefined && roasHyp.expectedResult === null, "een lege Verwacht Resultaat-cel levert null, geen lege string");

// ── UX-behoud: een CSV zonder de nieuwe kolom importeert nog steeds ──
const zonderKolom = parseSprintCsv(
  "Taak,Hypothese,Status,Metrics,Looptijd tot Beoordeling,Week\n" +
  "Budget verhogen,De CPA daalt,To Do,CPA,4 weken,3\n"
);
assert(zonderKolom.format === "full" && zonderKolom.hypotheses.length === 1, "een CSV zonder Verwacht Resultaat-kolom importeert onveranderd");
assert(zonderKolom.hypotheses[0].expectedResult === null, "zonder de kolom is expected_result gewoon null, geen fout");

// ── Engelse kolomnaam werkt ook ──
const engels = parseSprintCsv(
  "Taak,Hypothese,Status,Expected Result\n" +
  "Budget verhogen,De CPA daalt,To Do,CPA drops by 15%\n"
);
assert(engels.hypotheses[0].expectedResult === "CPA drops by 15%", "Expected Result (Engels) wordt ook herkend");

// ── Formaatdetectie: hypotheses_only (geen Taak, wel Hypothese) ──
const alleenHyp = parseSprintCsv(
  "Hypothese,Metrics,Looptijd\n" +
  "De ROAS stijgt,ROAS,3 maanden\n" +
  ",,\n" +
  "<>,,\n" +
  "De CTR verbetert,CTR,2 maanden\n"
);
assert(alleenHyp.format === "hypotheses_only", "zonder Taak-kolom maar met Hypothese: het losse-voorstellen-formaat");
assert(alleenHyp.hypotheses.length === 2, "een lege rij en een rij met alleen opschoonbare tekens (<>) leveren geen hypothese op");
assert(alleenHyp.hypotheses.every((h) => h.status === "pending" && h.tasks.length === 0), "losse voorstellen zijn pending, zonder taken: ze horen eerst in de goedkeuringswachtrij");

// ── Regressie: sprint-planning.tsx's importCSV kon dit formaat eerder NIET importeren ──
// (de oude versie eiste altijd een Taak-kolom en filterde alle rijen weg). Nu wel.
assert(alleenHyp.hypotheses[0].hypothesis === "De ROAS stijgt", "het eerste voorstel komt overeen met de brontekst");

// ── Geen Taak en geen Hypothese: niets te importeren, geen crash ──
const nietsBruikbaars = parseSprintCsv("Kolom A,Kolom B\nwaarde,waarde\n");
assert(nietsBruikbaars.hypotheses.length === 0, "zonder Taak- of Hypothese-kolom levert de import niets op, geen foutmelding");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
