// Krijgen alle drie de maandkanalen hun taakhistorie mee, of alleen Google?
// Draaien: npx tsx lib/tasks/__taakgrounding_dekking_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// buildTaskStatusGrounding had EEN aanroeper, en die stond ná de vroege branch in POST die Meta en
// LinkedIn naar hun eigen functie stuurt. Het blok zat dus in het Google-pad en Meta en LinkedIn
// kwamen er nooit langs: hun maandanalyse begon elke keer met een schone lei over wat er vorige
// cyclus is uitgevoerd, en beval opnieuw aan wat er al gedaan was.
//
// Dat is de vorm die in deze codebase blijft terugkomen -- de Google-variant is stilzwijgend de
// norm -- en hij is onzichtbaar in de uitvoer: een analyse zonder taakhistorie ziet er precies zo
// uit als een analyse mét, alleen herhaalt hij zichzelf. Geen fout, geen lege array, niets dat een
// typechecker of een unit test opmerkt.
//
// ── WAAROM DEZE TEST DE BRON LEEST ──────────────────────────────────────────
//
// Wat hier fout kan gaan is BEDRADING, en bedrading is niet met een pure functie te toetsen: de
// vraag is niet of buildGeheugenMetTaken werkt maar of alle drie de paden hem aanroepen. Een lijst
// "welk pad heeft het blok" zou hetzelfde probleem hebben als het probleem zelf -- hij zou
// verouderen zonder dat iemand het merkt. Daarom leest deze test de route zoals
// lib/demo/__demo_sop_dekking_test.ts dat ook doet, en zoals scripts/check-hygiene.mjs de bron
// scant in plaats van een inventaris bij te houden.
//
// De tweede helft toetst wel gewoon gedrag: een klant zonder historie hoort een LEEG blok te
// krijgen, want alleen dan blijft de prompt byte-identiek aan wat hij was voordat dit bestond.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTaskStatusGrounding } from "./task-tracking";
import { toPriorTasks } from "./prior-tasks";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const WORTEL = join(import.meta.dirname, "..", "..");
const ROUTE = "app/api/analysis/monthly/route.ts";
const bron = readFileSync(join(WORTEL, ROUTE), "utf8");

// ── De drie kanaalpaden ─────────────────────────────────────────────────────
//
// Meta en LinkedIn hebben elk een eigen functie; Google draait inline in POST, ná de twee vroege
// returns. Het stuk van POST tot het einde van het bestand is dus het Google-pad.
function stukVanaf(startMarkering: string, eindMarkeringen: string[]): string {
  const i = bron.indexOf(startMarkering);
  if (i < 0) return "";
  const eindes = eindMarkeringen.map((m) => bron.indexOf(m, i + startMarkering.length)).filter((n) => n > 0);
  return bron.slice(i, eindes.length > 0 ? Math.min(...eindes) : bron.length);
}

const PADEN: Record<string, string> = {
  meta: stukVanaf("async function runMetaMonthlyAnalysis(", ["async function runLinkedinMonthlyAnalysis("]),
  linkedin: stukVanaf("async function runLinkedinMonthlyAnalysis(", ["export async function POST("]),
  google: stukVanaf("export async function POST(", []),
};

console.log("De drie kanaalpaden zijn te vinden in de route");
for (const [naam, stuk] of Object.entries(PADEN)) {
  // Faalt deze, dan is de route hernoemd of geherstructureerd en zeggen alle checks hieronder
  // niets meer -- een test die zijn eigen doelwit kwijt is hoort te falen, niet groen te blijven.
  check(`${naam}: pad gevonden`, stuk.length > 500, `${stuk.length} tekens`);
}

console.log("\nElk pad haalt het geheugenblok MET taken op");
for (const [naam, stuk] of Object.entries(PADEN)) {
  check(`${naam}: roept buildGeheugenMetTaken aan`, stuk.includes("buildGeheugenMetTaken("),
    "geen aanroep gevonden");
}
{
  // Precies één definitie en drie aanroepen. Was dit blok per pad gekopieerd, dan zouden ze uit
  // elkaar gaan lopen -- precies de median/safeDiv-les uit AGENTS.md.
  const definities = [...bron.matchAll(/async function buildGeheugenMetTaken\(/g)].length;
  const aanroepen = [...bron.matchAll(/await buildGeheugenMetTaken\(/g)].length;
  check("één definitie", definities === 1, String(definities));
  check("drie aanroepen, één per kanaal", aanroepen === 3, String(aanroepen));
}

console.log("\nElk pad begrenst de taken tot zijn EIGEN kanaal");
for (const [naam, stuk] of Object.entries(PADEN)) {
  // adapter.sopTypeKey en geen literal: de adapter draagt het kanaal van deze run, dus dit is de
  // enige vorm die bij alle drie klopt. Een hardgecodeerde "monthly" zou Meta en LinkedIn stil
  // Google's taken geven -- dezelfde vermenging in een nieuwe jas.
  const m = stuk.match(/buildGeheugenMetTaken\(([^)]*)\)/);
  const argumenten = m ? m[1] : "";
  check(`${naam}: geeft adapter.sopTypeKey mee`, argumenten.includes("adapter.sopTypeKey"), argumenten);
  check(`${naam}: geen hardgecodeerd sop_type`, !/"(?:meta_|linkedin_)?(?:weekly|biweekly|monthly)"/.test(argumenten), argumenten);
}

console.log("\nGeen pad stuurt nog het kale geheugenblok naar de prompt");
{
  // clientMemorySection hoort alleen nog binnen buildGeheugenMetTaken te bestaan. Duikt de naam
  // elders op, dan is er een pad dat het geheugen wél en de taken níet meestuurt -- exact de
  // toestand van vóór deze wijziging.
  const voorkomens = [...bron.matchAll(/clientMemorySection/g)].length;
  const helper = stukVanaf("async function buildGeheugenMetTaken(", ["// M2 route-wiring"]);
  const inHelper = [...helper.matchAll(/clientMemorySection/g)].length;
  check("clientMemorySection bestaat alleen nog in de helper", voorkomens === inHelper,
    `${voorkomens} in het bestand, ${inHelper} in de helper`);
}
{
  // Elke buildMonthlyStepPrompt-aanroep die een geheugenargument meegeeft, geeft het gecombineerde
  // blok mee. Dit is de check die het oorspronkelijke gat zou hebben gevangen.
  const aanroepen = [...bron.matchAll(/buildMonthlyStepPrompt\(/g)].length;
  const metTaken = [...bron.matchAll(/geheugenMetTaken/g)].length;
  check("buildMonthlyStepPrompt wordt op meerdere plekken aangeroepen", aanroepen >= 3, String(aanroepen));
  check("en geheugenMetTaken komt overal terug", metTaken >= aanroepen,
    `${metTaken} keer geheugenMetTaken tegen ${aanroepen} promptaanroepen`);
}

console.log("\nEen klant zonder historie houdt een byte-identieke prompt");
{
  // De eigenschap waar de hele vorm op staat: buildMonthlyStepPrompt laat een leeg blok weg, dus
  // zolang beide bronnen leeg zijn verandert er niets aan de prompt. Zou buildTaskStatusGrounding
  // bij nul taken iets als "Geen taken bekend" teruggeven, dan kregen álle klanten zonder
  // historie ineens een andere prompt -- en dat is precies wat de prefix-cache breekt.
  check("geen taken geeft een leeg blok", buildTaskStatusGrounding([]) === "");
  check("rijen zonder titel ook", buildTaskStatusGrounding(toPriorTasks([{ status: "open" }])) === "");
  const gecombineerd = ["", ""].filter(Boolean).join("\n\n");
  check("twee lege bronnen geven een lege string", gecombineerd === "", JSON.stringify(gecombineerd));

  // En andersom: is er wél historie, dan staat hij er ook echt in. Anders zou een test die alleen
  // op leegte controleert groen blijven bij een blok dat nooit iets bevat.
  const metHistorie = buildTaskStatusGrounding(toPriorTasks([
    { title: "Bod verlagen Generic BE", status: "completed", affected_campaign: "Generic BE" },
    { title: "Negatieve zoektermen toevoegen", status: "open" },
  ]));
  check("met taken is het blok niet leeg", metHistorie.length > 0);
  check("en noemt de afgeronde taak", metHistorie.includes("Bod verlagen Generic BE"), metHistorie.slice(0, 200));
  check("en de openstaande", metHistorie.includes("Negatieve zoektermen toevoegen"), metHistorie.slice(0, 200));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
