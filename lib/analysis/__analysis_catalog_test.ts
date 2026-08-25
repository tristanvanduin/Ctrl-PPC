// Test voor de analyse-catalogus. Draaien: npx tsx lib/analysis/__analysis_catalog_test.ts
//
// Twee soorten controle. De groepering is puur rekenwerk en wordt gewoon getest. Daarnaast
// staat er een consistentiecontrole tegen de routes: een catalogus die uit de pas loopt met de
// werkelijkheid is erger dan geen catalogus, want dan meldt de UI "nog niet gedraaid" voor een
// analyse die wél gedraaid heeft — de sectie waarop hij zoekt bestaat dan simpelweg niet.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ANALYSE_CATALOGUS, groepeerOpStatus, KANAAL_LABEL } from "./analysis-catalog";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── De catalogus zelf ──
const secties = ANALYSE_CATALOGUS.map((a) => a.section);
assert(new Set(secties).size === secties.length, "elke sectie komt maar één keer voor");
assert(ANALYSE_CATALOGUS.every((a) => a.titel.trim().length > 0), "elke analyse heeft een titel");
assert(ANALYSE_CATALOGUS.every((a) => a.waarover.trim().length > 0), "elke analyse zegt waar hij over gaat");
assert(ANALYSE_CATALOGUS.every((a) => a.kanaal in KANAAL_LABEL), "elk kanaal heeft een label");

// ── Groeperen op status ──
const runs = new Map<string, string>([
  ["google_funnel_v1", "2026-07-19"],
  ["cross_channel_v1", "2026-07-21"],
  ["meta_signals_v1", "2026-07-19"],
]);

const alles = groepeerOpStatus(runs);
assert(alles.uitgevoerd.length === 3, "drie gedraaide analyses komen in de uitgevoerd-groep");
assert(alles.uitgevoerd[0].section === "cross_channel_v1", "de recentste run staat bovenaan");
assert(alles.open.length === ANALYSE_CATALOGUS.length - 3, "de rest staat bij open");
assert(alles.open.every((a) => a.laatst === null), "open analyses hebben geen datum");
assert(alles.uitgevoerd.every((a) => a.laatst !== null), "uitgevoerde analyses hebben wel een datum");

// Gelijke datum: de catalogusvolgorde blijft staan (sort is stabiel), zodat de lijst niet
// tussen twee renders van volgorde wisselt.
const gelijk = groepeerOpStatus(new Map([["google_funnel_v1", "2026-07-19"], ["meta_signals_v1", "2026-07-19"]]));
assert(gelijk.uitgevoerd[0].section === "google_funnel_v1", "bij een gelijke datum wint de catalogusvolgorde");

const perKanaal = groepeerOpStatus(runs, "google");
assert(
  perKanaal.uitgevoerd.concat(perKanaal.open).every((a) => a.kanaal === "google"),
  "filteren op kanaal laat alleen dat kanaal over"
);
assert(perKanaal.uitgevoerd.length === 1, "van de drie runs valt er één onder Google");

const leeg = groepeerOpStatus(new Map());
assert(leeg.uitgevoerd.length === 0 && leeg.open.length === ANALYSE_CATALOGUS.length, "zonder runs staat alles bij open");

// ── Consistentie met de routes ──
// Elke sectie moet ergens door een route worden weggeschreven. De meeste routes hebben een
// letterlijke `const SECTION = "..."`; kpi-relations bouwt hem per kanaal op uit een template,
// en die drie staan hier expliciet met hun bouwsteen zodat de uitzondering zichtbaar blijft.
const ROUTES = join(process.cwd(), "app", "api", "analysis");
const routeBron = readdirSync(ROUTES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    try { return readFileSync(join(ROUTES, d.name, "route.ts"), "utf8"); } catch { return ""; }
  })
  .join("\n");

const UIT_TEMPLATE = new Map<string, string>([
  ["kpi_relations_google_v1", "`kpi_relations_${"],
  ["kpi_relations_meta_v1", "`kpi_relations_${"],
  ["kpi_relations_linkedin_v1", "`kpi_relations_${"],
  ["kpi_relations_microsoft_v1", "`kpi_relations_${"],
]);

for (const sectie of secties) {
  const template = UIT_TEMPLATE.get(sectie);
  const gevonden = template ? routeBron.includes(template) : routeBron.includes(`"${sectie}"`);
  assert(gevonden, `sectie ${sectie} wordt door een route weggeschreven`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
