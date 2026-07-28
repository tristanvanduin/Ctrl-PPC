// Test voor de brug tussen periodekeuze en datalaag. Deterministisch, geen IO.
// Draaien: npx tsx lib/period/__apply_period_test.ts
//
// Het gevaarlijke geval is een periode die verder terug ligt dan de geladen data. Stilzwijgend
// een kortere reeks teruggeven levert een trend over minder maanden dan gevraagd, en niets in
// de interface zou dat verraden. Daarom moet missing kloppen, niet alleen months.

import { flattenMonths, slicePeriod, comparePeriods, delta } from "./apply-period";
import type { ClientHistoricalData, MonthlyRecord } from "../types";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const m = (month: number, conv: number, rev: number, spend: number): MonthlyRecord =>
  ({ month, conversions: conv, revenue: rev, adSpend: spend, weeks: [] });

// 2025 volledig, 2026 tot en met juni (juli t/m december nog niet gerealiseerd).
const data: ClientHistoricalData = {
  clientId: "demo",
  targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
  historicalYears: {
    2024: Array.from({ length: 12 }, (_, i) => m(i + 1, 10, 100, 50)),
    2025: Array.from({ length: 12 }, (_, i) => m(i + 1, 20, 200, 100)),
  },
  currentYearData: [
    ...Array.from({ length: 6 }, (_, i) => m(i + 1, 30, 300, 150)),
    ...Array(6).fill(null),
  ],
  currentYear: 2026,
} as ClientHistoricalData;

console.log("Afvlakken tot een doorlopende reeks");
{
  const alle = flattenMonths(data);
  check("twee volle jaren plus zes maanden", alle.length === 30, String(alle.length));
  check("oplopend gesorteerd", alle.every((x, i) => i === 0 || alle[i - 1].key <= x.key));
  check("eerste is januari 2024", alle[0].key === "2024-01");
  check("laatste is juni 2026", alle[alle.length - 1].key === "2026-06");
  // Niet-gerealiseerde maanden vallen weg in plaats van als nul mee te tellen: een lege
  // toekomstige maand zou elk gemiddelde en elke trend omlaag trekken.
  check("lege toekomstmaanden zitten er niet in", !alle.some((x) => x.key > "2026-06"));
}
// Staat het huidige jaar ook in historicalYears, dan wint de verse kant.
{
  const dubbel: ClientHistoricalData = {
    ...data,
    historicalYears: { ...data.historicalYears, 2026: [m(1, 999, 999, 999)] },
  };
  const jan = flattenMonths(dubbel).find((x) => x.key === "2026-01");
  check("currentYearData wint van historicalYears", jan?.conversions === 30, String(jan?.conversions));
  check("en de maand staat er maar een keer in",
    flattenMonths(dubbel).filter((x) => x.key === "2026-01").length === 1);
}

console.log("\nEen periode snijden");
{
  const s = slicePeriod(data, { start: "2026-01", end: "2026-06" });
  check("zes maanden", s.months.length === 6);
  check("niets ontbreekt", s.missing.length === 0);
  check("conversies tellen op", s.totals.conversions === 180);
  check("besteding telt op", s.totals.adSpend === 900);
}
// Dwars door de jaargrens: november 2025 tot en met februari 2026.
{
  const s = slicePeriod(data, { start: "2025-11", end: "2026-02" });
  check("vier maanden over de jaargrens", s.months.length === 4, s.months.map((x) => x.key).join(","));
  check("de volgorde blijft oplopend", s.months.map((x) => x.key).join(",") === "2025-11,2025-12,2026-01,2026-02");
  check("twee maanden a 20 plus twee a 30", s.totals.conversions === 100, String(s.totals.conversions));
}
// Het gevaarlijke geval: een periode die deels buiten de geladen data valt.
{
  const s = slicePeriod(data, { start: "2023-10", end: "2024-03" });
  check("alleen de bestaande maanden komen terug", s.months.length === 3, s.months.map((x) => x.key).join(","));
  check("en de ontbrekende worden gemeld", s.missing.join(",") === "2023-10,2023-11,2023-12", s.missing.join(","));
}
{
  const s = slicePeriod(data, { start: "2026-07", end: "2026-09" });
  check("een periode volledig in de toekomst is leeg", s.months.length === 0);
  check("met alle maanden als ontbrekend", s.missing.length === 3);
  check("en totalen op nul, niet NaN", s.totals.conversions === 0 && Number.isFinite(s.totals.revenue));
}
{
  const s = slicePeriod(data, { start: "2026-03", end: "2026-03" });
  check("een enkele maand werkt", s.months.length === 1 && s.months[0].key === "2026-03");
}

console.log("\nVergelijken");
{
  const r = comparePeriods(data, { start: "2026-01", end: "2026-06" }, { start: "2025-01", end: "2025-06" });
  check("huidige periode", r.current.totals.conversions === 180);
  check("vorige periode", r.previous?.totals.conversions === 120);
  check("de verandering klopt", Math.abs((r.deltas?.conversions.pct ?? 0) - 50) < 1e-9, String(r.deltas?.conversions.pct));
  check("omzet ook", Math.abs((r.deltas?.revenue.pct ?? 0) - 50) < 1e-9);
}
{
  const r = comparePeriods(data, { start: "2026-01", end: "2026-06" }, null);
  check("zonder vergelijking geen deltas", r.deltas === null && r.previous === null);
}
// Van niets naar iets is geen percentage.
check("nul als basis geeft null en geen Infinity", delta(100, 0).pct === null);
check("nul naar nul geeft ook null", delta(0, 0).pct === null);
check("een gewone daling", Math.abs((delta(50, 100).pct ?? 0) + 50) < 1e-9);
check("geen verandering is 0 procent", delta(100, 100).pct === 0);
check("de ruwe getallen blijven staan", delta(100, 0).huidig === 100 && delta(100, 0).vorig === 0);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
