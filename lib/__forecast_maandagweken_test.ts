// Regressietest: de gerealiseerde weken van live Google in de forecast (lib/forecast.ts, stap 5).
// Draaien: tsx lib/__forecast_maandagweken_test.ts
//
// Waarom: het AANTAL weekpunten per maand kwam uit het meest recente historische jaar, en de
// gerealiseerde weken werden daarna op positie uit dit jaar gelezen. De live Google-weken zijn
// maandagweken per maand (googleAdsWeeklyByYear), en die tellen per jaar anders: augustus 2025 heeft
// vier maandagen, augustus 2026 vijf; september andersom. Augustus 2026 verloor zo zijn vijfde
// echte week (31 augustus), en september kreeg er een emmer bij die als "prognose" de hele maand
// meesleepte: vier volledig gemeten septemberweken stonden in de beursstrook als "Prognose 12".
//
// Gedekt via de echte keten: ruwe weekrijen -> googleAdsWeeklyByYear -> buildClientDataFromApi ->
// computeForecast -> beursWekenVan (de beursstrook).

import { googleAdsWeeklyByYear, buildClientDataFromApi, type ApiMonthlyData } from "./api/adapter";
import type { GoogleAdsMetrics } from "./api/google-ads";
import { computeForecast } from "./forecast";
import { mondaysInMonth } from "./fair/fair-weeks";
import { beursWekenVan } from "../components/dashboard/fair-weeks-overview";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

// Elke maandagweek van 6 januari 2025 t/m 26 oktober 2026: 10 conversies.
const raw: GoogleAdsMetrics[] = [];
for (let t = Date.UTC(2025, 0, 6); t <= Date.UTC(2026, 9, 26); t += 7 * 86_400_000) {
  raw.push({
    date: new Date(t).toISOString().slice(0, 10), impressions: 0, clicks: 0, ctr: 0, avgCpc: 0,
    costPerConversion: 0, conversionRate: 0, conversions: 10, conversionsValue: 1000, cost: 300,
  });
}
const perJaar = googleAdsWeeklyByYear(raw);
// De maand-API levert kalendermaanden; per maand zoveel weken als er maandagen zijn, maal 10.
function maanden(jaar: number, tot: number): ApiMonthlyData[] {
  return Array.from({ length: tot }, (_, i) => {
    const conv = 10 * mondaysInMonth(jaar, i + 1);
    return { month: i + 1, conversions: conv, revenue: conv * 100, adSpend: conv * 30, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 };
  });
}

console.log("Live Google, gerealiseerd t/m oktober 2026 (augustus 5 maandagen, september 4; in 2025 andersom)");
for (const [naam, doel] of [["met doel", { conversions: 600, revenue: 60_000, adSpend: 18_000 }], ["zonder doel", { conversions: 0, revenue: 0, adSpend: 0 }]] as const) {
  const data = buildClientDataFromApi(
    "live", [{ year: 2025, monthly: maanden(2025, 12), weekly: perJaar.get(2025)! }],
    maanden(2026, 10), perJaar.get(2026)!, doel, 2026, 10,
  );
  check(`${naam}: voorwaarde: 2026 aug/sep 5/4 weken, 2025 4/5`,
    data.currentYearData[7]?.weeks.length === 5 && data.currentYearData[8]?.weeks.length === 4 &&
    data.historicalYears[2025][7].weeks.length === 4 && data.historicalYears[2025][8].weeks.length === 5);

  const f = computeForecast(data);
  const punten = f.conversions.weeklyPoints;
  const aug = punten.filter((w) => w.month === 8);
  const sep = punten.filter((w) => w.month === 9);
  check(`${naam}: augustus heeft vijf gerealiseerde weekpunten van 10`,
    aug.length === 5 && aug.every((w) => w.realized === 10 && w.forecast === null), aug.map((w) => `${w.realized}/${w.forecast}`).join(","));
  check(`${naam}: september heeft vier gerealiseerde weekpunten, geen prognose`,
    sep.length === 4 && sep.every((w) => w.realized === 10 && w.forecast === null), sep.map((w) => `${w.realized}/${w.forecast}`).join(","));
  check(`${naam}: elke gerealiseerde maand telt in weken op tot zijn maandtotaal`,
    f.conversions.points.slice(0, 10).every((p) =>
      punten.filter((w) => w.month === p.month).reduce((s, w) => s + (w.realized ?? 0), 0) === p.realized),
    f.conversions.points.slice(0, 10).map((p) => `${p.monthLabel}:${punten.filter((w) => w.month === p.month).reduce((s, w) => s + (w.realized ?? 0), 0)}/${p.realized}`).join(" "));

  const strook = beursWekenVan(f, "conversions", 2026, "2026-11-04");
  const week = (iso: string) => strook.find((w) => w.weekStart === iso);
  for (const iso of ["2026-08-03", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-26"]) {
    const w = week(iso);
    check(`${naam}: beursstrook ${iso} gerealiseerd 10`, w?.realized === 10 && w.forecast === null, JSON.stringify(w));
  }
  // Toekomstige maanden houden hun emmers uit de historie; daar verandert niets.
  check(`${naam}: november en december krijgen een prognose`, punten.filter((w) => w.month >= 11).every((w) => w.forecast !== null && w.realized === null));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
