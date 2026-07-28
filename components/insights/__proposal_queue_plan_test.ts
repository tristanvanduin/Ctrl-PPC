// De aansluiting tussen de goedkeuringswachtrij en de prioriteringskern. Geen IO, geen renderer.
// Draaien: npx tsx components/insights/__proposal_queue_plan_test.ts
//
// prioritizeQueue stond 97 regels lang gebouwd en getest in de codebase zonder ooit aangeroepen
// te worden — de module zei dat zelf: "STATUS: GEBOUWD EN GETEST, MAAR NOG NIET GEWIRED.
// Neem niet aan dat prioritering live is." De kern had dertien groene tests; wat ontbrak was de
// laag ertussen. Die staat hier onder test.
//
// Twee dingen die de wachtrij zonder deze laag niet deed:
//   1. Bij een gelijke ICE-totaalscore bepaalde de database de volgorde. Hetzelfde voorstel
//      stond dan de ene keer boven en de andere keer onder, zonder dat er iets veranderd was.
//   2. Een lijst van dertig voorstellen zei niets over wat er in de eerstvolgende sprint past.

import { planVoorWachtrij, type Proposal } from "./proposal-queue";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const v = (id: string, o: Partial<Proposal> = {}): Proposal => ({
  id, hypothesis: `hypothese ${id}`, expected_result: null, measurement_metric: null,
  timeframe: null, rationale: null, source: "zoekterm", created_at: "2026-07-01T00:00:00Z",
  ice_total: 5, ice_impact: 5, ice_confidence: 5, ice_ease: 5, ...o,
});
const volgorde = (p: { geordend: Proposal[] }) => p.geordend.map((x) => x.id).join(",");

// ── De volgorde is bepaald, niet toevallig ────────────────────────────────

console.log("De volgorde");
{
  const r = planVoorWachtrij([
    v("laag", { ice_total: 3 }),
    v("hoog", { ice_total: 9 }),
    v("midden", { ice_total: 6 }),
  ]);
  check("hoogste ICE bovenaan", volgorde(r) === "hoog,midden,laag", volgorde(r));
  check("de rang loopt vanaf 1", r.plaatsing.get("hoog")?.rank === 1, String(r.plaatsing.get("hoog")?.rank));
}
{
  // Gelijke totaalscore: dan beslist impact, daarna confidence, daarna ease. Zonder die
  // tie-breaks kwam hier de volgorde van de database uit.
  const r = planVoorWachtrij([
    v("weinig-impact", { ice_total: 7, ice_impact: 3, ice_confidence: 9, ice_ease: 9 }),
    v("veel-impact", { ice_total: 7, ice_impact: 9, ice_confidence: 3, ice_ease: 3 }),
  ]);
  check("bij gelijke score wint impact", volgorde(r) === "veel-impact,weinig-impact", volgorde(r));
}
{
  const r = planVoorWachtrij([
    v("b", { ice_total: 7, ice_impact: 5, ice_confidence: 2 }),
    v("a", { ice_total: 7, ice_impact: 5, ice_confidence: 8 }),
  ]);
  check("daarna confidence", volgorde(r) === "a,b", volgorde(r));
}
{
  // Volledig gelijk: dan de invoervolgorde, en niet iets willekeurigs. Twee keer draaien met
  // dezelfde invoer hoort hetzelfde te geven.
  const gelijk = [v("eerste"), v("tweede"), v("derde")];
  const a = planVoorWachtrij(gelijk);
  const b = planVoorWachtrij(gelijk);
  check("volledige gelijkstand houdt de invoervolgorde", volgorde(a) === "eerste,tweede,derde", volgorde(a));
  check("en is herhaalbaar", volgorde(a) === volgorde(b));
}

// ── De splitsing zegt wat er in de sprint past ────────────────────────────

console.log("\nSprint en backlog");
{
  const r = planVoorWachtrij(Array.from({ length: 8 }, (_, i) => v(`p${i}`, { ice_total: 9 - i })));
  check("vijf in de sprint", r.samenvatting.sprintCount === 5, String(r.samenvatting.sprintCount));
  check("de rest naar de backlog", r.samenvatting.backlogCount === 3, String(r.samenvatting.backlogCount));
  check("de eerste zit in de sprint", r.plaatsing.get("p0")?.placement === "sprint");
  check("de zesde in de backlog", r.plaatsing.get("p5")?.placement === "backlog",
    String(r.plaatsing.get("p5")?.placement));
}
{
  // Minder voorstellen dan capaciteit: dan hoort er geen backlog te zijn.
  const r = planVoorWachtrij([v("a"), v("b")]);
  check("geen backlog bij een korte wachtrij", r.samenvatting.backlogCount === 0);
  check("beide in de sprint", r.samenvatting.sprintCount === 2);
}

// ── De bronverdeling maakt overheersing zichtbaar ─────────────────────────

console.log("\nDe bronnen");
{
  const r = planVoorWachtrij([
    v("a", { source: "zoekterm" }), v("b", { source: "zoekterm" }),
    v("c", { source: "zoekterm" }), v("d", { source: "second-opinion" }),
  ]);
  check("de grootste bron staat vooraan", r.bronnen[0][0] === "zoekterm", JSON.stringify(r.bronnen));
  check("met het juiste aantal", r.bronnen[0][1] === 3, JSON.stringify(r.bronnen));
  check("en de kleinere erachter", r.bronnen[1][0] === "second-opinion", JSON.stringify(r.bronnen));
}
{
  const r = planVoorWachtrij([v("a", { source: null })]);
  check("een ontbrekende bron heet onbekend", r.bronnen[0][0] === "onbekend", JSON.stringify(r.bronnen));
}

// ── Randgevallen ──────────────────────────────────────────────────────────

console.log("\nRandgevallen");
{
  const r = planVoorWachtrij([]);
  check("een lege wachtrij geeft een leeg plan", r.geordend.length === 0 && r.samenvatting.sprintCount === 0);
  check("en geen bronnen", r.bronnen.length === 0);
}
{
  // Ontbrekende ICE-velden: een voorstel zonder score hoort onderaan, niet bovenaan.
  const r = planVoorWachtrij([
    v("zonder", { ice_total: null, ice_impact: null, ice_confidence: null, ice_ease: null }),
    v("met", { ice_total: 4 }),
  ]);
  check("een voorstel zonder score zakt naar onder", volgorde(r) === "met,zonder", volgorde(r));
}
{
  // Elk voorstel dat erin gaat moet er ook uit komen; er mag er geen stil wegvallen.
  const invoer = Array.from({ length: 12 }, (_, i) => v(`x${i}`, { ice_total: i % 4 }));
  const r = planVoorWachtrij(invoer);
  check("alle voorstellen komen terug", r.geordend.length === 12, String(r.geordend.length));
  check("zonder dubbelen", new Set(r.geordend.map((p) => p.id)).size === 12);
  check("en elk heeft een plaatsing", invoer.every((p) => r.plaatsing.has(p.id)));
  check("sprint plus backlog is het totaal",
    r.samenvatting.sprintCount + r.samenvatting.backlogCount === 12,
    `${r.samenvatting.sprintCount} + ${r.samenvatting.backlogCount}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
