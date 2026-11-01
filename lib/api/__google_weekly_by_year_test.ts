// Weekrijen van live Google per jaar en per maand, in kalendervolgorde. Deterministisch, geen IO.
// Draaien: npx tsx lib/api/__google_weekly_by_year_test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// De client-data-route haalt vijf jaar weekrijen in één keer op (segments.week = de maandag) en
// zette die in één aanroep om met googleAdsWeeklyToApiData. Die groepeerde op maandNUMMER en
// nummerde de rijen in de volgorde waarin ze binnenkwamen. Daarna zocht de route het jaar erbij
// via de index, raw[i] bij mapped[i], terwijl de omzetting de volgorde had omgegooid. Gevolg bij
// klanten met meer dan een jaar historie: 22 weekrecords in één oktober, een rooster van 9/22/21
// weken voor sep/okt/nov, en septembercijfers op de kaart van de beursweek in november.
//
// Een maand heeft vier of vijf maandagen, nooit meer. Dat is de eigenschap die hier vastligt, met
// de rijen bewust in WILLEKEURIGE volgorde: de API belooft geen volgorde, en de oude code was
// alleen goed als die toevallig klopte.

import type { GoogleAdsMetrics } from "./google-ads";
import { googleAdsWeeklyToApiData, googleAdsWeeklyByYear, buildClientDataFromApi, type ApiWeeklyData } from "./adapter";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const DAG_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Alle maandagen van een jaar, uit de kalender (2024-01-01 en 2025-01-06 zijn maandagen). */
function maandagenVan(jaar: number): string[] {
  const uit: string[] = [];
  for (let ms = Date.UTC(jaar, 0, 1); ms < Date.UTC(jaar + 1, 0, 1); ms += DAG_MS) {
    if (new Date(ms).getUTCDay() === 1) uit.push(iso(ms));
  }
  return uit;
}

/**
 * Eén weekrij per maandag. De waarden coderen waar de rij vandaan komt, zodat de test kan zien
 * of een record bij de juiste week staat: conversies = dag van de maand, omzet = jaar,
 * kosten = maand. Een record dat in het verkeerde jaar of op de verkeerde plek belandt, valt op.
 */
function weekrij(datum: string): GoogleAdsMetrics {
  const [j, m, d] = datum.split("-").map(Number);
  return {
    date: datum, impressions: 1000, clicks: 50, cost: m, conversions: d, conversionsValue: j,
    ctr: 0.05, avgCpc: 1, costPerConversion: 1, conversionRate: 0.1,
  };
}

/** Vaste schudvolgorde (Fisher-Yates op een lineaire congruente generator): reproduceerbaar. */
function geschud<T>(xs: readonly T[], zaad: number): T[] {
  const uit = [...xs];
  let s = zaad >>> 0;
  const volgende = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = uit.length - 1; i > 0; i--) {
    const k = Math.floor(volgende() * (i + 1));
    [uit[i], uit[k]] = [uit[k], uit[i]];
  }
  return uit;
}

const MAANDAGEN = { 2024: maandagenVan(2024), 2025: maandagenVan(2025) } as const;
const ALLE = [...MAANDAGEN[2024], ...MAANDAGEN[2025]].map(weekrij);
const GESCHUD = geschud(ALLE, 20261101);
const geschudVoor = GESCHUD.map((r) => r.date).join(",");

// Zekerheid dat de invoer echt door elkaar staat: anders bewijst de rest niets.
check("de invoer staat werkelijk door elkaar", GESCHUD.some((r, i) => i > 0 && r.date < GESCHUD[i - 1].date));

console.log("De kalender zelf (los van de code getoetst)");
{
  check("2024 heeft 53 maandagen", MAANDAGEN[2024].length === 53, String(MAANDAGEN[2024].length));
  check("2025 heeft 52 maandagen", MAANDAGEN[2025].length === 52, String(MAANDAGEN[2025].length));
}

/** Per maand: de maandagen in datumvolgorde, als dag-van-de-maand. */
function verwachtPerMaand(jaar: 2024 | 2025): Map<number, number[]> {
  const uit = new Map<number, number[]>();
  for (const d of MAANDAGEN[jaar]) {
    const m = Number(d.slice(5, 7));
    uit.set(m, [...(uit.get(m) ?? []), Number(d.slice(8, 10))]);
  }
  return uit;
}

console.log("\ngoogleAdsWeeklyByYear op twee jaar maandagen in willekeurige volgorde");
let perJaar: Map<number, ApiWeeklyData[]> = new Map();
try {
  perJaar = googleAdsWeeklyByYear(GESCHUD);
} catch (e) {
  check("googleAdsWeeklyByYear bestaat en draait", false, String(e));
}
{
  check("precies de jaren 2024 en 2025, oplopend", [...perJaar.keys()].join(",") === "2024,2025", [...perJaar.keys()].join(","));
  check("de invoer is niet omgegooid (sorteren gebeurt op een kopie)", GESCHUD.map((r) => r.date).join(",") === geschudVoor);

  for (const jaar of [2024, 2025] as const) {
    const recs = perJaar.get(jaar) ?? [];
    const verwacht = verwachtPerMaand(jaar);
    check(`${jaar}: een record per maandag`, recs.length === MAANDAGEN[jaar].length, `${recs.length} tegen ${MAANDAGEN[jaar].length}`);
    check(`${jaar}: geen record uit een ander jaar`, recs.every((r) => r.revenue === jaar),
      recs.filter((r) => r.revenue !== jaar).slice(0, 3).map((r) => `${r.revenue}-${r.month}`).join(","));
    check(`${jaar}: elk record in zijn eigen maand`, recs.every((r) => r.adSpend === r.month));

    for (let m = 1; m <= 12; m++) {
      const inMaand = recs.filter((r) => r.month === m).sort((a, b) => a.week - b.week);
      const dagen = verwacht.get(m) ?? [];
      check(`${jaar}-${String(m).padStart(2, "0")}: ${dagen.length} weken, zoals de kalender`,
        inMaand.length === dagen.length, `kreeg ${inMaand.length}`);
      check(`${jaar}-${String(m).padStart(2, "0")}: vier of vijf, nooit meer`, inMaand.length >= 4 && inMaand.length <= 5, String(inMaand.length));
      check(`${jaar}-${String(m).padStart(2, "0")}: weken genummerd 1..n`,
        inMaand.map((r) => r.week).join(",") === dagen.map((_, i) => i + 1).join(","), inMaand.map((r) => r.week).join(","));
      check(`${jaar}-${String(m).padStart(2, "0")}: week k is de k-de maandag`,
        inMaand.map((r) => r.conversions).join(",") === dagen.join(","),
        `kreeg ${inMaand.map((r) => r.conversions).join(",")}, verwacht ${dagen.join(",")}`);
    }
  }

  // Een paar maanden met de hand nagerekend, zodat de verwachting niet alleen uit de eigen
  // kalenderfunctie hierboven komt.
  const aantal = (jaar: number, m: number) => (perJaar.get(jaar) ?? []).filter((r) => r.month === m).length;
  check("januari 2024: 1, 8, 15, 22, 29 -> vijf", aantal(2024, 1) === 5, String(aantal(2024, 1)));
  check("december 2024: 2, 9, 16, 23, 30 -> vijf", aantal(2024, 12) === 5, String(aantal(2024, 12)));
  check("februari 2025: vier", aantal(2025, 2) === 4, String(aantal(2025, 2)));
  check("september 2025: 1, 8, 15, 22, 29 -> vijf", aantal(2025, 9) === 5, String(aantal(2025, 9)));
  check("oktober 2025: vier (de oude route gaf er 22)", aantal(2025, 10) === 4, String(aantal(2025, 10)));
  check("november 2025: vier", aantal(2025, 11) === 4, String(aantal(2025, 11)));
}

console.log("\ngoogleAdsWeeklyToApiData: de volgorde van binnenkomst doet er niet toe");
{
  const een = MAANDAGEN[2025].map(weekrij);
  const gesorteerd = googleAdsWeeklyToApiData(een);
  const door = googleAdsWeeklyToApiData(geschud(een, 7));
  const sleutel = (rs: ApiWeeklyData[]) => rs.map((r) => `${r.month}.${r.week}=${r.conversions}`).join(",");
  check("geschud geeft hetzelfde als gesorteerd", sleutel(door) === sleutel(gesorteerd));
  const okt = door.filter((r) => r.month === 10).sort((a, b) => a.week - b.week);
  check("oktober 2025: week 1 = de 6e, week 4 = de 27e", okt.map((r) => r.conversions).join(",") === "6,13,20,27",
    okt.map((r) => r.conversions).join(","));

  // Ook wie toch twee jaar in één keer aanbiedt, krijgt geen week 6 of hoger meer: de nummering
  // loopt per jaar en maand. Dit was precies de bucket-opstapeling.
  const samen = googleAdsWeeklyToApiData(GESCHUD);
  const hoogste = Math.max(...samen.map((r) => r.week));
  check("twee jaar in één aanroep: hoogste weeknummer is 5", hoogste === 5, String(hoogste));
  check("twee jaar in één aanroep: in datumvolgorde (record i hoort bij de i-de maandag)",
    samen.every((r, i) => r.revenue === Number(ALLE[i].date.slice(0, 4)) && r.conversions === Number(ALLE[i].date.slice(8, 10))));

  check("lege invoer geeft een lege lijst", googleAdsWeeklyToApiData([]).length === 0);
  let leeg: Map<number, ApiWeeklyData[]> | null = null;
  try { leeg = googleAdsWeeklyByYear([]); } catch { /* geteld hieronder */ }
  check("lege invoer geeft een lege map", leeg !== null && leeg.size === 0);
}

console.log("\nDoor de adapter heen, zoals de route het historierooster bouwt");
{
  const maandrijen = () => Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, conversions: 100, revenue: 1000, adSpend: 500,
    impressions: 10000, clicks: 400, ctr: 0.04, avgCpc: 1.25, conversionRate: 0.25,
  }));
  const data = buildClientDataFromApi(
    "test",
    [2024, 2025].map((year) => ({ year, monthly: maandrijen(), weekly: perJaar.get(year) ?? [] })),
    [], [], { conversions: 1, revenue: 1, adSpend: 1 }, 2026, 0,
  );
  const weken = (jaar: number, m: number) => data.historicalYears[jaar]?.[m - 1]?.weeks ?? [];
  check("2025 september: vijf weken in het historierooster", weken(2025, 9).length === 5, String(weken(2025, 9).length));
  check("2025 oktober: vier weken in het historierooster", weken(2025, 10).length === 4, String(weken(2025, 10).length));
  check("2025 oktober bevat geen 2024-weken", weken(2025, 10).every((w) => w.revenue === 2025));
  check("geen enkele maand in de historie heeft meer dan vijf weken",
    [2024, 2025].every((j) => (data.historicalYears[j] ?? []).every((rec) => rec.weeks.length <= 5)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
