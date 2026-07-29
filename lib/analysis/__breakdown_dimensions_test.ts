// Test voor de uitsplitsingen van Meta en LinkedIn.
// Draaien: npx tsx lib/analysis/__breakdown_dimensions_test.ts
//
// De kern van deze test: elke dimensie die de UI als knop aanbiedt moet in de demo ook echt
// rijen hebben. Dat ging eerder mis — industrie en bedrijfsgrootte stonden wél in de
// vertaaltabel van de structuur-analyse, maar er waren geen demo-rijen, dus die twee dimensies
// bleven in de demo altijd leeg zonder dat iets dat meldde.

import { BREAKDOWN_DIMENSIES, metaWaardeLabel } from "./breakdown-dimensions";
import { demoRows } from "@/lib/demo/demo-rows";
import { buildNetworkSplit, networkTotals, type NetworkRow } from "@/lib/pmax/network-split";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

const rijen = demoRows() as unknown as Record<string, Record<string, unknown>[]>;

// ── Labels ──
assert(metaWaardeLabel("audience_network") === "Audience Network", "een bekende enum-waarde krijgt een leesbare naam");
assert(metaWaardeLabel("reels") === "Reels", "plaatsingen zijn vertaald");
assert(metaWaardeLabel("nieuw_kanaal_2027") === "nieuw_kanaal_2027", "een onbekende waarde houdt zijn eigen naam");

// ── Elke aangeboden dimensie heeft demo-data ──
const metaTypes = new Set((rijen.meta_breakdown_daily ?? []).map((r) => String(r.breakdown_type)));
for (const d of BREAKDOWN_DIMENSIES.meta) {
  assert(metaTypes.has(d.key), `Meta-dimensie ${d.key} (${d.label}) heeft demo-rijen`);
}

const liPivots = new Set((rijen.linkedin_demographic_daily ?? []).map((r) => String(r.pivot_type)));
for (const d of BREAKDOWN_DIMENSIES.linkedin) {
  assert(liPivots.has(d.key), `LinkedIn-dimensie ${d.key} (${d.label}) heeft demo-rijen`);
}

// ── Elke LinkedIn-URN heeft een leesbaar label ──
// Zonder label staat er "urn:li:function:8" in de legenda; dat is geen weergave maar een lek.
const labels = new Set((rijen.linkedin_urn_labels ?? []).map((r) => String(r.urn)));
const gebruikteUrns = new Set((rijen.linkedin_demographic_daily ?? []).map((r) => String(r.pivot_value_urn)));
for (const urn of gebruikteUrns) {
  assert(labels.has(urn), `URN ${urn} heeft een label`);
}

// ── Elke dimensie levert een bruikbare ring ──
// Een dimensie met één segment is een volle ring en zegt niets; twee is het minimum om een
// verdeling te tonen.
function segmentenVan(dimensie: string, tabel: string, typeVeld: string, waardeVeld: string, spendVeld: string, convVeld: string): NetworkRow[] {
  const m = new Map<string, NetworkRow>();
  for (const r of rijen[tabel] ?? []) {
    if (String(r[typeVeld]) !== dimensie) continue;
    const k = String(r[waardeVeld]);
    const a = m.get(k) ?? { networkType: k, cost: 0, conversions: 0, conversionsValue: 0, impressions: 0, clicks: 0 };
    a.cost += Number(r[spendVeld] ?? 0);
    a.conversions += Number(r[convVeld] ?? 0);
    m.set(k, a);
  }
  return [...m.values()];
}

for (const d of BREAKDOWN_DIMENSIES.meta) {
  const s = buildNetworkSplit(segmentenVan(d.key, "meta_breakdown_daily", "breakdown_type", "breakdown_value", "spend", "conversions"), { normalizeKey: (k) => k });
  assert(s.length >= 2, `Meta ${d.label} heeft minstens twee segmenten`);
  assert(networkTotals(s).cost > 0, `Meta ${d.label} heeft spend`);
  const som = s.reduce((t, x) => t + x.costShare, 0);
  assert(Math.abs(som - 1) < 1e-9, `Meta ${d.label}: de kostenaandelen tellen op tot een`);
}

for (const d of BREAKDOWN_DIMENSIES.linkedin) {
  const s = buildNetworkSplit(segmentenVan(d.key, "linkedin_demographic_daily", "pivot_type", "pivot_value_urn", "spend", "leads"), { normalizeKey: (k) => k });
  assert(s.length >= 2, `LinkedIn ${d.label} heeft minstens twee segmenten`);
  assert(networkTotals(s).hasConversions, `LinkedIn ${d.label} heeft leads om tegen de spend af te zetten`);
}

// ── LinkedIn-creatives dekken meerdere formaten ──
// Vijf keer hetzelfde formaat laat de creative-weergave niets vergelijken.
const formaten = new Set((rijen.linkedin_creatives ?? []).map((c) => String(c.format)));
assert(formaten.size >= 3, `LinkedIn-creatives dekken meerdere formaten (nu: ${[...formaten].join(", ")})`);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
