// Test voor het Meta/LinkedIn-jaaroverzicht (channel-forecast-data.ts).
// Draaien: npx tsx lib/analysis/__channel_forecast_data_test.ts

import { buildChannelHistoricalData, buildChannelForecast, type ChannelForecastRow } from "./channel-forecast-data";
import type { TargetRow } from "./o2-targets-cost";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}

// ── Geen rijen: geen forecast, geen crash ──
assert(buildChannelHistoricalData("c1", [], { conversions: 0, revenue: 0, adSpend: 0 }, "2026-08-23") === null, "lege rijen leveren null op");
assert(buildChannelForecast("c1", [], [], "meta_ads", "2026-08-23") === null, "lege rijen leveren geen forecast op");

// ── Aggregatie: spend/conv/revenue van dezelfde maand tellen op, verdeeld over weken ──
function rij(date: string, spend: number, conv: number, revenue: number): ChannelForecastRow {
  return { date, spend, conv, revenue };
}
const rows: ChannelForecastRow[] = [
  ...Array.from({ length: 28 }, (_, i) => rij(`2025-08-${String(i + 1).padStart(2, "0")}`, 100, 2, 300)),
  ...Array.from({ length: 23 }, (_, i) => rij(`2026-08-${String(i + 1).padStart(2, "0")}`, 120, 3, 400)),
];

const data = buildChannelHistoricalData("c1", rows, { conversions: 0, revenue: 0, adSpend: 0 }, "2026-08-23");
assert(data !== null, "met rijen levert het wel data op");
if (data) {
  assert(data.currentYear === 2026, "huidig jaar komt uit todayIso");
  const aug2025 = data.historicalYears[2025]?.find((m) => m.month === 8);
  assert(aug2025?.adSpend === 2800, `augustus 2025 telt spend op tot 2800 (kreeg ${aug2025?.adSpend})`);
  assert(aug2025?.conversions === 56, `augustus 2025 telt conversies op tot 56 (kreeg ${aug2025?.conversions})`);
  assert((aug2025?.weeks.reduce((s, w) => s + w.adSpend, 0) ?? 0) === 2800, "de weken van augustus 2025 tellen op tot dezelfde maandspend");

  const aug2026 = data.currentYearData[7]; // index 7 = augustus
  assert(aug2026?.adSpend === 2760, `augustus 2026 (huidig jaar) telt spend op tot 2760 (kreeg ${aug2026?.adSpend})`);
  assert(data.currentYearData[8] === null, "september 2026 is nog niet gerealiseerd (null)");
  assert(data.currentYearData[0] === null, "januari 2026 heeft geen data en is null, niet nul-gevuld");
}

// ── Doel uit client_targets komt aan in targetCurrentYear ──
const targets: TargetRow[] = [
  { channel: "meta_ads", metric: "conversions", targetValue: 1000, validFrom: "2000-01-01", validTo: null },
  { channel: "meta_ads", metric: "spend", targetValue: 50000, validFrom: "2000-01-01", validTo: null },
  { channel: "google_ads", metric: "conversions", targetValue: 999999, validFrom: "2000-01-01", validTo: null },
];
const withTarget = buildChannelForecast("c1", rows, targets, "meta_ads", "2026-08-23");
assert(withTarget !== null, "forecast met doelen levert data op");
if (withTarget) {
  assert(withTarget.data.targetCurrentYear.conversions === 1000, `conversiedoel komt uit client_targets (kreeg ${withTarget.data.targetCurrentYear.conversions})`);
  assert(withTarget.data.targetCurrentYear.adSpend === 50000, `spenddoel komt uit client_targets (kreeg ${withTarget.data.targetCurrentYear.adSpend})`);
  assert(withTarget.data.targetCurrentYear.revenue === 0, "geen omzetdoel ingesteld: blijft 0 (fallback op historie gebeurt in computeForecast)");
  assert(withTarget.forecast.conversions.kpi.annualTarget === 1000, "de forecast zelf gebruikt hetzelfde doel");
}

// Zonder doel: computeForecast valt terug op het historisch totaal (zelfde gedrag als Google).
const withoutTarget = buildChannelForecast("c1", rows, [], "meta_ads", "2026-08-23");
assert(withoutTarget !== null, "forecast zonder doelen levert nog steeds data op");
if (withoutTarget) {
  assert(withoutTarget.forecast.conversions.kpi.annualTarget > 0, "zonder ingesteld doel valt de forecast terug op het historisch totaal, niet op 0");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
