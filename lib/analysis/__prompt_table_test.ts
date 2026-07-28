// Rijen naar een prompt-tabel. Deterministisch, geen IO.
// Draaien: npx tsx lib/analysis/__prompt_table_test.ts
//
// Deze helper bespaart tokens door de veldnamen niet per rij te herhalen. De valkuil daarbij is
// dat er onderweg betekenis verdwijnt. Twee dingen mogen daarom niet gebeuren:
//
//   1. `null` mag geen leeg vakje worden. Een model leest een leeg vakje als nul, en het verschil
//      tussen "gemeten nul" en "niets gemeten" is precies waar de aggregatie eerder de mist in
//      ging: een CPA zonder conversies is geen goedkope CPA.
//   2. Data die zich niet als tabel laat schrijven mag er niet in geperst worden. Dan is JSON
//      gewoon het juiste formaat.

import { toPromptTable, isTabelbaar, promptTableSection } from "./prompt-table";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// ── null blijft null ──────────────────────────────────────────────────────

console.log("null overleeft de omzetting");
{
  const t = toPromptTable([
    { adgroep: "A", cpa: 30, conversies: 10 },
    { adgroep: "B", cpa: null, conversies: 0 },
  ]);
  const regels = t.split("\n");
  const rijB = regels.find((r) => r.startsWith("B"))!;
  check("null staat er letterlijk", rijB.split("\t")[1] === "null", JSON.stringify(rijB));
  check("een gemeten nul blijft 0", rijB.split("\t")[2] === "0", JSON.stringify(rijB));
  check("nul en null zijn te onderscheiden", rijB.split("\t")[1] !== rijB.split("\t")[2]);
  check("er staat uitleg bij", /niet gemeten/.test(t), t.slice(0, 80));
}
{
  // Geen null in de data: dan is de uitleg ruis en hoort hij er niet te staan.
  const t = toPromptTable([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  check("zonder null geen uitleg", !/niet gemeten/.test(t), t);
  check("de kopregel is de eerste regel", t.split("\n")[0] === "a\tb", t.split("\n")[0]);
}

// ── De besparing ──────────────────────────────────────────────────────────

console.log("\nDe besparing");
{
  const rijen = Array.from({ length: 100 }, (_, i) => ({
    searchTerm: `greentech beurs amsterdam ${i}`, campaignName: "NL | Search | Generic | Exact",
    adGroupName: "Beurs tickets - exact", clicks: i, cost: i * 1.5, conversions: i % 4,
    conversionsValue: i * 12.5,
  }));
  const oud = JSON.stringify(rijen, null, 2).length;
  const nieuw = toPromptTable(rijen).length;
  check("ruim de helft korter", nieuw < oud * 0.5, `${oud} -> ${nieuw} tekens`);
  console.log(`  ${oud} tekens JSON -> ${nieuw} tekens tabel (${Math.round((1 - nieuw / oud) * 100)}% minder)`);

  // Geen enkele waarde mag onderweg verdwenen zijn.
  const regels = toPromptTable(rijen).split("\n");
  check("evenveel rijen als ingevoerd", regels.length === 101, String(regels.length));
  check("alle zeven kolommen", regels[0].split("\t").length === 7, regels[0]);
  check("de laatste rij is compleet", regels[100].split("\t").length === 7, regels[100]);
}

// ── Wat geen tabel is, wordt geen tabel ───────────────────────────────────

console.log("\nTerugval op JSON");
{
  check("een array van objecten is tabelbaar", isTabelbaar([{ a: 1 }]));
  check("een leeg array niet", !isTabelbaar([]));
  check("een enkel object niet", !isTabelbaar({ a: 1 }));
  check("geneste objecten niet", !isTabelbaar([{ a: { b: 1 } }]));
  check("een array in een cel niet", !isTabelbaar([{ a: [1, 2] }]));
  check("null als rij niet", !isTabelbaar([null]));
  check("een array van getallen niet", !isTabelbaar([1, 2, 3]));

  // Geneste data hoort onveranderd als JSON terug te komen, niet half platgeslagen.
  const genest = [{ naam: "x", details: { diep: 1 } }];
  const uit = toPromptTable(genest);
  check("geneste data blijft JSON", uit === JSON.stringify(genest), uit);
  check("maar wel compact", !/\n {2}/.test(uit));
}

// ── Ongelijke rijen ───────────────────────────────────────────────────────

console.log("\nRijen met verschillende velden");
{
  const t = toPromptTable([{ a: 1, b: 2 }, { a: 3, c: 4 }]);
  const regels = t.split("\n");
  check("alle sleutels worden kolommen", regels[0] === "a\tb\tc", regels[0]);
  check("een ontbrekend veld wordt een lege cel", regels[2] === "3\t\t4", JSON.stringify(regels[2]));
  // Ontbrekend en expliciet null zijn niet hetzelfde en mogen er niet hetzelfde uitzien.
  const met = toPromptTable([{ a: 1, b: null }, { a: 2 }]);
  const r = met.split("\n");
  check("ontbrekend en null zien er anders uit",
    r[r.length - 2].split("\t")[1] === "null" && r[r.length - 1].split("\t")[1] === "",
    JSON.stringify(r.slice(-2)));
}

// ── De kolomindeling mag niet breken ──────────────────────────────────────

console.log("\nWaarden die de indeling zouden breken");
{
  const t = toPromptTable([{ term: "regel\tmet\ttabs", naam: "twee\nregels" }]);
  const regels = t.split("\n");
  check("de tabel houdt één regel per rij", regels.length === 2, String(regels.length));
  check("en twee kolommen", regels[1].split("\t").length === 2, JSON.stringify(regels[1]));
}
{
  // Lege strings, nul, false: allemaal echte waarden die niet mogen verdwijnen.
  const t = toPromptTable([{ a: "", b: 0, c: false }]);
  const r = t.split("\n")[1].split("\t");
  check("nul blijft staan", r[1] === "0");
  check("false blijft staan", r[2] === "false");
}

// ── Afkappen gebeurt zichtbaar ────────────────────────────────────────────

console.log("\nAfkappen");
{
  const rijen = Array.from({ length: 50 }, (_, i) => ({ i }));
  const t = toPromptTable(rijen, { maxRijen: 10 });
  check("tien rijen plus kop", t.split("\n").filter((r) => /^\d+$/.test(r)).length === 10);
  check("het afkappen wordt gemeld", /40 van de 50 rijen niet getoond/.test(t), t.slice(-60));
  // Stil afkappen is het gevaarlijkste: dan denkt het model dat het alles gezien heeft.
  check("zonder limiet geen melding", !/niet getoond/.test(toPromptTable(rijen)));
}

// ── Het complete blok ─────────────────────────────────────────────────────

console.log("\npromptTableSection");
{
  const s = promptTableSection("Keyword Performance", [{ kw: "beurs", clicks: 10 }]);
  check("de titel staat erboven", s.startsWith("## Keyword Performance"), s.slice(0, 40));
  check("het blok is afgebakend", (s.match(/```/g) ?? []).length === 2, s);
  check("geen blok zonder rijen", promptTableSection("Leeg", []) === "");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
