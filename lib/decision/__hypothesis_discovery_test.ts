// Legt de blueprint-regel vast: classificatie mag nooit blokkeren. Een hypothese die in geen
// enkele categorie past krijgt null, geen fout en geen gegokte categorie, en classify() laat de
// hypothese zelf onaangeroerd. Getest, niet beloofd.

import { classify, HYPOTHESIS_CATEGORIES } from "./hypothesis-discovery";
import type { Hypothesis } from "./types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("  x " + msg); } else { console.log("  v " + msg); }
}

const basis: Hypothesis = { agencyId: "a", accountId: "c", id: "h-1", statement: "" };

console.log("classify: hypothese buiten de lijst blokkeert niet:");
{
  const h: Hypothesis = { ...basis, statement: "De maan staat vandaag ongewoon helder aan de hemel." };
  const bevroren = JSON.parse(JSON.stringify(h));
  const uitkomst = classify(h);
  assert(uitkomst === null, "geen enkele categorie past: null, geen fout en geen gegokte waarde");
  assert(JSON.stringify(h) === JSON.stringify(bevroren), "classify() muteert de hypothese niet");
}

console.log("classify: matcht echt, geen fake happy path:");
{
  assert(classify({ ...basis, statement: "Het budget voor Search staat te laag afgesteld." }) === "budget", "trefwoord budget herkend");
  assert(classify({ ...basis, statement: "De doelgroep-targeting is te breed ingesteld." }) === "audience", "trefwoord doelgroep herkend");
  assert(classify({ ...basis, statement: "Black Friday nadert en de campagnes staan nog op de oude editie." }) === "event", "trefwoord event herkend");
}

console.log("classify: custom_pattern alleen als discovery hem al zo tagde, nooit als gok:");
{
  const getagd: Hypothesis = { ...basis, statement: "Iets ongewoons in de data.", category: "custom_pattern" };
  assert(classify(getagd) === "custom_pattern", "expliciet getagde custom_pattern wordt overgenomen");
  const nietGetagd: Hypothesis = { ...basis, statement: "Iets ongewoons in de data." };
  assert(classify(nietGetagd) === null, "zonder tag geen automatische custom_pattern-gok");
}

console.log("classify: een tag uit de gesloten lijst wint van de tekst, een vreemde tag niet:");
{
  assert(classify({ ...basis, statement: "Geen trefwoord hier.", category: "tracking" }) === "tracking", "getagde categorie wordt overgenomen zonder tekstmatch");
  assert(classify({ ...basis, statement: "Het budget staat te laag.", category: "onzin" }) === "budget", "vreemde tag wordt genegeerd, de tekst beslist");
}

console.log("HYPOTHESIS_CATEGORIES: gesloten lijst van twaalf, custom_pattern inbegrepen:");
{
  assert(HYPOTHESIS_CATEGORIES.length === 12, "twaalf categorieen, zoals de blueprint voorschrijft");
  assert(HYPOTHESIS_CATEGORIES.includes("custom_pattern"), "custom_pattern hoort bij de gesloten lijst, is geen ontsnapping eruit");
}

console.log(`\n${failed === 0 ? "Alle checks geslaagd." : `${failed} check(s) gefaald.`}`);
if (failed > 0) process.exit(1);
