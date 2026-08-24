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
  // 24 augustus 2026: dit was "blijft 0". Zonder ingevoerd doel valt het jaardoel nu terug op het
  // laatst volledige jaar plus groei -- dezelfde regel die de Google-route en de blended historie
  // al toepasten (lib/analysis/standaard-jaardoel.ts). Het gat zat hier: met een doel van nul
  // spreidt toFairWeeks een verwachting van nul over de weken, en dan toont de beurs-sectie op
  // Meta en LinkedIn geen ratio terwijl dezelfde sectie op Google er wel een heeft.
  // 2025 in deze fixture: 28 dagen x 300 omzet = 8400, x 1,10 = 9240.
  assert(
    withTarget.data.targetCurrentYear.revenue === 9240,
    `geen omzetdoel ingesteld: terugval op vorig jaar +10% (kreeg ${withTarget.data.targetCurrentYear.revenue})`,
  );
  assert(withTarget.forecast.conversions.kpi.annualTarget === 1000, "de forecast zelf gebruikt hetzelfde doel");
}

// ── Geen vorig jaar: dan valt er ook niets terug te vallen ──
//
// Dit is de situatie van Meta en LinkedIn in de demo: hun dagdata begint pas in maart 2026. De
// terugval kan niets afleiden uit een jaar dat niet bestaat, en een verwachting verzinnen zou erger
// zijn dan geen verwachting tonen -- de beurs-sectie zegt in dat geval "geen jaardoel ingesteld".
const alleenDitJaar: ChannelForecastRow[] = Array.from({ length: 23 }, (_, i) =>
  rij(`2026-08-${String(i + 1).padStart(2, "0")}`, 120, 3, 400));
const zonderVorigJaar = buildChannelForecast("c1", alleenDitJaar, [], "meta_ads", "2026-08-23");
assert(zonderVorigJaar !== null, "alleen dit jaar levert nog steeds een forecast op");
if (zonderVorigJaar) {
  assert(zonderVorigJaar.data.targetCurrentYear.conversions === 0, "zonder vorig jaar geen conversiedoel");
  assert(zonderVorigJaar.data.targetCurrentYear.revenue === 0, "zonder vorig jaar geen omzetdoel");
  assert(zonderVorigJaar.data.targetCurrentYear.adSpend === 0, "zonder vorig jaar geen spenddoel");
}

// Zonder doel: computeForecast valt terug op het historisch totaal (zelfde gedrag als Google).
const withoutTarget = buildChannelForecast("c1", rows, [], "meta_ads", "2026-08-23");
assert(withoutTarget !== null, "forecast zonder doelen levert nog steeds data op");
if (withoutTarget) {
  assert(withoutTarget.forecast.conversions.kpi.annualTarget > 0, "zonder ingesteld doel valt de forecast terug op het historisch totaal, niet op 0");
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
