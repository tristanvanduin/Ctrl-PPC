// Test voor de gezondheidsscore. Deterministisch, geen IO.
// Draaien: npx tsx lib/__health_score_test.ts
//
// Deze module was ongetest en gaf een leeg account — geen doel, geen data, geen historie —
// het cijfer B met 78 van de 100 punten, met geruststellende teksten als "Budget wordt goed
// benut" en "Weinig verspilling". Dat is geen kleine afwijking: een klant waarvan de sync
// stilletjes leeg terugkwam (wat eerder in deze codebase kon gebeuren) zag een gezond account.
//
// Erger nog: het instellen van een jaardoel VERLAAGDE de score. Zonder doel was het 20 van de
// 20 punten, met een doel dat voor 90 procent gehaald werd 18. Wie zijn werk goed deed werd
// bestraft.
//
// De tests hieronder leggen vast dat ontbrekende kennis als ontbrekend wordt behandeld: niet
// als goed, en ook niet als slecht.

import { computeHealthScore, type HealthScore } from "./health-score";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type Punt = { realized: number | null; monthRatio: number; monthLabel: string };

function kpi(o: Partial<Record<string, number>> = {}) {
  return {
    annualTarget: 0, adjustedAnnual: 0, ytdRealized: 0, ytdExpected: 0,
    projectionFactor: 1, ...o,
  };
}

function punten(waarden: (number | null)[]): Punt[] {
  return waarden.map((v, i) => ({ realized: v, monthRatio: 1, monthLabel: `M${i + 1}` }));
}

function forecast(o: Record<string, unknown> = {}): Parameters<typeof computeHealthScore>[0] {
  const leeg = { kpi: kpi(), points: [] as Punt[] };
  return {
    conversions: leeg, revenue: leeg, adSpend: leeg, roas: leeg, cpa: leeg,
    budgetRecommendation: { recommendation: "hold", currentMonthlySpend: 0, suggestedMonthlySpend: 0, reason: "" },
    dataMaturity: { isMature: false, isScaling: false, efficiencyTrend: 1, monthsOfData: 0, reason: "" },
    ...o,
  } as unknown as Parameters<typeof computeHealthScore>[0];
}

const factor = (h: HealthScore, naam: string) => h.factors.find((f) => f.name === naam)!;

// ── Een leeg account is onbekend, niet gezond ──────────────────────────────

console.log("Een leeg account");
{
  const h = computeHealthScore(forecast());
  check("krijgt geen cijfer", h.grade === "?", h.grade);
  check("geen enkele factor is beoordeeld", h.assessedCount === 0, String(h.assessedCount));
  check("alle vijf factoren staan op niet beoordeeld", h.factors.every((f) => !f.assessed));
  check("het totaal is niet positief", h.total === 0, String(h.total));
  // Dit is de kern: nergens mag een geruststellende tekst staan over iets wat niet bekend is.
  check("geen enkele factor beweert iets goeds",
    h.factors.every((f) => f.description.includes("niet beoordeeld")),
    h.factors.map((f) => f.description).join(" | "));
}

// ── Een doel instellen mag nooit straffen ──────────────────────────────────

console.log("\nEen jaardoel instellen");
{
  const zonder = computeHealthScore(forecast());
  const met = computeHealthScore(forecast({
    conversions: { kpi: kpi({ annualTarget: 1000, adjustedAnnual: 900 }), points: [] },
  }));
  check("zonder doel is de factor niet beoordeeld", !factor(zonder, "Doelstelling").assessed);
  check("met doel wel", factor(met, "Doelstelling").assessed);
  check("met doel scoort de factor 18", factor(met, "Doelstelling").score === 18, String(factor(met, "Doelstelling").score));
  // De oude opzet gaf zonder doel 20 en met een doel op 90 procent 18. Dat mag niet meer.
  check("zonder doel scoort de factor niet hoger dan met",
    factor(zonder, "Doelstelling").score <= factor(met, "Doelstelling").score,
    `${factor(zonder, "Doelstelling").score} tegen ${factor(met, "Doelstelling").score}`);
}

// ── Een beoordeelbare factor telt wel gewoon mee ───────────────────────────

console.log("\nFactoren die wel te beoordelen zijn");
{
  const h = computeHealthScore(forecast({
    conversions: { kpi: kpi({ annualTarget: 1000, adjustedAnnual: 1000 }), points: punten([10, 12]) },
    adSpend: { kpi: kpi({ annualTarget: 5000, ytdRealized: 2500, ytdExpected: 2500 }), points: [] },
    cpa: { kpi: kpi(), points: punten([50, 45]) },
  }));
  check("doelstelling is beoordeeld", factor(h, "Doelstelling").assessed);
  check("en scoort vol bij 100 procent", factor(h, "Doelstelling").score === 20);
  check("budget is beoordeeld", factor(h, "Budget").assessed);
  check("efficiency is beoordeeld bij twee CPA-punten", factor(h, "Efficiency").assessed);
  check("trend is beoordeeld bij twee maanden", factor(h, "Trend").assessed);
  check("hygiene is beoordeeld zodra er besteding is", factor(h, "Hygiëne").assessed);
  check("alle vijf beoordeeld", h.assessedCount === 5, String(h.assessedCount));
  check("en dat is genoeg voor een cijfer", h.grade !== "?", h.grade);
  // Het totaal wordt geschaald over wat beoordeeld is, niet over alle 100 punten.
  check("het totaal ligt tussen 0 en 100", h.total >= 0 && h.total <= 100, String(h.total));
}

// Zonder besteding valt er niets te verspillen; dan hoort hygiene onbeoordeeld te blijven in
// plaats van de volle 20 punten met "Weinig verspilling" op te leveren.
{
  const h = computeHealthScore(forecast({
    conversions: { kpi: kpi({ annualTarget: 1000, adjustedAnnual: 1000 }), points: punten([10, 12]) },
    adSpend: { kpi: kpi({ annualTarget: 5000, ytdRealized: 0, ytdExpected: 2500 }), points: [] },
  }));
  check("zonder besteding is hygiene niet beoordeeld", !factor(h, "Hygiëne").assessed);
  check("en de tekst belooft niets", factor(h, "Hygiëne").description.includes("niet beoordeeld"),
    factor(h, "Hygiëne").description);
}

// ── Het totaal schaalt over de beoordeelde factoren ────────────────────────

console.log("\nDe schaling van het totaal");
{
  // Eén factor, vol gescoord: dat is 100 procent van wat beoordeeld kon worden — maar met
  // te weinig basis voor een cijfer.
  const h = computeHealthScore(forecast({
    conversions: { kpi: kpi({ annualTarget: 1000, adjustedAnnual: 1000 }), points: [] },
  }));
  check("een volle factor geeft 100", h.total === 100, String(h.total));
  check("maar een op vijf is te weinig voor een cijfer", h.grade === "?", h.grade);
  check("en dat is zichtbaar", h.assessedCount === 1);
}
{
  // Drie beoordeelde factoren is de ondergrens voor een cijfer.
  const h = computeHealthScore(forecast({
    conversions: { kpi: kpi({ annualTarget: 1000, adjustedAnnual: 1000 }), points: punten([10, 12]) },
    cpa: { kpi: kpi(), points: punten([50, 45]) },
  }));
  check("drie factoren geven wel een cijfer", h.assessedCount >= 3 && h.grade !== "?", `${h.assessedCount} / ${h.grade}`);
}

// ── Geen enkele uitkomst mag NaN of buiten bereik zijn ─────────────────────

console.log("\nRandgevallen");
for (const [naam, f] of Object.entries({
  leeg: forecast(),
  nulDoel: forecast({ conversions: { kpi: kpi({ annualTarget: 0, adjustedAnnual: 500 }), points: [] } }),
  negatief: forecast({ conversions: { kpi: kpi({ annualTarget: 1000, adjustedAnnual: -50 }), points: punten([-5, -2]) } }),
  enorm: forecast({ conversions: { kpi: kpi({ annualTarget: 1, adjustedAnnual: 1e9 }), points: [] } }),
})) {
  const h = computeHealthScore(f);
  check(`${naam}: totaal is eindig`, Number.isFinite(h.total), String(h.total));
  check(`${naam}: totaal binnen 0 en 100`, h.total >= 0 && h.total <= 100, String(h.total));
  check(`${naam}: elke factor binnen zijn maximum`, h.factors.every((x) => x.score >= 0 && x.score <= x.maxScore));
  check(`${naam}: elke factor heeft een tekst`, h.factors.every((x) => x.description.length > 0));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
