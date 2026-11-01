// Test voor de gerealiseerd-grens van de forecast (lib/forecast.ts). Deterministisch, geen IO.
//
// Waarom hij bestaat: realizedThroughMonth was het AANTAL maanden met een rij, en werd gebruikt
// als index (slice(0, R), de lus in computePerformanceFactor, "resterende maanden" in het
// budgetadvies). Voor een kanaal dat midden in het jaar begon is dat een andere grens. Meta en
// LinkedIn op de demo lopen vanaf maart: de reeks is [null, null, mrt..aug, null...], dus R = 6,
// en dan:
//   - viel juli en augustus uit de YTD (Meta 660 i.p.v. 1.002, LinkedIn 193 i.p.v. 387);
//   - keek de prestatiefactor alleen naar maart t/m juni;
//   - kregen januari en februari, toen het kanaal nog niet liep, elk een prognose die meetelde
//     in de jaarprognose;
//   - rekende het budgetadvies met zes resterende maanden in plaats van vier.
// De grens is nu de laatste maand met een rij (index + 1). Lege maanden daarvóór krijgen geen
// prognose, maar hun verwachting telt wél mee in ytdExpected: het jaardoel en de jaarprognose
// tellen die maanden ook. Liet ytdExpected ze weg, dan zei de pacing "Op schema" naast een
// jaarkaart die -16,7% in het rood toonde, en hing het oordeel ervan af of een gepauzeerde maand
// als lege rij of als nulrij binnenkwam.

import { computeForecast, type ClientForecast, type ForecastMetric } from "./forecast";
import type { ClientHistoricalData, MonthlyRecord, WeeklyRecord } from "./types";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const ALLE: readonly (ForecastMetric | "adSpend")[] = ["conversions", "revenue", "adSpend", "roas", "cpa"];
const som = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

// Een maand met gelijk verdeelde weken, zoals de adapter die maakt als er geen weekdata is.
function maand(m: number, conversions: number, adSpend: number, revenue: number): MonthlyRecord {
  const n = [1, 3, 5, 7, 8, 10, 12].includes(m) ? 5 : 4;
  const weeks: WeeklyRecord[] = Array.from({ length: n }, (_, w) => ({
    week: w + 1, month: m, conversions: conversions / n, revenue: revenue / n, adSpend: adSpend / n,
  }));
  return { month: m, conversions, adSpend, revenue, weeks };
}

// Vorig jaar met een seizoenspatroon dat precies op het doel uitkomt: dan is de verwachting per
// maand gelijk aan deze reeks (geschaald met factor 1), en kunnen we gerealiseerd = verwacht × k
// exact neerzetten. Zonder seizoen zouden "jan-jun" en "mrt-aug" toevallig even groot zijn.
const SEIZOEN = [60, 70, 80, 90, 100, 110, 120, 130, 110, 100, 90, 140]; // som 1.200
const KOSTEN_PER_MAAND = 1000;
const OMZET_PER_CONVERSIE = 50;
const vorigJaar = SEIZOEN.map((c, i) => maand(i + 1, c, KOSTEN_PER_MAAND, c * OMZET_PER_CONVERSIE));

// Maart t/m juni op verwachting, juli en augustus 50% erboven: een prestatiefactor die alleen
// maart t/m juni ziet komt op 1,0 uit, een die de hele periode ziet erboven.
const GEREALISEERD_CONV: (number | null)[] = SEIZOEN.map((v, i) =>
  i < 2 ? null : i < 6 ? v : i < 8 ? v * 1.5 : null);

function jaar(conv: (number | null)[]): (MonthlyRecord | null)[] {
  return conv.map((c, i) => (c === null ? null : maand(i + 1, c, KOSTEN_PER_MAAND, c * OMZET_PER_CONVERSIE)));
}

const basis: ClientHistoricalData = {
  clientId: "test-kanaal-vanaf-maart",
  currentYear: 2026,
  targetCurrentYear: { conversions: som(SEIZOEN), revenue: som(SEIZOEN) * OMZET_PER_CONVERSIE, adSpend: 12 * KOSTEN_PER_MAAND },
  historicalYears: { 2025: vorigJaar },
  currentYearData: jaar(GEREALISEERD_CONV),
};

function grenzen(f: ClientForecast): string {
  return ALLE.map((m) => `${m}=${f[m].kpi.realizedThroughMonth}`).join(" ");
}

// ── 1. Kanaal dat in maart begint, met doel en historie ────────────────────────────────────────

console.log("Kanaal vanaf maart (met doel)");
{
  const f = computeForecast(basis);
  const c = f.conversions;

  // Voorwaarde van de fixture: de verwachting is het seizoen zelf.
  check("fixture: verwacht per maand = seizoen", c.points.every((p, i) => p.expected === SEIZOEN[i]),
    c.points.map((p) => p.expected).join(","));

  check("realizedThroughMonth = 8 (augustus) op alle vijf de resultaten, ook ROAS en CPA",
    ALLE.every((m) => f[m].kpi.realizedThroughMonth === 8), grenzen(f));

  const ytdVerwacht = som(GEREALISEERD_CONV.map((v) => v ?? 0));
  check("YTD telt maart t/m augustus", c.kpi.ytdRealized === ytdVerwacht, `${c.kpi.ytdRealized} tegen ${ytdVerwacht}`);
  check("YTD-kosten tellen maart t/m augustus", f.adSpend.kpi.ytdRealized === 6 * KOSTEN_PER_MAAND, String(f.adSpend.kpi.ytdRealized));

  // Hier stond "maart t/m augustus, niet januari en februari". Dat was fout: annualTarget en
  // adjustedAnnual tellen januari en februari wel (de eerste als doel, de tweede met +0), dus de
  // verwachting tot nu moet ze ook tellen. Anders staat de pacing op schema terwijl de jaarkaart
  // achterstand toont, voor hetzelfde account op dezelfde dag.
  const verwachtJanAug = som(SEIZOEN.slice(0, 8));
  check("ytdExpected telt januari t/m augustus, ook de maanden vóór de start",
    c.kpi.ytdExpected === verwachtJanAug, `${c.kpi.ytdExpected} tegen ${verwachtJanAug}`);

  for (const i of [0, 1]) {
    check(`${c.points[i].monthLabel}: geen prognose (kanaal liep nog niet)`,
      c.points[i].realized === null && c.points[i].forecast === null, `forecast=${c.points[i].forecast}`);
  }
  check("geen prognose voor jan/feb, ook niet bij omzet, spend, ROAS en CPA",
    ALLE.every((m) => f[m].points.slice(0, 2).every((p) => p.forecast === null && p.realized === null)));
  check("maart t/m augustus zijn gerealiseerd", c.points.slice(2, 8).every((p) => p.realized !== null));
  check("september t/m december krijgen een prognose", c.points.slice(8).every((p) => p.forecast !== null && p.realized === null));

  const toekomst = som(c.points.slice(8).map((p) => p.forecast ?? 0));
  check("jaarprognose = YTD + prognose sep-dec (geen spookmaanden)",
    c.kpi.adjustedAnnual === c.kpi.ytdRealized + toekomst, `${c.kpi.adjustedAnnual} tegen ${c.kpi.ytdRealized + toekomst}`);

  check("weken van jan/feb: geen prognose",
    c.weeklyPoints.filter((w) => w.month <= 2).every((w) => w.forecast === null && w.realized === null));
  check("weken van mrt-aug zijn gerealiseerd", c.weeklyPoints.filter((w) => w.month >= 3 && w.month <= 8).every((w) => w.realized !== null));
  check("weken van sep-dec krijgen een prognose", c.weeklyPoints.filter((w) => w.month >= 9).every((w) => w.forecast !== null));

  // De prestatiefactor moet juli en augustus (50% boven verwachting) meewegen.
  check("prestatiefactor ziet juli en augustus", c.kpi.projectionFactor > 1.1, String(c.kpi.projectionFactor));

  // Budgetadvies: het restant over de vier maanden ná augustus.
  const br = f.budgetRecommendation;
  const nodig = Math.round((f.adSpend.kpi.annualTarget - f.adSpend.kpi.ytdRealized + br.extraSpendNeeded) / 4);
  check("budgetadvies verdeelt het restant over 4 maanden (sep-dec)", br.requiredMonthlySpend === nodig,
    `${br.requiredMonthlySpend} tegen ${nodig}`);

  check("CPA YTD = kosten mrt-aug / conversies mrt-aug",
    Math.abs(f.cpa.kpi.ytdRealized - (6 * KOSTEN_PER_MAAND) / ytdVerwacht) < 0.01, String(f.cpa.kpi.ytdRealized));
}

// ── 2. Kanaal dat in maart begint, zonder doel en zonder historie (Meta/LinkedIn op de demo) ─────

console.log("Kanaal vanaf maart (zonder doel, eigen tempo)");
{
  const reeks = [null, null, 114, 180, 186, 180, 186, 156, null, null, null, null];
  const f = computeForecast({
    ...basis,
    historicalYears: {},
    targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    currentYearData: jaar(reeks),
  });
  const c = f.conversions;
  check("realizedThroughMonth = 8", c.kpi.realizedThroughMonth === 8, grenzen(f));
  check("YTD = 1.002 (maart t/m augustus)", c.kpi.ytdRealized === 1002, String(c.kpi.ytdRealized));
  check("jan/feb: geen prognose", c.points.slice(0, 2).every((p) => p.forecast === null));
  // Zonder doel is de projectie het dagtempo van de laatste gerealiseerde maand (augustus, 31 dagen).
  const maandTempo = Math.round((156 / 31) * 7 * (52 / 12));
  check("sep-dec op het tempo van augustus", c.points.slice(8).every((p) => p.forecast === maandTempo),
    c.points.slice(8).map((p) => p.forecast).join(","));
  check("jaarprognose = YTD + 4 maanden tempo", c.kpi.adjustedAnnual === 1002 + 4 * maandTempo,
    `${c.kpi.adjustedAnnual} tegen ${1002 + 4 * maandTempo}`);
}

// ── 3. Een gat midden in het jaar (gepauzeerd, of de sync miste een maand) ──────────────────────

console.log("Gat in mei");
{
  const conv = SEIZOEN.map((v, i) => (i === 4 ? null : i < 8 ? v : null));
  const f = computeForecast({ ...basis, currentYearData: jaar(conv) });
  const c = f.conversions;
  check("realizedThroughMonth = 8 ondanks het gat", c.kpi.realizedThroughMonth === 8, grenzen(f));
  check("augustus telt mee in de YTD", c.kpi.ytdRealized === som(conv.map((v) => v ?? 0)), String(c.kpi.ytdRealized));
  check("mei krijgt geen prognose", c.points[4].realized === null && c.points[4].forecast === null, String(c.points[4].forecast));
  // Hier stond "ytdExpected zonder mei". Een gepauzeerde maand is een echte nul (gepauzeerd =
  // echt nul): mei telt mee in de verwachting, net als in het jaardoel.
  check("ytdExpected met mei", c.kpi.ytdExpected === som(SEIZOEN.slice(0, 8)), String(c.kpi.ytdExpected));

  // Hetzelfde gat als nulrij: dezelfde verwachting en hetzelfde pacingoordeel. Of de bron een
  // gepauzeerde maand weglaat of als nul aanlevert mag het oordeel niet omdraaien.
  const nulrij = computeForecast({ ...basis, currentYearData: jaar(SEIZOEN.map((v, i) => (i === 4 ? 0 : i < 8 ? v : null))) });
  check("lege rij en nulrij: dezelfde ytdExpected", nulrij.conversions.kpi.ytdExpected === c.kpi.ytdExpected,
    `${nulrij.conversions.kpi.ytdExpected} tegen ${c.kpi.ytdExpected}`);
  check("lege rij en nulrij: dezelfde performanceRatio",
    Math.abs(nulrij.conversions.kpi.performanceRatio - c.kpi.performanceRatio) < 1e-9,
    `${nulrij.conversions.kpi.performanceRatio} tegen ${c.kpi.performanceRatio}`);
}

// ── 3b. Pacing en jaarkaart zeggen hetzelfde ───────────────────────────────────────────────────

console.log("Vlak vanaf maart: pacing en jaarprognose zijn het eens");
{
  // 50 per maand vanaf maart, doel 600 vlak over het jaar. De jaarprognose landt op 500 (-16,7%);
  // de pacing deelde 250 door een verwachting zonder januari en februari (250) en zei "Op schema".
  const vlak = (m: number, c: number) => maand(m, c, 1000, c * 50);
  const f = computeForecast({
    clientId: "test-vlak",
    currentYear: 2026,
    targetCurrentYear: { conversions: 600, revenue: 30_000, adSpend: 12_000 },
    historicalYears: { 2025: Array.from({ length: 12 }, (_, i) => vlak(i + 1, 50)) },
    currentYearData: Array.from({ length: 12 }, (_, i) => (i >= 2 && i <= 6 ? vlak(i + 1, 50) : null)),
  });
  const k = f.conversions.kpi;
  check("voorwaarde: jaarprognose 500, -16,7%", k.adjustedAnnual === 500 && Math.abs(k.diffPct + 16.67) < 0.01, `${k.adjustedAnnual} ${k.diffPct}`);
  check("ytdExpected = jan t/m jul (350)", k.ytdExpected === 350, String(k.ytdExpected));
  check("performanceRatio 250/350, onder de 0,9 van \"Op schema\"",
    Math.abs(k.performanceRatio - 250 / 350) < 1e-9 && k.performanceRatio < 0.9, String(k.performanceRatio));
}

// ── 4. Wat niet mag veranderen ──────────────────────────────────────────────────────────────────

console.log("Ongewijzigd: volledige reeks en nog niets gerealiseerd");
{
  const vol = computeForecast({ ...basis, currentYearData: jaar(SEIZOEN.map((v, i) => (i < 8 ? v : null))) });
  check("volledige reeks jan-aug: grens 8", vol.conversions.kpi.realizedThroughMonth === 8, grenzen(vol));
  check("volledige reeks: ytdExpected = jan t/m aug", vol.conversions.kpi.ytdExpected === som(SEIZOEN.slice(0, 8)));
  check("volledige reeks: sep-dec geprojecteerd", vol.conversions.points.slice(8).every((p) => p.forecast !== null));

  const niets = computeForecast({ ...basis, currentYearData: Array.from({ length: 12 }, () => null) });
  check("nog niets gerealiseerd: grens 0 op alle vijf", ALLE.every((m) => niets[m].kpi.realizedThroughMonth === 0), grenzen(niets));
  check("nog niets gerealiseerd: alle twaalf maanden geprojecteerd",
    niets.conversions.points.every((p) => p.forecast !== null && p.realized === null));
  check("nog niets gerealiseerd: alle weken geprojecteerd", niets.conversions.weeklyPoints.every((w) => w.forecast !== null));
  check("nog niets gerealiseerd: budgetadvies over 12 maanden",
    niets.budgetRecommendation.requiredMonthlySpend ===
      Math.round((niets.adSpend.kpi.annualTarget + niets.budgetRecommendation.extraSpendNeeded) / 12),
    String(niets.budgetRecommendation.requiredMonthlySpend));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
