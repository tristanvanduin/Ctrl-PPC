// Gedragstest voor de rekenfouten in de health-score en de CPA-trend uit de doorlichting van
// 13 november 2026. De tegenvoorbeelden komen uit het rapport.
// Draaien: tsx lib/__health_rekenwerk_test.ts

import { computeHealthScore, googleHealthScore, type HealthScore } from "./health-score";
import { cpaTrendFrom, cpaTrendVanForecast } from "./analysis/trend";
import { computeDisplayScorecard } from "./display-scorecard";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

type F = Parameters<typeof computeHealthScore>[0];
const kpi = (o: Partial<Record<string, number>> = {}) => ({ annualTarget: 0, adjustedAnnual: 0, ytdRealized: 0, ytdExpected: 0, projectionFactor: 1, ...o });
const maandPunten = (waarden: (number | null)[]) =>
  waarden.map((v, i) => ({ month: i + 1, monthLabel: `M${i + 1}`, realized: v, expected: 0, forecast: null, monthRatio: 1 }));
function forecast(o: Record<string, unknown> = {}): F {
  const leeg = { kpi: kpi(), points: [] };
  return {
    conversions: leeg, revenue: leeg, adSpend: leeg, roas: leeg, cpa: leeg,
    budgetRecommendation: { recommendation: "hold", currentMonthlySpend: 0, suggestedMonthlySpend: 0, reason: "" },
    dataMaturity: { isMature: true, isScaling: false, efficiencyTrend: 1, monthsOfData: 12, reason: "" },
    ...o,
  } as unknown as F;
}
const factor = (h: HealthScore, naam: string) => h.factors.find((f) => f.name === naam)!;

console.log("CPA-trend als ratio van sommen");
{
  // Rapport: zes maanden van € 1.000, conversies 10, 10, 10 en daarna 30, 30, 1. Het gemiddelde
  // van maand-CPA's gaf +256% met stijgtHard; som gedeeld door som is € 100 tegen € 49.
  const kosten = [1000, 1000, 1000, 1000, 1000, 1000];
  const conv = [10, 10, 10, 30, 30, 1];
  const f = forecast({
    cpa: { kpi: kpi(), points: maandPunten(kosten.map((k, i) => k / conv[i])) },
    adSpend: { kpi: kpi(), points: maandPunten(kosten) },
    conversions: { kpi: kpi(), points: maandPunten(conv) },
  });
  const t = cpaTrendVanForecast(f);
  check("vorig venster € 100", Math.abs(t.vorig - 100) < 0.01, String(t.vorig));
  check("recent venster € 49", Math.abs(t.huidig - 3000 / 61) < 0.01, String(t.huidig));
  check("de CPA daalt (-51%), geen stijging", (t.pct ?? 0) < -50 && t.daalt && !t.stijgt && !t.stijgtHard, String(t.pct));
  const h = computeHealthScore(f);
  check("Efficiency krijgt de volle punten, niet 4", factor(h, "Efficiency").score === 20, String(factor(h, "Efficiency").score));
  check("geen melding 'CPA stijgt snel'", !h.anomalies.some((a) => a.title === "CPA stijgt snel"));
}
{
  // Tweede lezer: 12, 9, 11 en daarna 14, 13, 5 bij gelijke kosten gaf +22% terwijl de CPA over
  // beide vensters exact gelijk is (93,75).
  const conv = [12, 9, 11, 14, 13, 5];
  const t = cpaTrendFrom(maandPunten(conv.map((c) => 1000 / c)).map((p, i) => ({ ...p, kosten: 1000, conversies: conv[i] })));
  check("gelijke CPA over beide vensters geeft 0%", Math.abs(t.pct ?? 99) < 0.001, String(t.pct));
}
{
  // Te weinig volume: twee keer drie maanden met elk 2 conversies.
  const conv = [2, 2, 2, 1, 1, 2];
  const f = forecast({
    cpa: { kpi: kpi(), points: maandPunten(conv.map((c) => 500 / c)) },
    adSpend: { kpi: kpi(), points: maandPunten(conv.map(() => 500)) },
    conversions: { kpi: kpi(), points: maandPunten(conv) },
  });
  const t = cpaTrendVanForecast(f);
  check("onder 10 conversies per venster geen oordeel", t.teWeinigConversies && t.pct === null && !t.stijgt && !t.daalt);
  const h = computeHealthScore(f);
  check("en Efficiency staat op niet beoordeeld (geen 'stabiel')", !factor(h, "Efficiency").assessed && /niet beoordeeld/.test(factor(h, "Efficiency").description), factor(h, "Efficiency").description);
}

console.log("\nScorecards per campagnetype: dezelfde CPA-trend als de health-score");
{
  // Hetzelfde tegenvoorbeeld in de Display-scorecard (Search en Shopping rekenen via dezelfde
  // functie): € 1.000 per maand, conversies 10, 10, 10, 30, 30, 1.
  const conv = [10, 10, 10, 30, 30, 1];
  const rijen = conv.map((c, i) => ({ campaign_name: "D", month: `2026-0${i + 1}-01`, cost: 1000, conversions: c, clicks: 100, impressions: 10000 }));
  const eff = factor(computeDisplayScorecard(rijen, []), "Conversion Efficiency");
  check("de CPA daalt, dus de volle punten (was 4 van 20 bij +256%)", eff.assessed && eff.score === 20 && /-51%/.test(eff.description), `${eff.score} ${eff.description}`);
  const dun = conv.map((_, i) => ({ campaign_name: "D", month: `2026-0${i + 1}-01`, cost: 300, conversions: i < 3 ? 2 : 1, clicks: 50, impressions: 5000 }));
  const effDun = factor(computeDisplayScorecard(dun, []), "Conversion Efficiency");
  check("onder 10 conversies per venster geen oordeel", !effDun.assessed && /Te weinig conversies/.test(effDun.description), effDun.description);
}

console.log("\nHygiëne: teller en noemer over dezelfde 30 dagen, geen dubbeltelling");
{
  // Dezelfde verspilling (10% van een maand) gaf in februari 10% en in november 1%. Nu is de
  // noemer de besteding van dezelfde 30 dagen, dus de maand van het jaar doet er niet toe.
  const termen = [{ searchTerm: "gratis", campaignName: "C", adGroupName: "A", clicks: 20, cost: 100 }];
  const feb = computeHealthScore(forecast({ adSpend: { kpi: kpi({ ytdRealized: 2000 }), points: [] } }), [], termen, [], 1000);
  const nov = computeHealthScore(forecast({ adSpend: { kpi: kpi({ ytdRealized: 10000 }), points: [] } }), [], termen, [], 1000);
  check("februari en november geven dezelfde score", factor(feb, "Hygiëne").score === factor(nov, "Hygiëne").score, `${factor(feb, "Hygiëne").score} tegen ${factor(nov, "Hygiëne").score}`);
  check("10% verspilling is geen 'Weinig verspilling'", factor(nov, "Hygiëne").score === 10 && !/Weinig/.test(factor(nov, "Hygiëne").description), factor(nov, "Hygiëne").description);

  // Een term in een bleeder-advertentiegroep telt een keer, via de groep.
  const bleeders = [{ campaignName: "C", adGroupName: "A", cost: 100, conversions: 0, clicks: 30, impressions: 900 }];
  const dubbel = computeHealthScore(forecast(), [], termen, bleeders, 1000);
  check("zoekterm in een bleeder-groep telt niet dubbel (10%, niet 20%)", factor(dubbel, "Hygiëne").score === 10, factor(dubbel, "Hygiëne").description);

  const zonderData = computeHealthScore(forecast({ adSpend: { kpi: kpi({ ytdRealized: 10000 }), points: [] } }));
  check("zonder verspillingsdata niet beoordeeld (geen gratis 20 punten)", !factor(zonderData, "Hygiëne").assessed);
  const zonderNoemer = computeHealthScore(forecast({ adSpend: { kpi: kpi({ ytdRealized: 10000 }), points: [] } }), [], termen, []);
  check("zonder besteding over 30 dagen niet beoordeeld (geen jaar-noemer)", !factor(zonderNoemer, "Hygiëne").assessed);
}

console.log("\nBudget: overbesteding heeft een richting");
{
  const budget = (ytdRealized: number, ytdExpected: number, annualTarget = 100000) =>
    computeHealthScore(forecast({ adSpend: { kpi: kpi({ annualTarget, ytdRealized, ytdExpected }), points: [] } }));
  check("op tempo: 20", factor(budget(50000, 50000), "Budget").score === 20);
  const anderhalf = factor(budget(75000, 50000), "Budget");
  check("150% van het tempo is geen 20 van 20", anderhalf.score < 20 && /Overbesteding/.test(anderhalf.description), `${anderhalf.score} ${anderhalf.description}`);
  // De demo: € 117.300 van € 117.000 in november, bij 86% verwacht.
  const op = factor(budget(117300, 100620, 117000), "Budget");
  check("een jaarbudget dat al op is krijgt hooguit 4", op.score <= 4 && /al op/.test(op.description), `${op.score} ${op.description}`);
  check("onderbesteding heet zo", /Onderbesteding/.test(factor(budget(30000, 50000), "Budget").description));
}

console.log("\nGoogle: een berekening voor kaart, ranking en tabblad");
{
  const f = forecast({
    conversions: { kpi: kpi({ annualTarget: 2600, adjustedAnnual: 1300 }), points: maandPunten([100, 110]) },
    cpa: { kpi: kpi(), points: maandPunten([50, 48]) },
    adSpend: { kpi: kpi({ annualTarget: 117000, ytdRealized: 50000, ytdExpected: 50000 }), points: maandPunten([5000, 5280]) },
  });
  const staat = {
    wastefulSearchTerms: [{ searchTerm: "x", campaignName: "C", adGroupName: "A", clicks: 5, cost: 20 }],
    adGroupBleeders: [],
    accountStructure: { campaigns: [{ name: "C", cost30d: 4000 }, { name: "D", cost30d: 1000 }] },
  } as unknown as Parameters<typeof googleHealthScore>[1];
  const kaart = googleHealthScore(f, staat);
  const tab = computeHealthScore(f, undefined, staat!.wastefulSearchTerms, staat!.adGroupBleeders, 5000);
  check("dezelfde invoer, hetzelfde getal", kaart.total === tab.total, `${kaart.total} tegen ${tab.total}`);
  check("Hygiëne telt mee als de data er is", factor(kaart, "Hygiëne").assessed);
  const zonder = googleHealthScore(f, null);
  check("zonder providerdata staat Hygiëne op niet beoordeeld", !factor(zonder, "Hygiëne").assessed);
}

console.log("\nHygiëne: verspilling in een gepauzeerde campagne hoort niet bij de noemer");
{
  // De noemer is de besteding van de campagnes die nu aan staan (accountStructure); de lijsten
  // tellen ook een campagne die in de laatste 30 dagen gepauzeerd is. € 400 verspilling in
  // "Oud" tegen € 1.000 besteding in "Nu" gaf 40% en de laagste score.
  const staat = {
    wastefulSearchTerms: [
      { searchTerm: "x", campaignName: "Oud", adGroupName: "A", clicks: 50, cost: 400 },
      { searchTerm: "y", campaignName: "Nu", adGroupName: "B", clicks: 2, cost: 5 },
    ],
    adGroupBleeders: [],
    accountStructure: { campaigns: [{ name: "Nu", cost30d: 1000 }] },
  } as unknown as Parameters<typeof googleHealthScore>[1];
  const h = factor(googleHealthScore(forecast(), staat), "Hygiëne");
  check("alleen de verspilling in de lopende campagne telt (0,5%, volle punten)", h.assessed && h.score === 20, `${h.score} ${h.description}`);
  check("de verspilling in de gepauzeerde campagne staat er nog bij", /€\s?400.*niet aan staan/.test(h.description), h.description);
  check("de melding 'Zoekterm verspilling' noemt het volle bedrag", googleHealthScore(forecast(), staat).anomalies.some((a) => a.title === "Zoekterm verspilling" && /405/.test(a.description)));
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
