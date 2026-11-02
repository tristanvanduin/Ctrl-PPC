// Test: de blended prognose ("Alle kanalen") is de som van de prognoses per kanaal (lib/forecast-som.ts).
// Draaien: tsx lib/__forecast_som_test.ts
//
// Wat er misging. computeForecast op de OPTELLING van de kanalen nam een prestatiefactor over
// januari-juli die de kanaalmix mat in plaats van de prestatie: Microsoft telde dubbel (in 2025 pas
// vanaf 23 juli in de basis, in 2026 elke maand in het gerealiseerde), en Meta en LinkedIn kwamen
// alleen via die factor binnen, op Google's seizoenscurve. Op de demo: 5.182 conversies waar 4.782
// hoort, € 238.421 spend waar € 265.808 hoort, en de ROAS-kaart op +9% boven het doel waar hij -10%
// eronder staat. En de prognose hing van het doel af (de factor zat tegen de klem van 3,0).
//
// De demo-fixture hieronder is perKanaal zoals /api/blended/client-data hem voor demo-greentech op
// 1 november 2026 gaf (alleen-lezen uit de database), afgerond op centen.

import { computeForecast, jaarKaartCijfers, type ClientForecast } from "./forecast";
import * as som from "./forecast-som";
import { buildClientDataFromApi, type ApiMonthlyData, type YearDataInput } from "./api/adapter";
import { standaardJaardoel } from "./analysis/standaard-jaardoel";
import type { BlendedKanaalReeks } from "./api/blended-historical";
import type { ClientAnnualData, ClientHistoricalData } from "./types";
import { monthsIn } from "./period/period-range";
import * as kanaalMaanden from "./period/kanaal-maanden";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const dicht = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// Op de oude code bestaat de module niet; dan per geval falen in plaats van op de import.
const { blendedForecastUitKanalen, somForecast, kanaalHistorieUitMaanden } = som as Partial<typeof som>;

type Rij = [string, number, number, number];
const reeks = (kanaal: BlendedKanaalReeks["kanaal"], vanaf: string | null, rijen: Rij[]): BlendedKanaalReeks =>
  ({ kanaal, vanaf, maanden: rijen.map(([month, conversions, revenue, adSpend]) => ({ month, conversions, revenue, adSpend })) });
const api = (rijen: [number, number, number, number][]): ApiMonthlyData[] =>
  rijen.map(([month, conversions, revenue, adSpend]) => ({ month, conversions, revenue, adSpend, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 }));

// ── De demo ────────────────────────────────────────────────────────────────────────────────
const DEMO: BlendedKanaalReeks[] = [
  reeks("google", null, [["2024-09", 129, 25020, 11150], ["2024-10", 113, 22060, 11100], ["2024-11", 99, 19430, 11050], ["2024-12", 93, 18150, 11150], ["2025-01", 88, 17010, 11100], ["2025-02", 92, 17440, 11050], ["2025-03", 103, 19300, 11150], ["2025-04", 113, 21010, 11100], ["2025-05", 127, 23640, 11050], ["2025-06", 143, 26670, 11150], ["2025-07", 138, 26060, 11100], ["2025-08", 134, 25630, 11050], ["2025-09", 117, 23130, 11150], ["2025-10", 105, 20830, 11100], ["2025-11", 93, 18490, 11050], ["2025-12", 87, 17210, 11150], ["2026-01", 90, 17190, 12000], ["2026-02", 91, 17110, 11950], ["2026-03", 97, 18090, 12050], ["2026-04", 104, 19330, 12000], ["2026-05", 115, 21450, 11950], ["2026-06", 128, 23970, 12050], ["2026-07", 126, 23870, 12000], ["2026-08", 126, 24170, 11950]]),
  // Meta en LinkedIn vanaf 13 maart 2026, Microsoft vanaf 23 juli 2025: de eerste volle maand is de maand erna.
  reeks("meta", "2026-04", [["2026-03", 114, 14820, 2850], ["2026-04", 180, 23400, 4500], ["2026-05", 186, 24180, 4650], ["2026-06", 180, 23400, 4500], ["2026-07", 186, 24180, 4650], ["2026-08", 156, 20280, 3900]]),
  reeks("linkedin", "2026-04", [["2026-03", 33, 3120, 1900], ["2026-04", 53, 4800, 3000], ["2026-05", 54, 4800, 3100], ["2026-06", 53, 4800, 3000], ["2026-07", 106, 14880, 9300], ["2026-08", 88, 12480, 7800]]),
  reeks("microsoft", "2025-08", [["2025-07", 23.49, 4205.7, 297], ["2025-08", 80.91, 14486.3, 1023], ["2025-09", 78.3, 14019, 990], ["2025-10", 80.91, 14486.3, 1023], ["2025-11", 78.3, 14019, 990], ["2025-12", 80.91, 14486.3, 1023], ["2026-01", 80.91, 14486.3, 1023], ["2026-02", 73.08, 13084.4, 924], ["2026-03", 80.91, 14486.3, 1023], ["2026-04", 78.3, 14019, 990], ["2026-05", 85.87, 15329.5, 1023], ["2026-06", 80.56, 14403.71, 990], ["2026-07", 72.97, 13137.35, 1023], ["2026-08", 56.79, 10268.75, 858]]),
];
// De optelling zoals de route hem geeft (historicalYears, currentYearMonthly t/m juli).
const DEMO_HIST: YearDataInput[] = [
  { year: 2024, monthly: api([[9, 129, 25020, 11150], [10, 113, 22060, 11100], [11, 99, 19430, 11050], [12, 93, 18150, 11150]]), weekly: [] },
  { year: 2025, monthly: api([[1, 88, 17010, 11100], [2, 92, 17440, 11050], [3, 103, 19300, 11150], [4, 113, 21010, 11100], [5, 127, 23640, 11050], [6, 143, 26670, 11150], [7, 161, 30266, 11397], [8, 215, 40116, 12073], [9, 195, 37149, 12140], [10, 186, 35316, 12123], [11, 171, 32509, 12040], [12, 168, 31696, 12173]]), weekly: [] },
];
const DEMO_HUIDIG = api([[1, 171, 31676, 13023], [2, 164, 30194, 12874], [3, 325, 50516, 17823], [4, 415, 61549, 20490], [5, 441, 65760, 20723], [6, 442, 66574, 20540], [7, 491, 76067, 26973]]);
// De opgeslagen kpi_targets van de demo: 2.600 conversies, omzet het standaarddoel, CPA 45 (dus spend 2.600 x 45).
const DOEL: ClientAnnualData = { conversions: 2600, revenue: 365334, adSpend: 117000 };
const samenMet = (doel: ClientAnnualData): ClientHistoricalData => buildClientDataFromApi("demo-greentech", DEMO_HIST, DEMO_HUIDIG, [], doel, 2026, 7);

console.log("De demo: de som per kanaal");
if (typeof blendedForecastUitKanalen !== "function" || typeof kanaalHistorieUitMaanden !== "function" || typeof somForecast !== "function") {
  check("lib/forecast-som.ts bestaat", false);
} else {
  const samen = samenMet(DOEL);
  const f = blendedForecastUitKanalen("demo-greentech", DEMO, samen, 7);
  const oud = computeForecast(samen);
  const conv = f.conversions.kpi.adjustedAnnual, omzet = f.revenue.kpi.adjustedAnnual, spend = f.adSpend.kpi.adjustedAnnual;
  // Oud: 5.182 / € 811.987 / € 238.421, ROAS 3,41, CPA € 46,01.
  check("oud gaf 5.182 conversies (de optelling)", dicht(oud.conversions.kpi.adjustedAnnual, 5182, 2), String(oud.conversions.kpi.adjustedAnnual));
  check("conversies ~4.782", dicht(conv, 4782, 5), String(conv));
  check("omzet ~€ 743.000", dicht(omzet, 743500, 1500), String(omzet));
  check("spend ~€ 265.800", dicht(spend, 265800, 300), String(spend));
  check("ROAS ~2,80", dicht(f.roas.kpi.adjustedAnnual, 2.8, 0.01), String(f.roas.kpi.adjustedAnnual));
  check("CPA ~€ 55,6", dicht(f.cpa.kpi.adjustedAnnual, 55.6, 0.1), String(f.cpa.kpi.adjustedAnnual));
  // De richting op de kaarten: ROAS onder het doel (3,12), CPA erboven (45). Oud: +9,3% en +2,2%.
  const roasKaart = jaarKaartCijfers(f, "roas"), cpaKaart = jaarKaartCijfers(f, "cpa");
  check("ROAS-kaart onder het doel (~-10%)", dicht(roasKaart.diffPct, -10.3, 0.6), String(roasKaart.diffPct));
  check("CPA-kaart boven het doel (~+23,5%)", dicht(cpaKaart.diffPct, 23.5, 0.6), String(cpaKaart.diffPct));
  check("gerealiseerd t/m juli is de optelling: 2.449 conversies", dicht(f.conversions.kpi.ytdRealized, 2449, 2), String(f.conversions.kpi.ytdRealized));

  // De som, op de manier van de kanaaltabs: per kanaal computeForecast op zijn eigen historie.
  const delen = DEMO.map((k) => computeForecast(kanaalHistorieUitMaanden("demo-greentech", k, 2026, 7)));
  for (const m of ["conversions", "revenue", "adSpend"] as const) {
    const opgeteld = delen.reduce((s, d) => s + d[m].kpi.adjustedAnnual, 0);
    check(`${m}: de blended prognose is de som van de kanalen`, dicht(f[m].kpi.adjustedAnnual, opgeteld, 1e-6), `${f[m].kpi.adjustedAnnual} / ${opgeteld}`);
    for (let i = 7; i < 12; i++) {
      const p = delen.reduce((s, d) => s + (d[m].points[i].forecast ?? 0), 0);
      if (f[m].points[i].forecast !== p) check(`${m} maand ${i + 1}: de som van de kanaalprognoses`, false, `${f[m].points[i].forecast} / ${p}`);
    }
  }
  // De weken tellen op tot de maand: de beursstrip leest ze, de tabel leest de maanden. Hier stond
  // "de weekprognose is de som van de emmers per kanaal" (W1 november), en dat legde de fout vast:
  // zonder doel geeft computeForecast elke emmer het weektempo maar de maand het tempo x 52/12,
  // dus telden de vijf emmers van oktober bij Meta en LinkedIn 5 weken op en de vier van november
  // er 4. De strip toonde oktober 129 per week en november 85, waar de tabel 465 en 452 zei.
  for (const m of ["conversions", "revenue", "adSpend"] as const) {
    for (let maand = 8; maand <= 12; maand++) {
      const weken = f[m].weeklyPoints.filter((w) => w.month === maand).reduce((s, w) => s + (w.forecast ?? 0), 0);
      const p = f[m].points[maand - 1].forecast ?? 0;
      if (!dicht(weken, p, 3)) check(`${m} maand ${maand}: de weken tellen op tot de maand`, false, `${weken} / ${p}`);
    }
  }
  const oktW = f.conversions.weeklyPoints.filter((w) => w.month === 10).map((w) => w.forecast ?? 0);
  const novW = f.conversions.weeklyPoints.filter((w) => w.month === 11).map((w) => w.forecast ?? 0);
  check("een week in oktober is geen 11% te hoog meer, een in november geen 6% te laag",
    oktW.every((w) => dicht(w, (f.conversions.points[9].forecast ?? 0) / oktW.length, 2)) && novW.every((w) => dicht(w, (f.conversions.points[10].forecast ?? 0) / novW.length, 2)),
    `${oktW.join("/")} | ${novW.join("/")}`);

  // Onafhankelijk van het doel: een doel schaalt alleen de verwachting.
  const dubbel = blendedForecastUitKanalen("demo-greentech", DEMO, samenMet({ conversions: 5200, revenue: 730668, adSpend: 234000 }), 7);
  check("een twee keer zo hoog doel: dezelfde prognose", dubbel.conversions.kpi.adjustedAnnual === conv && dubbel.adSpend.kpi.adjustedAnnual === spend,
    `${dubbel.conversions.kpi.adjustedAnnual} / ${conv}`);
  check("en het doel zelf staat er wel twee keer zo hoog", dubbel.conversions.kpi.annualTarget === 5200);
  const googleDoel = blendedForecastUitKanalen("demo-greentech", DEMO, samenMet(standaardJaardoel({ conversions: 1340, revenue: 256420, adSpend: 133200 })), 7);
  check("met het Google-only standaarddoel ook (oud: 4.777 tegen 5.182 door de klem)", googleDoel.conversions.kpi.adjustedAnnual === conv,
    `${googleDoel.conversions.kpi.adjustedAnnual}`);
  // Een handmatige correctie (600 in mei-juli) tilt de rest van het jaar op, ongeveer zoveel als op
  // de optelling: daar 2.733 -> 3.214 in augustus-december. De som gaf 2.332 -> 2.332: de correctie
  // verving alleen het gerealiseerde.
  const aDec = (x: ClientForecast) => x.conversions.points.slice(7).reduce((s, p) => s + (p.forecast ?? 0), 0);
  const correctie = { "2026-05": 600, "2026-06": 600, "2026-07": 600 };
  const gecorrigeerd = blendedForecastUitKanalen("demo-greentech", DEMO, { ...samen, conversionOverrides: correctie }, 7);
  const oudGecorrigeerd = computeForecast({ ...samen, conversionOverrides: correctie });
  const erbij = aDec(gecorrigeerd) - aDec(f), oudErbij = aDec(oudGecorrigeerd) - aDec(oud);
  check("demo: een correctie naar boven tilt augustus-december op, ongeveer als op de optelling",
    erbij > 0 && dicht(erbij / oudErbij, 1, 0.15), `${aDec(f)} -> ${aDec(gecorrigeerd)} (optelling ${aDec(oud)} -> ${aDec(oudGecorrigeerd)})`);
  check("en mei-juli zijn de correctie", gecorrigeerd.conversions.points.slice(4, 7).every((p) => p.realized === 600));
  const lijn = f.conversions.points.reduce((s, p) => s + p.expected, 0);
  check("de verwachtingslijn telt op tot het doel", dicht(lijn, 2600, 12), String(lijn));
  check("ytdExpected is de lijn t/m juli", f.conversions.kpi.ytdExpected === f.conversions.points.slice(0, 7).reduce((s, p) => s + p.expected, 0));
}

// ── De historie per kanaal ──────────────────────────────────────────────────────────────────
console.log("kanaalHistorieUitMaanden");
if (typeof kanaalHistorieUitMaanden === "function") {
  const ms = kanaalHistorieUitMaanden("demo", DEMO[3], 2026, 7);
  check("de partiële juli 2025 valt uit de historie", ms.historicalYears[2025][6].conversions === 0 && ms.historicalYears[2025][7].conversions === 81,
    JSON.stringify(ms.historicalYears[2025].map((m) => m.conversions)));
  // Geen groei op een deeljaar, wel het deeljaar op jaarbasis. Hier stond een doel van nul: dan nam
  // computeForecast het gemeten totaal van augustus-december (399) als jaardoel, en dat legt een
  // twaalfmaandsvorm over vijf maanden. Bij vijf maanden gaf dat een factor van 2,4; bij drie of
  // minder zat hij tegen de klem van 3,0 en kwam de prognose 25-50% te laag uit.
  check("een deeljaar is geen vol vorig jaar: geen groeidoel, wel het deeljaar op jaarbasis (399 x 12 / 5)",
    ms.targetCurrentYear.conversions === 958, JSON.stringify(ms.targetCurrentYear));
  const meta = kanaalHistorieUitMaanden("demo", DEMO[1], 2026, 7);
  check("de partiële maart 2026 blijft in het lopende jaar staan (hij is gerealiseerd)", meta.currentYearData[2]?.conversions === 114,
    JSON.stringify(meta.currentYearData.map((m) => m?.conversions ?? null)));
  check("en augustus (na de grens) niet", meta.currentYearData[7] === null);
  const g = kanaalHistorieUitMaanden("demo", DEMO[0], 2026, 7);
  check("Google liep heel 2025: vorig jaar +10%", g.targetCurrentYear.conversions === 1474, JSON.stringify(g.targetCurrentYear));
  check("alle kanalen hetzelfde weekraster (leeg, dus gelijk verdeeld)", g.currentYearData[0]!.weeks.length === 5 && meta.currentYearData[3]!.weeks.length === 4);

  // Een gat in het lopende jaar is een echte nul, zodat de reeks tot dezelfde grens loopt.
  const gat = reeks("meta", null, [["2026-01", 10, 0, 100], ["2026-02", 10, 0, 100], ["2026-03", 10, 0, 100], ["2026-04", 10, 0, 100], ["2026-05", 10, 0, 100]]);
  const h = kanaalHistorieUitMaanden("t", gat, 2026, 7);
  check("juni en juli zonder rij: nulmaanden, geen null", h.currentYearData[5]?.conversions === 0 && h.currentYearData[6]?.conversions === 0,
    JSON.stringify(h.currentYearData.map((m) => m?.conversions ?? null)));
  check("en de prognose loopt dan t/m dezelfde grens", computeForecast(h).conversions.kpi.realizedThroughMonth === 7);
}

// ── Twee synthetische kanalen ───────────────────────────────────────────────────────────────
console.log("Twee kanalen: een met vorig jaar, een nieuw dit jaar");
if (typeof blendedForecastUitKanalen === "function" && typeof somForecast === "function" && typeof kanaalHistorieUitMaanden === "function") {
  const maanden = (jaar: number, van: number, tot: number, conv: (m: number) => number, spend: number): Rij[] =>
    Array.from({ length: tot - van + 1 }, (_, i) => [`${jaar}-${String(van + i).padStart(2, "0")}`, conv(van + i), conv(van + i) * 100, spend]);
  const seizoen = (m: number) => 50 + 10 * Math.sin((m / 12) * 2 * Math.PI);
  const a = reeks("google", null, [...maanden(2025, 1, 12, seizoen, 1000), ...maanden(2026, 1, 7, (m) => seizoen(m) * 0.9, 1000)]);
  const b = reeks("meta", "2026-04", [["2026-03", 20, 2000, 300], ...maanden(2026, 4, 7, () => 60, 900)]);
  // De optelling zoals de route hem bouwt.
  const opt = (rijen: Rij[]) => {
    const per = new Map<string, [number, number, number]>();
    for (const [k, c, r, s] of rijen) { const t = per.get(k) ?? [0, 0, 0]; per.set(k, [t[0] + c, t[1] + r, t[2] + s]); }
    return per;
  };
  const alle = opt([...a.maanden, ...b.maanden].map((m) => [m.month, m.conversions, m.revenue, m.adSpend]));
  const jaarApi = (jaar: number) => api([...alle].filter(([k]) => k.startsWith(`${jaar}-`)).map(([k, [c, r, s]]) => [Number(k.slice(5)), Math.round(c), Math.round(r), Math.round(s)]));
  const doel = standaardJaardoel({ conversions: jaarApi(2025).reduce((s, m) => s + m.conversions, 0), revenue: 0, adSpend: 12000 });
  const samen = buildClientDataFromApi("t", [{ year: 2025, monthly: jaarApi(2025), weekly: [] }], jaarApi(2026), [], doel, 2026, 7);

  const f = blendedForecastUitKanalen("t", [a, b], samen, 7);
  // Onafhankelijk nagebouwd, zoals een kanaaltab het per kanaal doet.
  const losA = computeForecast(buildClientDataFromApi("t", [{ year: 2025, monthly: api(a.maanden.filter((m) => m.month < "2026").map((m) => [Number(m.month.slice(5)), Math.round(m.conversions), Math.round(m.revenue), Math.round(m.adSpend)])), weekly: [] }],
    api(a.maanden.filter((m) => m.month >= "2026").map((m) => [Number(m.month.slice(5)), Math.round(m.conversions), Math.round(m.revenue), Math.round(m.adSpend)])), [],
    standaardJaardoel({ conversions: a.maanden.filter((m) => m.month < "2026").reduce((s, m) => s + Math.round(m.conversions), 0), revenue: a.maanden.filter((m) => m.month < "2026").reduce((s, m) => s + Math.round(m.revenue), 0), adSpend: 12000 }), 2026, 7));
  const losB = computeForecast(buildClientDataFromApi("t", [], api(b.maanden.map((m) => [Number(m.month.slice(5)), m.conversions, m.revenue, m.adSpend])), [], standaardJaardoel(null), 2026, 7));
  check("de som is A + B, los nagerekend", dicht(f.conversions.kpi.adjustedAnnual, losA.conversions.kpi.adjustedAnnual + losB.conversions.kpi.adjustedAnnual, 1e-6),
    `${f.conversions.kpi.adjustedAnnual} / ${losA.conversions.kpi.adjustedAnnual} + ${losB.conversions.kpi.adjustedAnnual}`);
  check("en spend ook", dicht(f.adSpend.kpi.adjustedAnnual, losA.adSpend.kpi.adjustedAnnual + losB.adSpend.kpi.adjustedAnnual, 1e-6));
  // Op de optelling telde B's volume als groei van A's basis.
  const oud = computeForecast(samen);
  check("de optelling geeft iets anders (de mix als groei)", Math.abs(oud.conversions.kpi.adjustedAnnual - f.conversions.kpi.adjustedAnnual) > 20,
    `${oud.conversions.kpi.adjustedAnnual} / ${f.conversions.kpi.adjustedAnnual}`);

  // Een gestopt kanaal (alleen vorig jaar) telt niet mee in de prognose: niets om op te projecteren.
  const gestopt = reeks("linkedin", null, maanden(2025, 1, 12, () => 30, 500));
  const metGestopt = blendedForecastUitKanalen("t", [a, b, gestopt], samen, 7);
  check("een gestopt kanaal voegt geen prognose toe", dicht(metGestopt.conversions.kpi.adjustedAnnual, f.conversions.kpi.adjustedAnnual, 1e-6),
    `${metGestopt.conversions.kpi.adjustedAnnual} / ${f.conversions.kpi.adjustedAnnual}`);

  // Zonder perKanaal (een antwoord van vóór dit veld): de oude berekening, geen leeg overzicht.
  check("zonder kanalen: computeForecast op de optelling", blendedForecastUitKanalen("t", [], samen, 7).conversions.kpi.adjustedAnnual === oud.conversions.kpi.adjustedAnnual);

  // Een handmatige correctie vervangt het opgetelde gerealiseerde van die maand, zoals voorheen.
  const gecorrigeerd = blendedForecastUitKanalen("t", [a, b], { ...samen, conversionOverrides: { "2026-03": 999 } }, 7);
  check("conversionOverrides: maart wordt 999", gecorrigeerd.conversions.points[2].realized === 999, String(gecorrigeerd.conversions.points[2].realized));
  // Hier stond "de jaarprognose schuift even veel mee": het verschil in de jaarprognose was precies
  // 999 min maart. Dat legde vast dat de correctie alleen het gerealiseerde verving en de projectie
  // liet staan, terwijl hij op de optelling ook in de prestatiefactor telt (forecastCoreMetric: "dan
  // telt een conversionOverride mee"). Een correctie van een trackingbreuk naar boven moet de
  // rest van het jaar dus ook optillen. Nu: verdeeld over de kanalen naar hun aandeel in die maand,
  // zodat elk kanaal hem in zijn eigen factor ziet.
  const toekomst = (x: ClientForecast) => x.conversions.points.slice(7).reduce((s, p) => s + (p.forecast ?? 0), 0);
  const correctie = Object.fromEntries([5, 6, 7].map((m) => [`2026-0${m}`, Math.round((f.conversions.points[m - 1].realized ?? 0) * 1.3)]));
  const omhoog = blendedForecastUitKanalen("t", [a, b], { ...samen, conversionOverrides: correctie }, 7);
  const oudOmhoog = computeForecast({ ...samen, conversionOverrides: correctie });
  check("een correctie naar boven tilt ook de projectie op, zoals op de optelling", toekomst(omhoog) > toekomst(f) + 1 && toekomst(oudOmhoog) > toekomst(oud) + 1,
    `${toekomst(omhoog)} / ${toekomst(f)}`);
  check("en het gerealiseerde van die maanden is de correctie", [5, 6, 7].every((m) => omhoog.conversions.points[m - 1].realized === correctie[`2026-0${m}`]),
    JSON.stringify(omhoog.conversions.points.slice(4, 7).map((p) => p.realized)));

  // De voorwaarde: dezelfde grens bij elk kanaal.
  const kort = computeForecast(kanaalHistorieUitMaanden("t", a, 2026, 6));
  const lang = computeForecast(kanaalHistorieUitMaanden("t", b, 2026, 7));
  let gegooid = false;
  try { somForecast([kort, lang] as ClientForecast[], doel, samen); } catch { gegooid = true; }
  check("ongelijke grens: een fout, geen verschoven optelling", gegooid);
}

// ── Een kanaal dat stopte, en januari ───────────────────────────────────────────────────────
console.log("Een kanaal dat dit jaar stopte, en januari");
if (typeof blendedForecastUitKanalen === "function") {
  const vlak = (kanaal: BlendedKanaalReeks["kanaal"], van: string, tot: string, conv: number): BlendedKanaalReeks =>
    reeks(kanaal, null, monthsIn({ start: van, end: tot }).map((k): Rij => [k, conv, conv * 100, conv * 10]));
  // De optelling zoals de route hem bouwt: historische jaren, het lopende jaar t/m de grens, en als
  // doel vorig jaar +10%.
  const optelling = (reeksen: BlendedKanaalReeks[], jaar: number, rtm: number): ClientHistoricalData => {
    const per = new Map<string, [number, number, number]>();
    for (const r of reeksen) for (const m of r.maanden) {
      const t = per.get(m.month) ?? [0, 0, 0];
      per.set(m.month, [t[0] + m.conversions, t[1] + m.revenue, t[2] + m.adSpend]);
    }
    const vanJaar = (j: number) => api([...per].filter(([k]) => Number(k.slice(0, 4)) === j && (j < jaar || Number(k.slice(5)) <= rtm))
      .map(([k, [c, r, s]]) => [Number(k.slice(5)), c, r, s]));
    const jaren = [...new Set([...per.keys()].map((k) => Number(k.slice(0, 4))))].filter((j) => j < jaar).sort();
    const vorig = vanJaar(jaar - 1);
    const doel = standaardJaardoel(vorig.length > 0 ? { conversions: vorig.reduce((s, m) => s + m.conversions, 0), revenue: vorig.reduce((s, m) => s + m.revenue, 0), adSpend: vorig.reduce((s, m) => s + m.adSpend, 0) } : null);
    return buildClientDataFromApi("t", jaren.map((j) => ({ year: j, monthly: vanJaar(j), weekly: [] })), vanJaar(jaar), [], doel, jaar, rtm);
  };

  // LinkedIn stopte eind april (gepauzeerd met een gezonde sync, of ontkoppeld: de route zet hem in
  // `uitgesloten` en het venster loopt door t/m september). Mei t/m september zijn nullen, en die
  // gooit de prestatiefactor per kanaal weg als trackingbreuk: dan projecteerde de som LinkedIn op
  // zijn tempo van januari-april, 150 per maand voor oktober-december waar alleen Google loopt (100).
  // De optelling gaf 118; waar is 900 + 200 gerealiseerd plus 3 x 100.
  const google = vlak("google", "2025-01", "2026-09", 100);
  const linkedin = vlak("linkedin", "2025-01", "2026-04", 50);
  const s1 = optelling([google, linkedin], 2026, 9);
  for (const [label, f] of [["zonder stand", blendedForecastUitKanalen("t", [google, linkedin], s1, 9)], ["met LinkedIn in uitgesloten", blendedForecastUitKanalen("t", [google, linkedin], s1, 9, ["linkedin"])]] as const) {
    check(`gestopt kanaal (${label}): oktober-december alleen Google`, f.conversions.points.slice(9).every((p) => p.forecast === 100),
      JSON.stringify(f.conversions.points.slice(9).map((p) => p.forecast)));
    check(`(${label}) het jaar: 1.400`, f.conversions.kpi.adjustedAnnual === 1400, String(f.conversions.kpi.adjustedAnnual));
    check(`(${label}) het gerealiseerde blijft: LinkedIn januari-april telt`, f.conversions.kpi.ytdRealized === 1100, String(f.conversions.kpi.ytdRealized));
    const novWeken = f.conversions.weeklyPoints.filter((w) => w.month === 11).reduce((s, w) => s + (w.forecast ?? 0), 0);
    check(`(${label}) de weken van november ook alleen Google`, dicht(novWeken, 100, 2), String(novWeken));
    check(`(${label}) spend idem`, f.adSpend.points.slice(9).every((p) => p.forecast === 1000), JSON.stringify(f.adSpend.points.slice(9).map((p) => p.forecast)));
  }
  // Data t/m september (de grens) en toch gestopt: dat weet alleen de route (`uitgesloten`).
  const tot9 = vlak("linkedin", "2025-01", "2026-09", 50);
  const s1b = optelling([google, tot9], 2026, 9);
  check("in september nog data: zonder stand loopt LinkedIn door", blendedForecastUitKanalen("t", [google, tot9], s1b, 9).conversions.points[9].forecast === 150);
  check("met LinkedIn in uitgesloten niet", blendedForecastUitKanalen("t", [google, tot9], s1b, 9, ["linkedin"]).conversions.points[9].forecast === 100);

  // Januari: de grens is 0, dus elk kanaal had "dezelfde grens", ook een dat al jaren stil ligt.
  // Meta liep alleen in 2024; zijn doel viel terug op dat jaar en werd voor 2026 geprojecteerd:
  // 1.920 (160 per maand) waar de optelling 1.320 gaf. In februari viel hij weer weg.
  const g2 = vlak("google", "2024-01", "2025-12", 100);
  const meta2 = vlak("meta", "2024-01", "2024-12", 50);
  const jan = blendedForecastUitKanalen("t", [g2, meta2], optelling([g2, meta2], 2026, 0), 0);
  check("januari: een kanaal dat alleen in 2024 liep telt niet mee", jan.conversions.kpi.adjustedAnnual === 1320, String(jan.conversions.kpi.adjustedAnnual));
  check("en Google zelf gewoon wel: 110 per maand", jan.conversions.points.every((p) => p.forecast === 110), JSON.stringify(jan.conversions.points.map((p) => p.forecast)));

  // ── Wat de stopregel en de grens nog misten ────────────────────────────────────────────────
  const jaarDeel = (f: ClientForecast, van: number) => f.conversions.points.slice(van).map((p) => p.forecast);
  const rijen = (van: string, tot: string, conv: number): Rij[] => monthsIn({ start: van, end: tot }).map((k): Rij => [k, conv, conv * 100, conv * 10]);
  const eigen = (r: BlendedKanaalReeks, jaar: number, rtm: number) => computeForecast(kanaalHistorieUitMaanden!("t", r, jaar, rtm));

  // Een seizoenspauze is geen stop. LinkedIn loopt elk jaar januari-maart en oktober-december; op
  // de grens september heeft hij sinds maart geen data, en dat las als gestopt: oktober-december
  // kreeg nul, waar zijn eigen tab (en de optelling) 50 per maand gaf.
  const g3 = vlak("google", "2025-01", "2026-09", 100);
  const seizoen = reeks("linkedin", "2025-01", [...rijen("2025-01", "2025-03", 50), ...rijen("2025-10", "2025-12", 50), ...rijen("2026-01", "2026-03", 50)]);
  const s3 = blendedForecastUitKanalen("t", [g3, seizoen], optelling([g3, seizoen], 2026, 9), 9);
  const losSeizoen = eigen(seizoen, 2026, 9).conversions.kpi.adjustedAnnual + eigen(g3, 2026, 9).conversions.kpi.adjustedAnnual;
  check("seizoenspauze: oktober-december is Google plus LinkedIn (150)", jaarDeel(s3, 9).every((v) => v === 150), JSON.stringify(jaarDeel(s3, 9)));
  check("seizoenspauze: het jaar is de som van de kanaaltabs (1.500)", s3.conversions.kpi.adjustedAnnual === losSeizoen && losSeizoen === 1500,
    `${s3.conversions.kpi.adjustedAnnual} / ${losSeizoen}`);
  // Een echte stop blijft een stop: heel 2025 gelopen, gestopt na mei 2026.
  const echtGestopt = vlak("linkedin", "2025-01", "2026-05", 50);
  const s3b = blendedForecastUitKanalen("t", [g3, echtGestopt], optelling([g3, echtGestopt], 2026, 9), 9);
  check("en een kanaal dat vorig jaar in die maanden wél liep, is nog steeds gestopt", jaarDeel(s3b, 9).every((v) => v === 100), JSON.stringify(jaarDeel(s3b, 9)));

  // Terug in de partiële maand. LinkedIn liep augustus-december 2025 (60 per maand), lag januari-
  // juli 2026 stil en draait sinds 3 augustus weer. Zonder rij t/m de grens (juli) kreeg hij grens
  // 0 en viel hij stil uit de som: "Alle kanalen" was Google alleen, en niets zei dat erbij.
  const g5 = vlak("google", "2025-01", "2026-08", 100);
  const terug = reeks("linkedin", "2025-08", [...rijen("2025-08", "2025-12", 60), ["2026-08", 45, 4500, 450]]);
  const s5 = blendedForecastUitKanalen("t", [g5, terug], optelling([g5, terug], 2026, 7), 7);
  const linkedinEigen = eigen(terug, 2026, 7);
  check("terug in augustus: augustus-december is Google plus LinkedIn's eigen prognose",
    s5.conversions.points.slice(7).every((p, i) => p.forecast === 100 + (linkedinEigen.conversions.points[7 + i].forecast ?? 0)) && s5.conversions.points[7].forecast! > 100,
    `${JSON.stringify(jaarDeel(s5, 7))} / LinkedIn ${JSON.stringify(linkedinEigen.conversions.points.slice(7).map((p) => p.forecast))}`);
  check("terug in augustus: januari-juli blijven gerealiseerd zonder LinkedIn-prognose ervoor",
    s5.conversions.points.slice(0, 7).every((p) => p.realized === 100 && p.forecast === null) && s5.conversions.kpi.ytdRealized === 700,
    JSON.stringify(s5.conversions.points.slice(0, 7).map((p) => [p.realized, p.forecast])));
  check("terug in augustus: de weken van augustus-december tellen LinkedIn ook",
    dicht(s5.conversions.weeklyPoints.filter((w) => w.month >= 8).reduce((s, w) => s + (w.forecast ?? 0), 0), s5.conversions.points.slice(7).reduce((s, p) => s + (p.forecast ?? 0), 0), 6));

  // Een deeljaar als vorig jaar. Microsoft begon op 1 oktober 2025, vlak 80 per maand. Met het
  // deeljaartotaal (240) als jaardoel kwam de factor op 4 en werd hij op 3,0 geklemd: 60 per maand
  // (bij een start in november 39) terwijl hij al zeven maanden 80 doet.
  for (const start of ["2025-10", "2025-11", "2025-12"]) {
    const g4 = vlak("google", "2025-01", "2026-07", 100);
    const ms = reeks("microsoft", start, rijen(start, "2026-07", 80));
    const s4 = blendedForecastUitKanalen("t", [g4, ms], optelling([g4, ms], 2026, 7), 7);
    check(`deeljaar vanaf ${start}: Microsoft op zijn tempo, augustus-december 180`, jaarDeel(s4, 7).every((v) => v === 180), JSON.stringify(jaarDeel(s4, 7)));
    check(`deeljaar vanaf ${start}: spend ook (1.800)`, s4.adSpend.points.slice(7).every((p) => p.forecast === 1800), JSON.stringify(s4.adSpend.points.slice(7).map((p) => p.forecast)));
  }

  // Januari, een kanaal dat vorig jaar halverwege begon. Meta sinds 13 maart 2026 op 180 per
  // maand; in januari 2027 is er nog niets gerealiseerd, en de maanden vóór zijn start hadden geen
  // historie: verwachting nul, dus prognose nul voor januari-maart terwijl hij gewoon doorloopt.
  const g2b = vlak("google", "2025-01", "2026-12", 100);
  const meta3 = reeks("meta", "2026-04", [["2026-03", 110, 11000, 1100], ...rijen("2026-04", "2026-12", 180)]);
  const jan27 = blendedForecastUitKanalen("t", [g2b, meta3], optelling([g2b, meta3], 2027, 0), 0);
  check("januari: Meta loopt door, elke maand 110 + 180", jan27.conversions.points.every((p) => p.forecast === 290), JSON.stringify(jan27.conversions.points.map((p) => p.forecast)));
  check("januari: het jaar 3.480", jan27.conversions.kpi.adjustedAnnual === 3480, String(jan27.conversions.kpi.adjustedAnnual));

  // De partiële eerste maand als laatste gerealiseerde maand. Meta sinds 20 juli: 40 conversies in
  // 12 dagen. Zonder doel projecteerde hij op juli gedeeld door 31 dagen, 39 per maand, terwijl zijn
  // tempo 103 is. De route geeft de eerste dag mee.
  const g6 = vlak("google", "2025-01", "2026-08", 100);
  const juliStart = (eersteDag: string | null): BlendedKanaalReeks => ({ ...reeks("meta", "2026-08", [["2026-07", 40, 4000, 400], ["2026-08", 86, 8600, 860]]), eersteDag });
  const metDag = blendedForecastUitKanalen("t", [g6, juliStart("2026-07-20")], optelling([g6, juliStart(null)], 2026, 7), 7);
  check("eerste dag 20 juli: Meta op 40 / 12 dagen, augustus-december 201", jaarDeel(metDag, 7).every((v) => v === 201), JSON.stringify(jaarDeel(metDag, 7)));
  check("en het gerealiseerde van juli blijft 40 + 100", metDag.conversions.points[6].realized === 140, String(metDag.conversions.points[6].realized));
  const zonderDag = blendedForecastUitKanalen("t", [g6, juliStart(null)], optelling([g6, juliStart(null)], 2026, 7), 7);
  check("zonder eerste dag: zoals voorheen (139)", jaarDeel(zonderDag, 7).every((v) => v === 139), JSON.stringify(jaarDeel(zonderDag, 7)));

  // Een gat van vóór de start is geen seizoen. LinkedIn liep 60 per maand van november 2025 t/m
  // maart 2026 en is daarna gestopt. De seizoensregel keek alleen of het kanaal vorig jaar NA het
  // gat weer liep (november-december 2025: ja), niet of het er vóór het gat al was. April-oktober
  // 2025 lagen vóór zijn start, lazen als "vorig jaar ook leeg", en de stop werd een pauze:
  // november-december kregen 160 waar alleen Google loopt. Een maand eerder starten (oktober)
  // gaf wel "gestopt": minder historie gaf een andere uitkomst.
  const g7 = vlak("google", "2025-01", "2026-10", 100);
  for (const [label, li] of [
    ["november 2025 - maart 2026", reeks("linkedin", "2025-11", rijen("2025-11", "2026-03", 60))],
    ["december 2025 - maart 2026", reeks("linkedin", "2025-12", rijen("2025-12", "2026-03", 60))],
  ] as const) {
    check(`gat vóór de start (${label}): gestopt`, som.kanaalGestopt(li.maanden, 2026, 10) === true);
    const f = blendedForecastUitKanalen("t", [g7, li], optelling([g7, li], 2026, 10), 10);
    check(`gat vóór de start (${label}): november-december alleen Google`, jaarDeel(f, 10).every((v) => v === 100), JSON.stringify(jaarDeel(f, 10)));
    check(`gat vóór de start (${label}): het jaar 1.200 + 180`, f.conversions.kpi.adjustedAnnual === 1380, String(f.conversions.kpi.adjustedAnnual));
  }
  // Nog extremer: alleen november-december 2025, het hele lopende jaar niets.
  const alleenNajaar = reeks("linkedin", "2025-11", rijen("2025-11", "2025-12", 60));
  check("alleen najaar 2025, dit jaar niets: gestopt", som.kanaalGestopt(alleenNajaar.maanden, 2026, 10) === true);
  const fNajaar = blendedForecastUitKanalen("t", [g7, alleenNajaar], optelling([g7, alleenNajaar], 2026, 10), 10);
  check("alleen najaar 2025: het jaar is Google alleen (1.200)", fNajaar.conversions.kpi.adjustedAnnual === 1200, String(fNajaar.conversions.kpi.adjustedAnnual));
  // En de echte seizoenen blijven een pauze, ook als het kanaal elk jaar april-september uit staat.
  const aprSepUit = reeks("linkedin", "2024-01", [...rijen("2024-01", "2024-03", 50), ...rijen("2024-10", "2025-03", 50), ...rijen("2025-10", "2026-03", 50)]);
  check("april-september elk jaar uit: op grens 8 een pauze, geen stop", som.kanaalGestopt(aprSepUit.maanden, 2026, 8) === false);

  // Een herstart na een oude historie is een deeljaar. Microsoft liep 80 per maand in 2023 en tot
  // maart 2024, lag stil, en draait sinds oktober (of december) 2025 weer. `vanaf` is de eerste
  // volle maand OOIT (2023-01), dus telde 2025 als "het hele jaar gelopen": doel drie maanden x 1,1,
  // factor geklemd op 3,0, en november-december 66 (of 21) waar hij 80 doet. Zonder de oude
  // historie gaf hetzelfde kanaal 80: meer historie gaf een lagere prognose.
  const g8 = vlak("google", "2023-01", "2026-10", 100);
  for (const [label, ms] of [
    ["herstart oktober 2025", reeks("microsoft", "2023-01", [...rijen("2023-01", "2024-03", 80), ...rijen("2025-10", "2026-10", 80)])],
    ["herstart december 2025", reeks("microsoft", "2023-01", [...rijen("2023-01", "2024-03", 80), ...rijen("2025-12", "2026-10", 80)])],
    // Januari van vorig jaar gelopen, maar daarna gestopt en dit jaar herstart: ook geen heel jaar.
    ["gelopen t/m maart 2025, herstart februari 2026", reeks("microsoft", "2024-01", [...rijen("2024-01", "2025-03", 80), ...rijen("2026-02", "2026-10", 80)])],
  ] as const) {
    const h = kanaalHistorieUitMaanden!("t", ms, 2026, 10);
    check(`${label}: doel op jaarbasis (960), zonder groei`, h.targetCurrentYear.conversions === 960 && h.doelOpJaarbasis === true, `${h.targetCurrentYear.conversions} ${h.doelOpJaarbasis}`);
    const f = blendedForecastUitKanalen("t", [g8, ms], optelling([g8, ms], 2026, 10), 10);
    check(`${label}: november-december 100 + 80`, jaarDeel(f, 10).every((v) => v === 180), JSON.stringify(jaarDeel(f, 10)));
  }
  // Een kanaal dat vorig jaar wel heel het jaar liep, houdt vorig jaar plus groei.
  const heelJaar = kanaalHistorieUitMaanden!("t", reeks("microsoft", "2023-01", [...rijen("2023-01", "2024-03", 80), ...rijen("2025-01", "2026-10", 80)]), 2026, 10);
  // De weken van een maand: gelijk verdeeld, niet op de afrondingsvorm van de adapter. Elk kanaal
  // komt met `weekly: []` de som in, dus zijn historische weken zijn generateEvenWeeks: per week
  // afgerond, de rest in de laatste. 12 over 5 is [2,2,2,2,4], en 3 over 5 (een trackingbreuk) is
  // [1,1,1,1,-1], geschoond tot [1,1,1,1,0]. weekDeel schaalde de maandprognose op die vorm: de
  // beursstrip gaf de week van 31 augustus een CPA van € 20 tegen € 8,89 voor de weken ervoor.
  {
    const g9 = vlak("google", "2025-01", "2026-08", 100);
    const breuk = reeks("microsoft", null, monthsIn({ start: "2025-01", end: "2026-08" }).map((k): Rij => { const c = k === "2025-08" ? 3 : 100; return [k, c, c * 100, c * 10]; }));
    const f = blendedForecastUitKanalen("t", [g9, breuk], optelling([g9, breuk], 2026, 7), 7);
    const weken = (r: ClientForecast["conversions"], m: number) => r.weeklyPoints.filter((w) => w.month === m).map((w) => w.forecast ?? NaN);
    const aug = weken(f.conversions, 8);
    check("trackingbreuk vorig jaar: de weken van augustus gelijk", aug.length === 5 && Math.max(...aug) - Math.min(...aug) <= 1, JSON.stringify(aug));
    const cpaAug = weken(f.cpa, 8);
    check("trackingbreuk vorig jaar: de week-CPA van augustus overal gelijk", Math.max(...cpaAug) - Math.min(...cpaAug) < 0.5, JSON.stringify(cpaAug));
    const exp = f.conversions.weeklyPoints.filter((w) => w.month === 8).map((w) => w.expected);
    check("en de verwachting per week ook", Math.max(...exp) - Math.min(...exp) <= 1, JSON.stringify(exp));
    const klein = vlak("linkedin", "2025-01", "2026-08", 12);
    const f2 = blendedForecastUitKanalen("t", [g9, klein], optelling([g9, klein], 2026, 7), 7);
    for (const m of [8, 10, 12]) {
      const c = weken(f2.cpa, m);
      check(`kleine LinkedIn (12 per maand), maand ${m}: de week-CPA gelijk`, Math.max(...c) - Math.min(...c) < 0.5, JSON.stringify(c));
    }
  }
  // Terug na een pauze midden in de laatste gerealiseerde maand: de route geeft de eerste dag van
  // de HUIDIGE loop mee (startLaatsteLoop), niet de eerste dag ooit. Met 1 januari spreidde het tempo
  // de 12 dagen juli over 31: Meta 38 per maand waar hij 100 doet.
  {
    const { startLaatsteLoop } = kanaalMaanden as Partial<typeof kanaalMaanden>;
    const dagenVan = (van: string, tot: string) => monthsIn({ start: van.slice(0, 7), end: tot.slice(0, 7) })
      .flatMap((m) => Array.from({ length: 31 }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`)).filter((d) => d >= van && d <= tot && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d);
    const loop = typeof startLaatsteLoop === "function" ? startLaatsteLoop([...dagenVan("2026-01-01", "2026-03-31"), ...dagenVan("2026-07-20", "2026-08-25")]) : null;
    check("startLaatsteLoop: na een hele lege maand de dag van terugkomst", loop === "2026-07-20", String(loop));
    check("startLaatsteLoop: zonder hele lege maand de eerste dag ooit",
      startLaatsteLoop?.([...dagenVan("2026-01-01", "2026-06-30"), ...dagenVan("2026-07-20", "2026-08-25")]) === "2026-01-01");
    check("startLaatsteLoop: zonder dagen null", startLaatsteLoop?.([]) === null);
    const g10 = vlak("google", "2025-01", "2026-08", 100);
    const terug: BlendedKanaalReeks = { ...reeks("meta", "2026-01", [...rijen("2026-01", "2026-03", 100), ["2026-07", 1200 / 31, 3870, 387], ["2026-08", 81, 8100, 810]]), eersteDag: loop };
    const f = blendedForecastUitKanalen("t", [g10, terug], optelling([g10, terug], 2026, 7), 7);
    check("terug op 20 juli: augustus-december 100 + Meta op zijn tempo (~98)", jaarDeel(f, 7).every((v) => v !== null && v >= 195 && v <= 201), JSON.stringify(jaarDeel(f, 7)));
  }
  check("heel vorig jaar gelopen: vorig jaar + 10% (1.056)", heelJaar.targetCurrentYear.conversions === 1056 && heelJaar.doelOpJaarbasis === undefined,
    `${heelJaar.targetCurrentYear.conversions} ${heelJaar.doelOpJaarbasis}`);
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
if (failed > 0) process.exit(1);
