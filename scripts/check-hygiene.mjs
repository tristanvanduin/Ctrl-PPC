// Hygiënecontrole: houdt tegen wat vandaag met de hand is opgeruimd.
//
// Deze sessie leverde drie dingen op die geen van alle door tsc, de tests of de build werden
// gezien, en die alle drie stilzwijgend teruggroeien zodra niemand kijkt:
//
//   1. Zeven kopieën van `median` in drie smaken, en vijf van `safeDiv` in drie gedragingen.
//      Het samenvoegen bracht twee echte fouten aan het licht (een MAD die twee keer te groot
//      was, en een deling die Infinity teruggaf). Niets hield tegen dat er een achtste bij kwam.
//   2. Modules die door niets worden geïmporteerd. Er lagen er elf, samen 1.473 regels, waarvan
//      924 aan ongebruikte UI-steiger.
//   3. Een letterlijke NUL-byte in lib/analysis/asset-breakdown.ts, waardoor elk tekstgereedschap
//      dat bestand als binair zag en grep het stilzwijgend oversloeg — inclusief de zoekopdracht
//      waarmee ik de median-kopieën inventariseerde. Die zevende vond ik pas bij toeval.
//
// Draaien: node scripts/check-hygiene.mjs

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename, dirname, normalize, relative } from "node:path";

const WORTELS = ["app", "lib", "components", "scripts"];

// ── Gedeelde hulpjes: één huis per begrip ──────────────────────────────────
//
// Deze namen horen op precies één plek te staan. Wie ze elders opnieuw definieert, maakt een
// tweede waarheid — en dat is geen stijlkwestie: de vorige keer verschilden de antwoorden.
const GEDEELD = {
  median: "lib/util/stats.ts",
  medianAbsoluteDeviation: "lib/util/stats.ts",
  safeDiv: "lib/util/math.ts",
  // ROAS werd op acht plekken los opgemaakt, in drie schrijfwijzen: "1.56", "1.56x" en "1,52×".
  // De eerste twee zijn in het Nederlands fout — de punt is hier het duizendtalteken — en in de
  // kaartenrij bovenaan stond "ROAS 1.56" naast "€ 91.890", waar diezelfde punt het andere
  // betekende. Eén huis, zodat de volgende plek hem niet opnieuw verzint.
  formatRoas: "lib/forecast-format.ts",
  // Er stonden twee sparklines, en ze verschilden op het enige punt dat telt: de basislijn. De ene
  // schaalde vanaf nul, de andere vanaf het laagste punt — dezelfde reeks is in de eerste een
  // rechte streep en in de tweede een steile klim. Nu één component waarin de aanroeper de
  // basislijn benoemt, zodat de vraag "vanaf nul of niet" per grootheid beantwoord wordt en niet
  // per toevallig gekozen kopie.
  Sparkline: "components/ui/sparkline.tsx",
  // Hetzelfde cijfer stond op zes plekken in vijf maten: text-figure, text-2xl, text-xl en twee
  // keer text-lg. Wie doorklikte van het overzicht naar een kanaal zag dezelfde soort getallen
  // ineens kleiner, zonder dat er iets aan hun belang veranderd was.
  Kerncijfer: "components/ui/kerncijfer.tsx",
  // De Nederlandse opsomming ("a, b en c") stond op drie plekken los uitgeschreven: bij de
  // kanaalnamen, in de maandanalyse en in de PMax-assetdekking. Nog geen fout — maar het is
  // exact het patroon waarmee median en safeDiv aan drie verschillende gedragingen kwamen, en
  // de vierde kopie is degene die het nét anders doet.
  opsomming: "lib/util/tekst.ts",
};

// ── Bestanden verzamelen ───────────────────────────────────────────────────

function loop(dir, uit = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return uit; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) loop(p, uit);
    else if (/\.tsx?$/.test(e) && !e.endsWith(".d.ts")) uit.push(p);
  }
  return uit;
}

const bestanden = WORTELS.flatMap((d) => loop(d));
const inhoud = new Map(bestanden.map((f) => [f, readFileSync(f, "utf8")]));
const isTest = (f) => basename(f).startsWith("__") || basename(f).includes(".test.");

const fouten = [];

// ── 1. Dubbele definities van gedeelde hulpjes ─────────────────────────────

for (const [naam, huis] of Object.entries(GEDEELD)) {
  const patroon = new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${naam}\\s*[(<]`, "m");
  for (const [f, tekst] of inhoud) {
    if (normalize(f) === normalize(huis)) continue;
    if (patroon.test(tekst)) {
      fouten.push(
        `${f}: eigen definitie van \`${naam}\`. Die hoort alleen in ${huis} te staan — ` +
        `twee versies van hetzelfde begrip gaven vorige keer verschillende antwoorden. ` +
        `Importeer hem, of pas de gedeelde versie aan als het gedrag echt moet veranderen.`
      );
    }
  }
}

// ── 2. Modules die door niets worden geïmporteerd ──────────────────────────

const SPEC = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
const doorProd = new Set();
for (const [f, tekst] of inhoud) {
  if (isTest(f)) continue;
  for (const m of tekst.matchAll(SPEC)) {
    const s = m[1];
    if (s.startsWith(".")) doorProd.add(normalize(join(dirname(f), s)));
    else if (s.startsWith("@/")) doorProd.add(normalize(s.slice(2)));
  }
}

// Next.js roept deze bestanden zelf aan; die hebben per definitie geen importeur.
const INGANGEN = new Set([
  "page.tsx", "layout.tsx", "route.ts", "error.tsx", "loading.tsx",
  "not-found.tsx", "global-error.tsx", "middleware.ts", "proxy.ts",
]);
const isIngang = (f) =>
  (f.startsWith("app/") && INGANGEN.has(basename(f))) ||
  f.startsWith("scripts/") ||
  INGANGEN.has(basename(f));

/**
 * Bekende wezen die mogen blijven staan, met de reden erbij. Deze lijst hoort te KRIMPEN.
 * Groeit hij, dan is er iets gebouwd dat nergens op aangesloten is — en dat is precies het
 * moment om te beslissen of het af moet of weg.
 */
const TOEGESTANE_WEZEN = new Map([
  // Wacht op een beslissing van de eigenaar.
  ["lib/analysis/dimensional-queries.ts",
    "queryhelpers die de routes al inline doen; voorstel is verwijderen"],
  ["components/dashboard/report-export.tsx",
    "gebouwde feature, nooit aangesloten; productbeslissing: afbouwen of weg"],

  // Wacht op toegang die er nog niet is: koppelingen, sleutels of een sync die niet gedraaid
  // kan worden. Aansluiten heeft pas zin als er data doorheen kan.
  ["lib/meta/sync.ts", "orkestratie gebouwd, HTTP-calls live-ongetest en gated op MDP-approval"],
  ["lib/notifications.ts", "webhook en alerts_log vergen de echte koppeling"],

  // Gebouwd en getest, wacht op een consument. Dit is de bak waar het meeste in zit; hij hoort
  // te krimpen. Zie het gesprek van 2026-07-28 voor de beoordeling per stuk.
  ["lib/analysis/contradiction-resolver.ts",
    "detecteert tegenstrijdige aanbevelingen op action_intent_class; is een VERVANGING van de " +
    "zwakkere regel 4 in action-gating.ts en van de clusterlogica in monthly-structured.ts, " +
    "geen toevoeging — daarom een aparte beslissing"],
  ["lib/cross-channel/funnel-overlap.ts",
    "lens 2; classifyFunnelRole leest het objective niet, dus Meta en LinkedIn komen als " +
    "onbekend uit de classificatie. Wacht op doelgroepdata (targeting_summary, Meta-adsets)"],
  ["lib/rai/edition-evaluation.ts", "editie-evaluatie op de event-relatieve tijdas; wacht op een plek in de beurs-UI"],
  ["lib/rai/event-status.ts", "stoplicht en budgetpacing per stream; zelfde plek als edition-evaluation"],
  ["lib/scheduler/pump-plan.ts", "hervatbare maandrun; wacht op runNextSteps, de IO-orkestratie"],
  ["lib/scheduler/core.ts", "hoort bij pump-plan"],
  ["lib/meta/vision/attribute-source.ts", "bewaakt dat kleurclaims uit de pixel-laag komen; wacht op de vision-pijplijn"],

  // NAGEKEKEN 2026-08-05. Deze drie stonden hier als "vermoedelijk ingehaald door een opvolger",
  // en dat hield geen van de drie stand. Ik heb de exports naast elkaar gelegd:
  //
  //   log.ts vs logger.ts        een RUN-logger met redactie (redactFields, buildLogRecord,
  //                              createRunLogger) naast een niveau-logger (setLogLevel, logger).
  //                              Verschillende dingen; logger.ts kan geen velden redigeren.
  //   errors.ts vs llm-error.ts  een algemene AppError met categorieen naast een classificatie
  //                              van LLM-fouten. Het tweede vervangt het eerste niet.
  //   campaign-analysis.ts vs    een regelmachine met findings, severity en ManualCheck naast
  //   comparison-facts.ts        maand-op-maand-vergelijkingen en benchmarks. Overlappend
  //                              domein, geen vervanging: comparison-facts kent geen bevindingen.
  //
  // Een verkeerde reden is erger dan geen reden: hij nodigt uit tot een verwijdering die iets
  // weghaalt wat nergens anders staat. Ze blijven dus staan, maar om de JUISTE reden -- gebouwd,
  // geen consument -- en dat is dezelfde categorie als het blok hierboven.
  ["lib/log.ts",
    "run-logger met redactie; lib/logger dekt dit NIET (die kent alleen niveaus). Wacht op een consument"],
  ["lib/errors.ts",
    "AppError met foutcategorieen; lib/analysis/llm-error classificeert alleen LLM-fouten en vervangt dit niet"],
  ["lib/campaign-analysis.ts",
    "regelmachine van 738 regels met findings/severity/ManualCheck, alleen door zijn eigen test " +
    "geraakt. comparison-facts.ts is GEEN opvolger: dat rekent vergelijkingen, geen bevindingen. " +
    "De vraag is of de prepared-context-pijplijn deze bevindingen al elders produceert"],
]);

for (const f of bestanden) {
  if (isTest(f) || isIngang(f)) continue;
  const stam = f.replace(/\.tsx?$/, "");
  if (doorProd.has(normalize(stam)) || doorProd.has(normalize(f))) continue;
  if (basename(stam) === "index" && doorProd.has(normalize(dirname(stam)))) continue;
  if (TOEGESTANE_WEZEN.has(f)) continue;

  const regels = inhoud.get(f).split("\n").length;
  const alleenTest = [...inhoud].some(([g, t]) =>
    isTest(g) && new RegExp(`["'][^"']*${basename(stam).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(t));
  fouten.push(
    `${f} (${regels} regels): wordt door geen enkele productiecode geïmporteerd` +
    (alleenTest ? ", alleen door een test" : "") +
    `. Sluit hem aan, verwijder hem, of zet hem met een reden in TOEGESTANE_WEZEN.`
  );
}

// ── 3. Stuurtekens die een bestand onvindbaar maken ────────────────────────

for (const f of bestanden) {
  const ruw = readFileSync(f);
  for (let i = 0; i < ruw.length; i++) {
    const b = ruw[i];
    if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) {
      fouten.push(
        `${f}: stuurteken 0x${b.toString(16).padStart(2, "0")} op positie ${i}. ` +
        `Daardoor ziet grep het bestand als binair en slaat het stilzwijgend over — ` +
        `schrijf het als escape (\\u0000) in plaats van als losse byte.`
      );
      break;
    }
  }
}

// ── Verslag ────────────────────────────────────────────────────────────────

if (fouten.length === 0) {
  console.log(`hygiëne in orde (${bestanden.length} bestanden gecontroleerd)`);
  process.exit(0);
}
console.error(`hygiëne: ${fouten.length} punt(en)\n`);
for (const f of fouten) console.error("  " + relative(process.cwd(), f).replace(/^/, "• "));
process.exit(1);
