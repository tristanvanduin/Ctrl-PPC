// Test voor de weekday-efficiëntie-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__weekday_efficiency_test.ts

import { buildWeekdayEfficiencySignals, type WeekdayRow } from "./weekday-efficiency";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const opts = { channelLabel: "Meta", idPrefix: "meta_budget" };

// 2026-02-01 is een zondag (getUTCDay 0). Bouw 8 weken data: elke dag €20 spend, 2 conversies,
// behalve zondag: €20 spend maar 0,5 conversie (dure dag).
const rows: WeekdayRow[] = [];
const start = Date.parse("2026-01-04"); // een zondag
for (let i = 0; i < 56; i++) {
  const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
  const wd = new Date(Date.parse(date)).getUTCDay();
  rows.push({ date, spend: 20, conversions: wd === 0 ? 0.5 : 2 });
}
const res = buildWeekdayEfficiencySignals(rows, opts);
const duur = res.triggered.find((s) => s.id === "meta_budget_weekday_duur");
assert(duur !== undefined, "de dure weekdag wordt gemarkeerd");
assert(duur!.scope.includes("zondag") && duur!.story.includes("structureel duur"), "het verhaal benoemt de dag (zondag)");
assert(duur!.certainty === "indicatie" && duur!.category === "budget_pacing", "schema-advies is een indicatie, budget-categorie");

// Gelijkmatige week: geen dure dag.
const flat: WeekdayRow[] = [];
for (let i = 0; i < 56; i++) {
  const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
  flat.push({ date, spend: 20, conversions: 2 });
}
assert(buildWeekdayEfficiencySignals(flat, opts).triggered.length === 0, "een gelijkmatige week triggert niets");

// Te weinig conversies: geen oordeel.
const thin: WeekdayRow[] = [{ date: "2026-01-05", spend: 50, conversions: 2 }, { date: "2026-01-06", spend: 50, conversions: 1 }];
const thinRes = buildWeekdayEfficiencySignals(thin, opts);
assert(thinRes.triggered.length === 0 && thinRes.checked.includes("meta_budget_weekday"), "onder de conversie-drempel geen oordeel, wel gecontroleerd");

// ── Toeval (doorlichting 13 november 2026) ──────────────────────────────────
// Rapport: 56 dagen, elke dag dezelfde kosten en dezelfde conversiekans (Poisson, geen enkel
// weekdageffect). Bij 20 verwachte conversies vuurde de detector in 82% van de runs, bij 40 in
// 80%, bij 80 in 46%. Op zo'n reeks mag hij hooguit in ongeveer 5% van de runs afgaan.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function poisson(lambda: number, r: () => number): number {
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}
function vuurfractie(totaalVerwacht: number, runs: number, effect: (wd: number) => number, seed: number): number {
  const r = rng(seed);
  let gevuurd = 0;
  for (let run = 0; run < runs; run++) {
    const reeks: WeekdayRow[] = [];
    for (let i = 0; i < 56; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      const wd = new Date(Date.parse(date)).getUTCDay();
      reeks.push({ date, spend: 20, conversions: poisson((totaalVerwacht / 56) * effect(wd), r) });
    }
    if (buildWeekdayEfficiencySignals(reeks, opts).triggered.length > 0) gevuurd++;
  }
  return gevuurd / runs;
}
for (const n of [20, 40, 80, 160, 400]) {
  const f = vuurfractie(n, 400, () => 1, 1000 + n);
  assert(f <= 0.07, `zonder weekdageffect bij ${n} verwachte conversies vuurt hij in ${Math.round(f * 100)}% van de runs (hooguit ~5%)`);
}
// En een echt effect blijft zichtbaar: zondag converteert op de helft van de rest.
const echt = vuurfractie(400, 200, (wd) => (wd === 0 ? 0.5 : 1), 7);
assert(echt >= 0.8, `een zondag op de helft van de rest wordt bij 400 conversies gevonden (${Math.round(echt * 100)}%)`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
