// Test voor de spend-velocity-detector. Deterministisch, geen IO.
// Draaien: npx tsx lib/signals/__spend_velocity_test.ts

import { buildSpendVelocitySignals, type SpendDailyRow, SV_RECENT_DAYS, SV_BASELINE_DAYS } from "./spend-velocity";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const opts = { channelLabel: "Meta", idPrefix: "meta_budget" };
const day = (agoDays: number): string => new Date(Date.now() - agoDays * 86_400_000).toISOString().slice(0, 10);

// Basislijn: dag 7..35 op €100/dag. Recent 0..6: €160/dag (+60%) => versnelling.
const spike: SpendDailyRow[] = [];
for (let a = SV_RECENT_DAYS; a < SV_RECENT_DAYS + SV_BASELINE_DAYS; a++) spike.push({ date: day(a), spend: 100 });
for (let a = 0; a < SV_RECENT_DAYS; a++) spike.push({ date: day(a), spend: 160 });
const spikeRes = buildSpendVelocitySignals(spike, opts);
const versnelling = spikeRes.triggered.find((s) => s.id === "meta_budget_spend_versnelling");
assert(versnelling !== undefined, "een dagtempo ver boven de basislijn is een versnelling");
assert(versnelling!.story.includes("budget-versnelling") && versnelling!.certainty === "indicatie", "versnelling is een indicatie");

// Recent 0..6: €40/dag (-60%) => inzakking.
const drop: SpendDailyRow[] = [];
for (let a = SV_RECENT_DAYS; a < SV_RECENT_DAYS + SV_BASELINE_DAYS; a++) drop.push({ date: day(a), spend: 100 });
for (let a = 0; a < SV_RECENT_DAYS; a++) drop.push({ date: day(a), spend: 40 });
const dropRes = buildSpendVelocitySignals(drop, opts);
assert(dropRes.triggered.find((s) => s.id === "meta_budget_spend_inzakking") !== undefined, "een dagtempo ver onder de basislijn is een inzakking");

// Stabiel tempo: geen signaal.
const stable: SpendDailyRow[] = [];
for (let a = 0; a < SV_RECENT_DAYS + SV_BASELINE_DAYS; a++) stable.push({ date: day(a), spend: 100 });
assert(buildSpendVelocitySignals(stable, opts).triggered.length === 0, "een stabiel tempo triggert niets");

// Te weinig basislijn-spend: geen oordeel.
const thin: SpendDailyRow[] = [{ date: day(10), spend: 5 }, { date: day(2), spend: 20 }];
const thinRes = buildSpendVelocitySignals(thin, opts);
assert(thinRes.triggered.length === 0 && thinRes.checked.includes("meta_budget_spend_velocity"), "onder de basislijn-drempel geen oordeel, wel gecontroleerd");

// ── Het data-anker (herbouw 1 sep 2026) ──
//
// Zes dagen sync-lag bij een verder kerngezond stabiel tempo: de oude wandklok-versie las
// het halflege recente venster als -86% "inzakking" (live gezien op de demo). Met het anker
// op de laatste datadatum blijft het tempo-oordeel schoon, en meldt een apart signaal dat
// de AANVOER achterloopt.
{
  const lag: SpendDailyRow[] = [];
  // Stabiel €100/dag, maar de jongste rij is 6 dagen oud.
  for (let a = 6; a < 6 + SV_RECENT_DAYS + SV_BASELINE_DAYS; a++) lag.push({ date: day(a), spend: 100 });
  const vandaag = day(0);
  const res = buildSpendVelocitySignals(lag, { ...opts, vandaag });
  assert(!res.triggered.some((s) => s.id === "meta_budget_spend_inzakking"), "sync-lag is geen inzakking meer");
  const achterstand = res.triggered.find((s) => s.id === "meta_budget_data_achterstand");
  assert(achterstand !== undefined, "de achterstand zelf wordt wél gemeld");
  assert(/6 dagen/.test(achterstand?.story ?? ""), "met het aantal dagen erbij");

  // Zonder vandaag-parameter (oude aanroepen): geen achterstandssignaal, ook geen vals alarm.
  const zonder = buildSpendVelocitySignals(lag, opts);
  assert(zonder.triggered.length === 0, "zonder vandaag-parameter alleen het schone tempo-oordeel");

  // Lege invoer: niets gecontroleerd (er wás niets om te controleren).
  const leeg = buildSpendVelocitySignals([], opts);
  assert(leeg.checked.length === 0 && leeg.triggered.length === 0, "lege invoer telt niet als gecontroleerd");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
