// Aanbevelingen "gesorteerd op ICE" staan in die volgorde en het totaal klopt met zijn delen
// (lib/ice-score.ts); een voorstel toont waar het vandaan komt en hoe oud het is
// (lib/voorstel-herkomst.ts).
// Draaien: tsx lib/__ice_en_voorstel_test.ts
//
// Tegenvoorbeelden uit de doorlichting van 13 november: "ICE 10 · I:9 C:8 E:7", "ICE 10 · I:8 C:6
// E:6", "ICE 9.3 · I:9 C:9 E:10" in die volgorde onder "gesorteerd op ICE score"; en zeven
// voorstellen van 26 augustus en 1 september zonder datum, met als bron "meta_biweekly".

import { iceUitDelen, getoondeIce, sorteerOpIce } from "./ice-score";
import { bronInGewoneTaal, ouderdom, VEROUDERD_NA_DAGEN } from "./voorstel-herkomst";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const rijen = [
  { id: "a", ice_total: 10, ice_impact: 9, ice_confidence: 8, ice_ease: 7 },
  { id: "b", ice_total: 10, ice_impact: 8, ice_confidence: 6, ice_ease: 6 },
  { id: "c", ice_total: 9.3, ice_impact: 9, ice_confidence: 9, ice_ease: 10 },
];
check("I:9 C:8 E:7 is 8,0, niet 10", getoondeIce(rijen[0]) === 8, String(getoondeIce(rijen[0])));
check("I:8 C:6 E:6 is 6,7, niet 10", getoondeIce(rijen[1]) === 6.7, String(getoondeIce(rijen[1])));
check("I:9 C:9 E:10 is 9,3", getoondeIce(rijen[2]) === 9.3);
const volgorde = sorteerOpIce(rijen).map((r) => r.id).join(",");
check("volgorde: 9,3 boven 8,0 boven 6,7", volgorde === "c,a,b", volgorde);
check("zonder delen het opgeslagen totaal", getoondeIce({ ice_total: 7.5 }) === 7.5);
check("een ontbrekend deel geeft geen totaal uit delen", iceUitDelen(9, null, 7) === null);

check("meta_biweekly in gewone taal", bronInGewoneTaal("meta_biweekly") === "Meta, tweewekelijkse analyse", bronInGewoneTaal("meta_biweekly"));
check("cross_channel in gewone taal", bronInGewoneTaal("cross_channel") === "cross-channel analyse");
check("biweekly zonder kanaal is Google", bronInGewoneTaal("biweekly") === "Google Ads, tweewekelijkse analyse");
check("zonder bron", bronInGewoneTaal(null) === "onbekende bron");

const nu = new Date("2026-11-13T10:00:00Z");
const o = ouderdom("2026-09-01T06:00:00Z", nu);
check("1 september is op 13 november 73 dagen oud", o?.dagen === 73, JSON.stringify(o));
check("en verouderd", o?.verouderd === true);
check("de datum staat erbij", !!o && o.datum.includes("2026") && o.datum.toLowerCase().includes("sep"), o?.datum);
const vers = ouderdom(new Date(nu.getTime() - (VEROUDERD_NA_DAGEN - 1) * 86_400_000).toISOString(), nu);
check("binnen een maandcyclus niet verouderd", vers?.verouderd === false);
check("zonder datum geen ouderdom", ouderdom(null, nu) === null);

// De goedkeuringswachtrij: hetzelfde totaal als Aanbevelingen, ook in de volgorde van het plan.
// Tegenvoorbeeld: opgeslagen 10.0 bij I:8 C:6 E:6 (dus 6,7) stond boven 9.3 bij I:9 C:9 E:10.
async function wachtrij() {
  const { planVoorWachtrij } = await import("../components/insights/proposal-queue");
  const basis = { expected_result: null, measurement_metric: null, timeframe: null, rationale: null, source: "sop_9", created_at: "2026-11-10T00:00:00Z", metadata: null };
  const { geordend, plaatsing } = planVoorWachtrij([
    { ...basis, id: "a", hypothesis: "A", ice_total: 10, ice_impact: 8, ice_confidence: 6, ice_ease: 6 },
    { ...basis, id: "b", hypothesis: "B", ice_total: 9.3, ice_impact: 9, ice_confidence: 9, ice_ease: 10 },
  ] as unknown as Parameters<typeof planVoorWachtrij>[0]);
  check("wachtrij: 9,3 uit de delen staat boven 6,7 uit de delen", geordend[0]?.id === "b", geordend.map((p) => p.id).join(","));
  const scoreA = plaatsing.get("a")?.score;
  check("wachtrij: de score van A is 6,7, niet het opgeslagen 10", scoreA === 6.7, String(scoreA));
}

wachtrij().then(() => {
  console.log(`ICE en voorstel: ${passed} geslaagd, ${failed} mislukt`);
  if (failed > 0) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });
