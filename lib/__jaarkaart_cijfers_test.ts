// Test voor de jaaroverzicht-kaartjes (components/dashboard/metric-cards.tsx). Deterministisch,
// geen IO behalve het lezen van dat ene bronbestand.
//
// Waarom hij bestaat: de CPA-kaart rekende naast de forecast eigen cijfers uit, en de
// verwachtingsstreep stond vast op 25%. Op de demo (data t/m augustus) stond er "CPA € 19,
// prognose € 34" terwijl forecast.cpa.kpi € 63,63 en € 67,60 zei, en "Q1 verwacht (25%)".
//
// De fixture is de blended fact_core-reeks van demo-greentech (Google + Meta + LinkedIn per
// maand) zoals die op 1 november 2026 in de database stond, met de doelen zoals mergeKpiTargets ze
// maakt uit client_settings (2.600 conversies, CPA € 45 -> budgetdoel € 117.000) en het
// omzetdoel uit standaardJaardoel (2025 + 10% = € 282.062).
//
// Twee delen, met elk hun eigen telling: (1) de helper jaarKaartCijfers in lib/forecast.ts,
// (2) een bronbewaking op metric-cards.tsx die afdwingt dat de kaart de helper ook gebruikt.
// Zonder deel 2 kan de helper groen staan terwijl het scherm nog steeds € 19 toont.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeForecast, jaarKaartCijfers, type ForecastMetric } from "./forecast";
import type { ClientHistoricalData, MonthlyRecord } from "./types";

let passed = 0, failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) { passed += 1; } else { failed += 1; console.error(`  FAIL: ${label}`); }
}
const dichtbij = (a: number, b: number, marge = 0.01) => Math.abs(a - b) <= marge;

type Rij = [conversies: number, kosten: number, omzet: number];
const naarMaanden = (rijen: Rij[]): MonthlyRecord[] =>
  rijen.map(([conversions, adSpend, revenue], i) => ({ month: i + 1, conversions, adSpend, revenue, weeks: [] }));
const NUL: Rij = [0, 0, 0];

const J2024: Rij[] = [NUL, NUL, NUL, NUL, NUL, NUL, NUL, NUL,
  [129, 11150, 25020], [113, 11100, 22060], [99, 11050, 19430], [93, 11150, 18150]];
const J2025: Rij[] = [[88, 11100, 17010], [92, 11050, 17440], [103, 11150, 19300], [113, 11100, 21010],
  [127, 11050, 23640], [143, 11150, 26670], [138, 11100, 26060], [134, 11050, 25630],
  [117, 11150, 23130], [105, 11100, 20830], [93, 11050, 18490], [87, 11150, 17210]];
const J2026: Rij[] = [[90, 12000, 17190], [243, 16700, 17110], [244, 16800, 36030], [337, 19500, 47530],
  [355, 19700, 50430], [361, 19550, 52170], [418, 25950, 62930], [370, 23650, 56930]];

const demo: ClientHistoricalData = {
  clientId: "demo-greentech",
  currentYear: 2026,
  targetCurrentYear: { conversions: 2600, revenue: 282062, adSpend: 117000 },
  historicalYears: { 2024: naarMaanden(J2024), 2025: naarMaanden(J2025) },
  currentYearData: [...naarMaanden(J2026), null, null, null, null],
};
const f = computeForecast(demo);
const METRICS: readonly ForecastMetric[] = ["conversions", "revenue", "roas", "cpa"];

// Wat de oude kaart uitrekende, om te laten zien dat de nieuwe er NIET op uitkomt.
const Q1_KOSTEN = 12000 + 16700 + 16800;                         // 45.500
const OUDE_YTD_CPA = Q1_KOSTEN / f.conversions.kpi.ytdRealized;  // 18,82 -> "€ 19"
const OUDE_PROGNOSE_CPA = 117000 / f.conversions.kpi.adjustedAnnual; // 33,77 -> "€ 34"

// ═════════════════════════════════════════════════════════════════════════════════════════════
// DEEL 1 — de helper (lib/forecast.ts)
// ═════════════════════════════════════════════════════════════════════════════════════════════

console.log("jaarKaartCijfers (lib/forecast.ts)");

// ── CPA komt uit forecast.cpa.kpi ──
const cpa = jaarKaartCijfers(f, "cpa");
const ytdKosten = J2026.reduce((s, [, k]) => s + k, 0); // 153.850, alle acht maanden
const ytdConv = J2026.reduce((s, [c]) => s + c, 0);     // 2.418
// realized is null voor een verhouding zonder noemer (ytdGerealiseerd); hier zijn er conversies.
assert(cpa.realized !== null && dichtbij(cpa.realized, ytdKosten / ytdConv), `CPA YTD is alle YTD-kosten / YTD-conversies (${cpa.realized} vs ${(ytdKosten / ytdConv).toFixed(2)})`);
assert(cpa.realized !== null && !dichtbij(cpa.realized, OUDE_YTD_CPA, 1), "CPA YTD telt niet alleen de kosten van januari t/m maart");
assert(cpa.adjusted === f.cpa.kpi.adjustedAnnual, "CPA-prognose is forecast.cpa.kpi.adjustedAnnual");
assert(dichtbij(cpa.adjusted, f.adSpend.kpi.adjustedAnnual / f.conversions.kpi.adjustedAnnual),
  "CPA-prognose = geprognotiseerde spend / geprognotiseerde conversies");
assert(!dichtbij(cpa.adjusted, OUDE_PROGNOSE_CPA, 1), "CPA-prognose deelt niet het budgetdoel door de conversieprognose");
assert(dichtbij(cpa.annualTarget, 45), "CPA-doel = budgetdoel / conversiedoel = € 45");
assert(cpa.diffPct > 0, "prognose-CPA boven doel geeft een positief verschil (het teken blijft eerlijk)");
assert(cpa.diffPct === f.cpa.kpi.diffPct, "diffPct komt ongewijzigd uit forecast.cpa.kpi");

// ROAS- en CPA-kaart rekenen met hetzelfde jaarbudget (de oude CPA-kaart gebruikte het doelbudget).
const roas = jaarKaartCijfers(f, "roas");
const omzet = jaarKaartCijfers(f, "revenue");
const conv = jaarKaartCijfers(f, "conversions");
const spendUitRoas = omzet.adjusted / roas.adjusted;
const spendUitCpa = cpa.adjusted * conv.adjusted;
assert(Math.abs(spendUitRoas - spendUitCpa) / spendUitCpa < 0.005, `ROAS- en CPA-kaart impliceren hetzelfde jaarbudget (${Math.round(spendUitRoas)} vs ${Math.round(spendUitCpa)})`);

// Gerealiseerd-percentage voor de optelbare metrics.
assert(conv.realizedPct !== null && dichtbij(conv.realizedPct, (ytdConv / 2600) * 100),
  `conversies: gerealiseerd = YTD / jaardoel (${conv.realizedPct?.toFixed(1)}%)`);

// ── De verwachtingsstreep volgt het seizoen t/m de laatste gerealiseerde maand ──
assert(conv.laatsteMaand === 7, "laatste gerealiseerde maand is augustus (index 7)");
for (const m of METRICS) {
  const c = jaarKaartCijfers(f, m);
  assert(c.laatsteMaand === f[m].kpi.realizedThroughMonth - 1,
    `${m}: laatsteMaand (${c.laatsteMaand}) === kpi.realizedThroughMonth - 1 (${f[m].kpi.realizedThroughMonth - 1})`);
}
const verwachtSom = f.conversions.points.slice(0, 8).reduce((s, p) => s + p.expected, 0);
assert(conv.verwachtPct !== null && dichtbij(conv.verwachtPct, (verwachtSom / 2600) * 100),
  `verwachting = seizoensaandeel jan-aug van het doel (${conv.verwachtPct?.toFixed(1)}%)`);
assert(conv.verwachtPct !== null && !dichtbij(conv.verwachtPct, 25, 1), "verwachting staat niet vast op 25% (Q1)");
assert(omzet.verwachtPct !== null && dichtbij(omzet.verwachtPct, (f.revenue.kpi.ytdExpected / f.revenue.kpi.annualTarget) * 100),
  "omzet: verwachting = kpi.ytdExpected / kpi.annualTarget");
// Van een verhouding realiseer je geen percentage: geen balk en geen streep voor ROAS en CPA,
// zoals KpiTegel (channel-forecast-overview.tsx) dat al deed.
for (const c of [roas, cpa]) assert(c.realizedPct === null && c.verwachtPct === null, "ROAS/CPA: geen voortgangsbalk en geen streep");

// ── Randgevallen: geen doel, geen gerealiseerde maand -> geen streep ──
const zonderDoel = computeForecast({ ...demo, historicalYears: {}, targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 } });
const zd = jaarKaartCijfers(zonderDoel, "conversions");
assert(zd.verwachtPct === null && zd.realizedPct === null, "zonder jaardoel geen balk en geen verwachtingsstreep");
const nogNiets = computeForecast({ ...demo, currentYearData: Array.from({ length: 12 }, () => null) });
const leeg = jaarKaartCijfers(nogNiets, "conversions");
assert(leeg.laatsteMaand === -1 && leeg.verwachtPct === null, "zonder gerealiseerde maand geen verwachtingsstreep");

// ── Een kanaal dat in maart begon: de streep noemt augustus, niet juni ──
// De grens is de LAATSTE gerealiseerde maand. Met de oude telling (6 niet-lege maanden) zou het
// label "verwacht t/m jun" zeggen terwijl er t/m augustus gemeten is.
{
  const laat = computeForecast({
    ...demo,
    currentYearData: [null, null, ...naarMaanden(J2026).slice(2), null, null, null, null],
  });
  const c = jaarKaartCijfers(laat, "conversions");
  assert(c.laatsteMaand === 7, `kanaal vanaf maart: laatsteMaand is augustus (index 7), niet ${c.laatsteMaand}`);
  // Hier stond "de streep telt alleen maart t/m augustus". Dan stond de balk precies op de streep
  // naast een rode jaarprognose: het jaardoel telt januari en februari wel, dus de verwachting tot
  // nu ook. De streep loopt daarom over januari t/m augustus.
  const verwachtJanAug = laat.conversions.points.slice(0, 8).reduce((s, p) => s + p.expected, 0);
  assert(c.verwachtPct !== null && dichtbij(c.verwachtPct, (verwachtJanAug / 2600) * 100),
    "kanaal vanaf maart: de streep telt de verwachting van januari t/m augustus, zoals het jaardoel");
}

const helperGeslaagd = passed, helperGefaald = failed;
console.log(`  helper: ${helperGeslaagd} geslaagd, ${helperGefaald} gefaald`);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// DEEL 2 — bronbewaking op components/dashboard/metric-cards.tsx
// De kaart gebruikt de helper, en niet meer haar eigen rekensom. Dit deel wordt groen zodra de
// kaart is omgebouwd (eigen wijziging in metric-cards.tsx, los van lib/forecast.ts).
// ═════════════════════════════════════════════════════════════════════════════════════════════

console.log("bronbewaking metric-cards.tsx");
passed = 0; failed = 0;
const bron = readFileSync(join(__dirname, "..", "components", "dashboard", "metric-cards.tsx"), "utf8");
assert(!/yearProgress\s*=\s*25/.test(bron), "metric-cards.tsx zet de verwachting niet vast op 25");
assert(!bron.includes("Q1 verwacht"), "metric-cards.tsx noemt geen vaste \"Q1 verwacht\"");
assert(!/currentYearData\s*\.slice\(\s*0\s*,\s*3\s*\)/.test(bron), "metric-cards.tsx telt geen Q1-kosten op");
assert(!bron.includes("targetCurrentYear.adSpend"), "metric-cards.tsx deelt het budgetdoel niet door de prognose");
for (const m of METRICS) {
  assert(bron.includes(`jaarKaartCijfers(forecast, "${m}")`), `metric-cards.tsx haalt de ${m}-kaart uit jaarKaartCijfers`);
}
assert(bron.includes("isLowerBetter("), "metric-cards.tsx draait het oordeel om voor CPA via isLowerBetter");
const bronGeslaagd = passed, bronGefaald = failed;
console.log(`  bronbewaking: ${bronGeslaagd} geslaagd, ${bronGefaald} gefaald`);

console.log(`\n${helperGeslaagd + bronGeslaagd} geslaagd, ${helperGefaald + bronGefaald} gefaald`);
process.exit(helperGefaald + bronGefaald > 0 ? 1 : 0);
