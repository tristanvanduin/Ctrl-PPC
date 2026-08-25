// Krijgen alle twaalf SOP-combinaties hun taakhistorie mee, of alleen sommige?
// Draaien: npx tsx lib/tasks/__taakgrounding_dekking_test.ts
//
// ── WAAROM DEZE TEST BESTAAT ────────────────────────────────────────────────
//
// buildTaskStatusGrounding had EEN aanroeper, en die stond ná de vroege branch in POST die Meta en
// LinkedIn naar hun eigen functie stuurt. Het blok zat dus in het Google-MAANDpad; de andere acht
// combinaties kwamen er nooit langs. De weekly en de bi-weekly bouwden ondertussen hun eigen halve
// versie -- wél het client-geheugen, geen taken -- en juist zij draaien het vaakst: een weekly die
// niet weet dat een taak is afgerond, beveelt hem 52 keer per jaar opnieuw aan.
//
// Dat is de vorm die in deze codebase blijft terugkomen -- de Google-monthly is stilzwijgend de
// norm -- en hij is onzichtbaar in de uitvoer: een analyse zonder taakhistorie ziet er precies zo
// uit als een analyse mét, alleen herhaalt hij zichzelf. Geen fout, geen lege array, niets dat een
// typechecker of een unit test opmerkt.
//
// ── WAAROM DEZE TEST DE BRON LEEST ──────────────────────────────────────────
//
// Wat hier fout kan gaan is BEDRADING, en bedrading is niet met een pure functie te toetsen: de
// vraag is niet of buildGeheugenMetTaken werkt maar of alle twaalf paden hem aanroepen. Een lijst
// "welk pad heeft het blok" zou hetzelfde probleem hebben als het probleem zelf -- hij zou
// verouderen zonder dat iemand het merkt. Daarom leest deze test de routes zoals
// lib/demo/__demo_sop_dekking_test.ts dat ook doet, en zoals scripts/check-hygiene.mjs de bron
// scant in plaats van een inventaris bij te houden.
//
// De tweede helft toetst gewoon gedrag: een klant zonder historie hoort een LEEG blok te krijgen,
// want alleen dan blijft de prompt byte-identiek aan wat hij was voordat dit bestond.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTaskStatusGrounding } from "./task-tracking";
import { toPriorTasks } from "./prior-tasks";
import { alsContextBlok, TAAKLIMIET } from "@/lib/analysis/geheugen-grounding";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const WORTEL = join(import.meta.dirname, "..", "..");
const lees = (p: string): string => readFileSync(join(WORTEL, p), "utf8");

// ── De twaalf kanaalpaden ───────────────────────────────────────────────────
//
// In de weekly en de bi-weekly heeft elk kanaal een eigen run*-functie. In de monthly hebben Meta,
// LinkedIn en Microsoft dat ook, maar Google draait inline in POST, ná de vroege returns -- daar
// is het stuk vanaf POST tot het einde van het bestand dus het Google-pad.
function stukVanaf(bron: string, start: string, eindes: string[]): string {
  const i = bron.indexOf(start);
  if (i < 0) return "";
  const grenzen = eindes.map((m) => bron.indexOf(m, i + start.length)).filter((n) => n > 0);
  return bron.slice(i, grenzen.length > 0 ? Math.min(...grenzen) : bron.length);
}

const WEEKLY = lees("app/api/analysis/weekly/route.ts");
const BIWEEKLY = lees("app/api/analysis/biweekly/route.ts");
const MONTHLY = lees("app/api/analysis/monthly/route.ts");

/** Pad -> [broncode, de sop_type-sleutel die het hoort mee te geven, de cadans]. */
const PADEN: Record<string, [string, string, string]> = {
  "weekly/google": [stukVanaf(WEEKLY, "async function runGoogleWeeklyAnalysis(", ["async function runMetaWeeklyAnalysis("]), "weekly", "weekly"],
  "weekly/meta": [stukVanaf(WEEKLY, "async function runMetaWeeklyAnalysis(", ["async function fetchLinkedinNameMap(", "async function runLinkedinWeeklyAnalysis("]), "meta_weekly", "weekly"],
  "weekly/linkedin": [stukVanaf(WEEKLY, "async function runLinkedinWeeklyAnalysis(", ["function withMicrosoftNames(", "async function runMicrosoftWeeklyAnalysis("]), "linkedin_weekly", "weekly"],
  "weekly/microsoft": [stukVanaf(WEEKLY, "async function runMicrosoftWeeklyAnalysis(", ["export async function POST("]), "microsoft_weekly", "weekly"],

  "biweekly/google": [stukVanaf(BIWEEKLY, "async function runGoogleBiWeeklyAnalysis(", ["async function runMetaBiWeeklyAnalysis("]), "biweekly", "biweekly"],
  "biweekly/meta": [stukVanaf(BIWEEKLY, "async function runMetaBiWeeklyAnalysis(", ["async function runLinkedinBiWeeklyAnalysis("]), "meta_biweekly", "biweekly"],
  "biweekly/linkedin": [stukVanaf(BIWEEKLY, "async function runLinkedinBiWeeklyAnalysis(", ["const withMicrosoftNames", "async function runMicrosoftBiWeeklyAnalysis("]), "linkedin_biweekly", "biweekly"],
  "biweekly/microsoft": [stukVanaf(BIWEEKLY, "async function runMicrosoftBiWeeklyAnalysis(", ["export async function POST("]), "microsoft_biweekly", "biweekly"],

  // De monthly geeft adapter.sopTypeKey mee in plaats van een literal: één lus bedient daar alle
  // kanalen via de adapter.
  "monthly/meta": [stukVanaf(MONTHLY, "async function runMetaMonthlyAnalysis(", ["async function runLinkedinMonthlyAnalysis("]), "adapter.sopTypeKey", "monthly"],
  "monthly/linkedin": [stukVanaf(MONTHLY, "async function runLinkedinMonthlyAnalysis(", ["async function runMicrosoftMonthlyAnalysis("]), "adapter.sopTypeKey", "monthly"],
  "monthly/microsoft": [stukVanaf(MONTHLY, "async function runMicrosoftMonthlyAnalysis(", ["export async function POST("]), "adapter.sopTypeKey", "monthly"],
  "monthly/google": [stukVanaf(MONTHLY, "export async function POST(", []), "adapter.sopTypeKey", "monthly"],
};

console.log("Alle twaalf paden zijn te vinden in hun route");
for (const [naam, [stuk]] of Object.entries(PADEN)) {
  // Faalt deze, dan is een route hernoemd of geherstructureerd en zeggen alle checks hieronder
  // niets meer -- een test die zijn eigen doelwit kwijt is hoort te falen, niet groen te blijven.
  check(`${naam}: pad gevonden`, stuk.length > 500, `${stuk.length} tekens`);
}

console.log("\nElk pad haalt het geheugenblok MET taken op");
for (const [naam, [stuk]] of Object.entries(PADEN)) {
  check(`${naam}: roept buildGeheugenMetTaken aan`, stuk.includes("buildGeheugenMetTaken("), "geen aanroep");
}
{
  // Eén definitie in lib, twaalf aanroepen in de routes. Was dit blok per pad gekopieerd, dan
  // gingen de kopieën uit elkaar lopen -- precies de median/safeDiv-les uit AGENTS.md, en hier kost
  // hij meer dan netheid: een achtergebleven kopie geeft die cadans stil minder context.
  const helper = lees("lib/analysis/geheugen-grounding.ts");
  check("één definitie, in lib", [...helper.matchAll(/export async function buildGeheugenMetTaken\(/g)].length === 1);
  const aanroepen = [WEEKLY, BIWEEKLY, MONTHLY]
    .map((b) => [...b.matchAll(/buildGeheugenMetTaken\(\{/g)].length)
    .reduce((a, b) => a + b, 0);
  check("twaalf aanroepen, één per combinatie", aanroepen === 12, String(aanroepen));
  for (const [naam, bron] of [["weekly", WEEKLY], ["biweekly", BIWEEKLY], ["monthly", MONTHLY]] as const) {
    check(`${naam}: geen eigen kopie van het blok meer`,
      !/buildClientMemoryGrounding\(/.test(bron),
      "bouwt zijn geheugenblok nog zelf");
  }
}

console.log("\nElk pad begrenst de taken tot zijn EIGEN kanaal en cadans");
for (const [naam, [stuk, sopType, cadans]] of Object.entries(PADEN)) {
  const m = stuk.match(/buildGeheugenMetTaken\(\{([^}]*)\}/);
  const argumenten = m ? m[1] : "";
  // De sleutel van dit kanaal, niet die van een ander en niet een gedeelde. Zonder deze check kan
  // een copy-paste de Meta-weekly Google's taken geven -- dezelfde vermenging in een nieuwe jas.
  check(`${naam}: sopType ${sopType}`, argumenten.includes(sopType), argumenten.trim());
  check(`${naam}: cadans ${cadans}`, new RegExp(`cadans:\\s*"${cadans}"`).test(argumenten), argumenten.trim());
}
{
  // Geen enkel pad mag de sleutel van een ander kanaal dragen.
  for (const [naam, [stuk, sopType]] of Object.entries(PADEN)) {
    if (sopType === "adapter.sopTypeKey") continue; // de monthly gaat via de adapter
    const m = stuk.match(/buildGeheugenMetTaken\(\{([^}]*)\}/);
    const arg = m ? m[1] : "";
    const anderen = Object.values(PADEN)
      .map(([, s]) => s)
      .filter((s) => s !== sopType && s !== "adapter.sopTypeKey" && !sopType.includes(s) && !s.includes(sopType));
    check(`${naam}: draagt geen vreemde sleutel`, !anderen.some((a) => arg.includes(`"${a}"`)), arg.trim());
  }
}

console.log("\nDe weekly en de bi-weekly krijgen een kortere lijst dan de monthly");
{
  // Niet één getal voor alles: de weekly-prompt is expliciet "geen diepe analyse" en draagt al een
  // maand-handoff en een openstaande-punten-blok. De ORDENING is wat telt, niet het exacte getal --
  // die mag verschuiven, maar een weekly met evenveel taakhistorie als een monthly is een fout.
  check("weekly korter dan biweekly", TAAKLIMIET.weekly < TAAKLIMIET.biweekly, JSON.stringify(TAAKLIMIET));
  check("biweekly korter dan monthly", TAAKLIMIET.biweekly < TAAKLIMIET.monthly, JSON.stringify(TAAKLIMIET));
  check("monthly houdt zijn oude 40", TAAKLIMIET.monthly === 40, String(TAAKLIMIET.monthly));
  check("elke limiet is bruikbaar groot", Object.values(TAAKLIMIET).every((n) => n >= 10), JSON.stringify(TAAKLIMIET));
}

console.log("\nDe weekly en bi-weekly zetten het blok als eigen blok in de keten");
{
  // Hun sharedContext plakt blokken achter elkaar ZONDER scheiding, dus draagt elk blok zijn eigen
  // voorloop. buildClientMemoryGrounding deed dat als enige niet, waardoor zijn kop op dezelfde
  // regel belandde als het laatste opsommingsteken ervoor -- en een `##` middenin een regel is geen
  // kop meer. De monthly gebruikt alsContextBlok NIET: buildMonthlyStepPrompt zet er zelf al één voor.
  check("weekly wikkelt in alsContextBlok", [...WEEKLY.matchAll(/alsContextBlok\(/g)].length === 4,
    String([...WEEKLY.matchAll(/alsContextBlok\(/g)].length));
  check("biweekly wikkelt in alsContextBlok", [...BIWEEKLY.matchAll(/alsContextBlok\(/g)].length === 4,
    String([...BIWEEKLY.matchAll(/alsContextBlok\(/g)].length));
  check("de monthly doet dat juist niet", !MONTHLY.includes("alsContextBlok"));

  check("een leeg blok blijft leeg", alsContextBlok("") === "");
  check("een gevuld blok krijgt een lege regel", alsContextBlok("## Kop") === "\n\n## Kop");
  // Dit is de fout zelf, uitgeschreven: zonder de wikkel plakt de kop aan de vorige regel vast.
  const zonder = `- laatste bullet${"## Kop"}`;
  const met = `- laatste bullet${alsContextBlok("## Kop")}`;
  check("zonder wikkel plakt de kop vast", /bullet## Kop/.test(zonder));
  check("met wikkel staat hij op zijn eigen regel", /\n## Kop$/.test(met), JSON.stringify(met));
}

console.log("\nEen klant zonder historie houdt een byte-identieke prompt");
{
  // De eigenschap waar de hele vorm op staat: de promptbouwers laten een leeg blok weg, dus zolang
  // beide bronnen leeg zijn verandert er niets. Zou buildTaskStatusGrounding bij nul taken iets als
  // "Geen taken bekend" teruggeven, dan kregen álle klanten zonder historie ineens een andere
  // prompt -- en dat is precies wat de prefix-cache breekt.
  check("geen taken geeft een leeg blok", buildTaskStatusGrounding([]) === "");
  check("rijen zonder titel ook", buildTaskStatusGrounding(toPriorTasks([{ status: "open" }])) === "");
  check("twee lege bronnen geven een lege string", ["", ""].filter(Boolean).join("\n\n") === "");

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
