// Test voor de uur-dagdeel-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__hourly_dayparting_test.ts

import { buildHourlyDaypartingSignals, type HourlyRow } from "./hourly-dayparting";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const opts = { channelLabel: "Meta", idPrefix: "meta_budget" };

// Elk uur €10 spend + 10 conversies, behalve de nacht (0-3u): €10 spend + 2 conversies (duur).
// Het volume is bewust ruim: bij 1 conversie per uur (de oude opzet, 21 in totaal) verwacht de
// nacht er maar 3,5, en een tekort daarop is niet van toeval te onderscheiden (lib/signals/toeval.ts).
const rows: HourlyRow[] = [];
for (let h = 0; h < 24; h++) rows.push({ hour: h, spend: 10, conversions: h < 4 ? 2 : 10 });
const res = buildHourlyDaypartingSignals(rows, opts);
const duur = res.triggered.find((s) => s.id === "meta_budget_dayparting_duur");
assert(duur !== undefined, "het dure dagdeel (nacht) wordt gemarkeerd");
assert(duur!.scope.includes("nacht") && duur!.story.includes("structureel duur"), "het verhaal benoemt het dagdeel");
assert(duur!.certainty === "indicatie" && duur!.category === "budget_pacing", "schema-advies is een indicatie, budget-categorie");

// Gelijkmatig etmaal: geen duur dagdeel.
const flat: HourlyRow[] = [];
for (let h = 0; h < 24; h++) flat.push({ hour: h, spend: 10, conversions: 1 });
assert(buildHourlyDaypartingSignals(flat, opts).triggered.length === 0, "een gelijkmatig etmaal triggert niets");

// Te weinig conversies: geen oordeel.
const thin: HourlyRow[] = [{ hour: 2, spend: 50, conversions: 2 }, { hour: 14, spend: 50, conversions: 1 }];
const thinRes = buildHourlyDaypartingSignals(thin, opts);
assert(thinRes.triggered.length === 0 && thinRes.checked.includes("meta_budget_dayparting"), "onder de conversie-drempel geen oordeel, wel gecontroleerd");

// Het oude voorbeeld met 21 conversies: de nacht oogt duur, maar dat is niet te beoordelen.
const dun: HourlyRow[] = [];
for (let h = 0; h < 24; h++) dun.push({ hour: h, spend: 10, conversions: h < 4 ? 0.2 : 1 });
const dunRes = buildHourlyDaypartingSignals(dun, opts);
assert(dunRes.triggered.length === 0, "bij 3,5 verwachte conversies in de nacht geen 'structureel duur'");
assert((dunRes.notAssessable ?? []).some((n) => n.id === "meta_budget_dayparting"), "maar wel de melding dat het niet te beoordelen is");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
