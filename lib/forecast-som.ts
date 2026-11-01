// De blended prognose ("Alle kanalen") als SOM van de prognoses per kanaal.
//
// WAAROM NIET computeForecast OP DE OPTELLING
//
// computeForecast projecteert elke resterende maand als vorig jaar, geschaald naar het doel, maal
// een prestatiefactor: gerealiseerd gedeeld door verwacht over de maanden tot nu. Op de optelling
// van de kanalen meet die factor geen prestatie maar de kanaalmix. Bij de demo:
//
// - Microsoft liep in 2025 pas vanaf 23 juli, in 2026 elke maand. Januari t/m juni van dit jaar
//   bevatten dus ~80 Microsoft-conversies per maand die vorig jaar niet in de basis zaten. Dat las
//   als groei, en die groei werd losgelaten op een augustus-december waarin Microsoft al wél in de
//   basis zat: dubbel geteld.
// - Meta en LinkedIn hebben geen 2025. Hun volume kwam alleen via de factor binnen, op Google's
//   seizoenscurve; januari en februari (voor hun start) trokken hem omlaag en LinkedIn's
//   verdubbeling in juli middelde weg.
//
// Samen: conversies en omzet ~9% te hoog, spend ~10% te laag, en de ROAS-kaart stond op +9% boven
// het doel waar -10% eronder hoort. De factor lag bovendien tegen de klem van 3,0 aan, zodat een
// ander doel stil een andere prognose gaf.
//
// Per kanaal heeft elk zijn eigen historie, zijn eigen doel en (zonder vorig jaar) zijn eigen
// tempo -- wat de kanaaltabs al doen. De som hangt dan niet af van het blended doel: dat schaalt
// alleen de verwachtingslijn. Daarom kon dit vóór de beslissing over het standaarddoel.
//
// Bewust zonder runtime-import van lib/api/blended-historical.ts (serverkant: Supabase, de sync-
// stand): deze module draait in de browser, in useBlendedClientData.

import { buildClientDataFromApi, type ApiMonthlyData, type YearDataInput } from "./api/adapter";
import type { BlendedKanaalReeks } from "./api/blended-historical";
import { standaardJaardoel } from "./analysis/standaard-jaardoel";
import {
  analyzeDataMaturity, computeBudgetRecommendation, computeForecast, deriveForecast,
  sanitizeCurrentYear, sanitizeValue, sanitizeYear,
  type ClientForecast, type ForecastMetric, type ForecastPoint, type ForecastResult, type WeeklyPoint,
} from "./forecast";
import { bronStart, heeftData } from "./period/apply-period";
import { monthIndex } from "./period/period-range";
import type { ClientAnnualData, ClientHistoricalData } from "./types";

type Kern = "conversions" | "revenue" | "adSpend";

const apiMaand = (month: number, m: { conversions: number; revenue: number; adSpend: number }): ApiMonthlyData => ({
  // Afgerond zoals de route zijn maanden afrondt (naarApiMonthlyData): de forecast heeft altijd
  // hele getallen gezien, en dan blijft dat zo.
  month,
  conversions: Math.round(m.conversions || 0),
  revenue: Math.round(m.revenue || 0),
  adSpend: Math.round(m.adSpend || 0),
  impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0,
});

/**
 * Eén kanaal uit /api/blended/client-data (perKanaal) als ClientHistoricalData voor computeForecast.
 *
 * - Hetzelfde venster als de optelling: het lopende jaar t/m `realizedThroughMonth`, de GEZAMENLIJKE
 *   grens van de route. Alleen dan vallen de maanden van alle kanalen op dezelfde plek.
 * - Een partiële eerste maand (vóór `vanaf`) valt uit de HISTORIE: negen dagen juli 2025 zijn geen
 *   seizoenspatroon. In het lopende jaar blijft hij staan; hij is echt gerealiseerd, en de band en de
 *   pacing tellen hem ook in de totalen.
 * - Een maand zonder rij in het lopende jaar, ná de eerste maand met een rij en t/m de grens, is een
 *   echte nul (gepauzeerd). Zonder die nul eindigt de reeks van zo'n kanaal eerder dan die van de
 *   rest, en dan projecteert hij maanden die al voorbij zijn.
 * - Weken altijd leeg: de adapter verdeelt elke maand dan gelijk over hetzelfde weekraster, en dan
 *   kunnen de weken van de kanalen bij elkaar opgeteld worden.
 * - Het doel is vorig jaar plus groei (standaardJaardoel), maar alleen als het kanaal dat hele jaar
 *   liep: groei op een deeljaar is geen doel. Liep het maar een deel (begon het later), dan het
 *   gemeten deeljaar op jaarbasis, zonder groei. Hier stond een doel van nul, en dan nam
 *   computeForecast het deeljaartotaal als JAARdoel: een twaalfmaandsvorm over drie maanden gaf een
 *   prestatiefactor van ~4, geklemd op 3,0, en een kanaal dat vlak 80 per maand deed kreeg 60 (bij
 *   twee maanden 39). Bij die klem schaalt een doel niet alleen de verwachting maar ook de prognose;
 *   op jaarbasis blijft de factor bij het eigen tempo. `doelOpJaarbasis` zegt dat erbij, zodat de
 *   verwachting in januari ook de maanden vóór de start van vorig jaar vult (forecastCoreMetric).
 * - `eersteDag` (de eerste dag met data, van de route) gaat mee: is de partiële eerste maand de
 *   laatste gerealiseerde, dan rekent computeForecast zonder doel het tempo over de dagen dat het
 *   kanaal liep, niet over de hele maand.
 */
export function kanaalHistorieUitMaanden(
  clientId: string,
  reeks: Pick<BlendedKanaalReeks, "maanden" | "vanaf" | "eersteDag">,
  currentYear: number,
  realizedThroughMonth: number,
): ClientHistoricalData {
  const { vanaf } = bronStart({ maanden: new Map(reeks.maanden.map((m) => [m.month, m])), vanaf: reeks.vanaf ?? null });

  const perJaar = new Map<number, ApiMonthlyData[]>();
  for (const m of reeks.maanden) {
    const jaar = Number(m.month.slice(0, 4));
    const maand = Number(m.month.slice(5, 7));
    if (!jaar || !maand || jaar > currentYear) continue;
    if (jaar === currentYear && maand > realizedThroughMonth) continue;
    if (jaar < currentYear && vanaf !== null && monthIndex(m.month) < monthIndex(vanaf)) continue;
    const lijst = perJaar.get(jaar) ?? [];
    lijst.push(apiMaand(maand, m));
    perJaar.set(jaar, lijst);
  }

  // Zelfde filter als de route voor zijn historische jaren: een maand met alleen nullen is daar geen
  // rij (de adapter vult hem weer met nullen aan).
  const historicalYears: YearDataInput[] = [...perJaar.entries()]
    .filter(([jaar]) => jaar < currentYear)
    .sort(([a], [b]) => a - b)
    .map(([year, monthly]) => ({ year, monthly: monthly.filter((m) => m.conversions > 0 || m.adSpend > 0), weekly: [] }))
    .filter((j) => j.monthly.length > 0);

  const huidig = [...(perJaar.get(currentYear) ?? [])];
  if (huidig.length > 0) {
    const eerste = Math.min(...huidig.map((m) => m.month));
    for (let mm = eerste + 1; mm <= realizedThroughMonth; mm++) {
      if (!huidig.some((m) => m.month === mm)) huidig.push(apiMaand(mm, { conversions: 0, revenue: 0, adSpend: 0 }));
    }
  }
  huidig.sort((a, b) => a.month - b.month);

  const vorig = currentYear - 1;
  const volVorigJaar = vanaf !== null && monthIndex(vanaf) <= monthIndex(`${vorig}-01`);
  const vorigJaar = historicalYears.find((j) => j.year === vorig);
  const totaal = (k: Kern) => vorigJaar?.monthly.reduce((s, m) => s + m[k], 0) ?? 0;
  const opJaarbasis = (k: Kern) => Math.round((totaal(k) * 12) / (vorigJaar?.monthly.length ?? 1));
  const deeljaar = vorigJaar !== undefined && !volVorigJaar;
  const target = deeljaar
    ? { conversions: opJaarbasis("conversions"), revenue: opJaarbasis("revenue"), adSpend: opJaarbasis("adSpend") }
    : standaardJaardoel(vorigJaar ? { conversions: totaal("conversions"), revenue: totaal("revenue"), adSpend: totaal("adSpend") } : null);

  const data = buildClientDataFromApi(clientId, historicalYears, huidig, [], target, currentYear, realizedThroughMonth);
  return {
    ...data,
    ...(deeljaar ? { doelOpJaarbasis: true } : {}),
    ...(reeks.eersteDag ? { eersteDag: reeks.eersteDag } : {}),
  };
}

/**
 * Het blended doel zoals computeForecast het op de optelling zou nemen: een doel van nul valt terug
 * op het nieuwste historische jaar met een totaal. Zelfde regel als daar, zodat het doel op "Alle
 * kanalen" niet verandert doordat de prognose nu per kanaal loopt (welke regel er bij een andere
 * kanaalmix hoort, is een open beslissing; zie lib/api/blended-historical.ts).
 */
function doelMetTerugval(doel: ClientAnnualData, samen: ClientHistoricalData): ClientAnnualData {
  const jaren = Object.keys(samen.historicalYears).map(Number).sort((a, b) => b - a);
  const een = (metric: Kern): number => {
    const v = sanitizeValue(doel[metric]);
    if (v > 0) return v;
    for (const j of jaren) {
      const totaal = samen.historicalYears[j].reduce((s, r) => s + sanitizeValue(r[metric]), 0);
      if (totaal > 0) return totaal;
    }
    return 0;
  };
  return { conversions: een("conversions"), revenue: een("revenue"), adSpend: een("adSpend") };
}

/** Null als alles null is, anders de som met null als nul. */
function optellen(waarden: readonly (number | null)[]): number | null {
  return waarden.every((v) => v === null) ? null : waarden.reduce<number>((s, v) => s + (v ?? 0), 0);
}

/**
 * Eén kernmetric opgeteld over de kanalen.
 *
 * Gerealiseerd en prognose zijn sommen. De verwachting is de som van de verwachtingen per kanaal,
 * geschaald naar het blended doel: zo houdt de lijn de seizoensvorm van de kanalen en telt hij op
 * tot het doel dat op de kaart staat. Heeft geen enkel kanaal een doel (allemaal nieuw dit jaar)
 * maar de klant wel, dan het doel gelijk over de maanden -- wat computeForecast ook doet bij een
 * reeks zonder historie.
 */
function somKern(
  delen: readonly ForecastResult[],
  doel: number,
  metric: ForecastMetric,
  rtm: number,
  vervang?: (maandIndex: number) => number | undefined,
): ForecastResult {
  const somDoelen = delen.reduce((s, d) => s + d.kpi.annualTarget, 0);
  const gelijk = somDoelen <= 0 && doel > 0;
  const schaal = somDoelen > 0 ? doel / somDoelen : 0;

  const points: ForecastPoint[] = delen[0].points.map((p0, i) => {
    const expected = gelijk ? Math.round(doel / 12) : Math.round(delen.reduce((s, d) => s + d.points[i].expected, 0) * schaal);
    const opgeteld = optellen(delen.map((d) => d.points[i].realized));
    const handmatig = opgeteld !== null ? vervang?.(i) : undefined;
    const realized = handmatig !== undefined && handmatig > 0 ? handmatig : opgeteld;
    const forecast = optellen(delen.map((d) => d.points[i].forecast));
    const waarde = realized ?? forecast;
    return {
      month: p0.month, monthLabel: p0.monthLabel, expected, realized, forecast,
      monthRatio: expected > 0 && waarde !== null ? waarde / expected : 1,
    };
  });

  // De weekprognose van een kanaal, geschaald naar de maandprognose van datzelfde kanaal. Zonder
  // doel geeft computeForecast elke emmer het weektempo en de maand het tempo x 52/12; opgeteld
  // telde een maand met vijf emmers dan 5 weken en een met vier er 4. Op de demo (Meta en LinkedIn
  // zonder doel) toonde de beursstrip oktober 129 per week en november 85, waar de tabel ernaast
  // 465 en 452 zei. Met een doel tellen de emmers al op tot de maand, en verandert er op de
  // afronding na niets.
  const weekDeel = (d: ForecastResult, j: number): number | null => {
    const w = d.weeklyPoints[j];
    if (w.forecast === null) return null;
    const maandWeken = d.weeklyPoints.filter((x) => x.month === w.month && x.forecast !== null);
    const somWeken = maandWeken.reduce((s, x) => s + (x.forecast ?? 0), 0);
    const maand = d.points[w.month - 1].forecast ?? 0;
    return somWeken > 0 ? (w.forecast * maand) / somWeken : maand / maandWeken.length;
  };

  const weeklyPoints: WeeklyPoint[] = delen[0].weeklyPoints.map((w0, j) => {
    const perMaand = delen[0].weeklyPoints.filter((w) => w.month === w0.month).length;
    const forecast = optellen(delen.map((d) => weekDeel(d, j)));
    return {
      month: w0.month, week: w0.week, label: w0.label,
      expected: gelijk ? Math.round(points[w0.month - 1].expected / perMaand)
        : Math.round(delen.reduce((s, d) => s + d.weeklyPoints[j].expected, 0) * schaal),
      realized: optellen(delen.map((d) => d.weeklyPoints[j].realized)),
      forecast: forecast === null ? null : Math.round(forecast),
    };
  });

  const ytdRealized = points.slice(0, rtm).reduce((s, p) => s + (p.realized ?? 0), 0);
  // Elke maand t/m de grens, zoals forecastCoreMetric: ook een maand zonder rij was verwacht.
  const ytdExpected = points.slice(0, rtm).reduce((s, p) => s + p.expected, 0);
  const adjustedAnnual = points.reduce((s, p) => s + (p.realized ?? p.forecast ?? 0), 0);
  const toekomstVerwacht = points.slice(rtm).reduce((s, p) => s + p.expected, 0);
  const toekomstPrognose = points.slice(rtm).reduce((s, p) => s + (p.forecast ?? 0), 0);
  // De band per kanaal opgeteld (behoudend: de afwijkingen van de kanalen heffen elkaar dan niet
  // op), verschoven met wat een handmatige correctie aan het gerealiseerde veranderde.
  const verschuiving = adjustedAnnual - delen.reduce((s, d) => s + d.kpi.adjustedAnnual, 0);
  const low = Math.max(0, delen.reduce((s, d) => s + d.kpi.forecastLow, 0) + verschuiving);
  const high = delen.reduce((s, d) => s + d.kpi.forecastHigh, 0) + verschuiving;

  return {
    metric, points, weeklyPoints,
    kpi: {
      annualTarget: doel,
      ytdRealized,
      ytdExpected,
      adjustedAnnual,
      diffPct: doel > 0 ? ((adjustedAnnual - doel) / doel) * 100 : 0,
      performanceRatio: ytdExpected > 0 ? ytdRealized / ytdExpected : 1,
      monthlyRatios: points.map((p) => p.monthRatio),
      // Alleen beschrijvend: er is geen gezamenlijke factor meer, wel de verhouding die eruit volgt.
      projectionFactor: toekomstVerwacht > 0 ? toekomstPrognose / toekomstVerwacht : 1,
      forecastLow: low,
      forecastHigh: high,
      forecastSpreadPct: adjustedAnnual > 0 ? Math.round(((high - low) / 2 / adjustedAnnual) * 1000) / 10 : 0,
      realizedThroughMonth: rtm,
    },
  };
}

/**
 * De prognoses per kanaal opgeteld tot één ClientForecast, tegen het blended doel `doel`.
 *
 * Voorwaarde: dezelfde gerealiseerd-grens en hetzelfde weekraster bij elk kanaal (kanaalHistorie-
 * UitMaanden zorgt daarvoor). Klopt dat niet, dan is dit een programmeerfout en geen data: dan
 * liever een fout dan maanden die op de verkeerde plek worden opgeteld.
 *
 * ROAS en CPA zijn verhoudingen van de sommen (deriveForecast), niet sommen van verhoudingen. Een
 * handmatige conversiecorrectie van de klant (samen.conversionOverrides) vervangt, zoals voorheen,
 * het opgetelde gerealiseerde van die maand.
 */
export function somForecast(delen: readonly ClientForecast[], doel: ClientAnnualData, samen: ClientHistoricalData): ClientForecast {
  if (delen.length === 0) throw new Error("somForecast: geen kanalen om op te tellen");
  const rtm = delen[0].conversions.kpi.realizedThroughMonth;
  const raster = (f: ForecastResult) => f.weeklyPoints.map((w) => `${w.month}-${w.week}`).join(",");
  for (const d of delen) {
    for (const m of ["conversions", "revenue", "adSpend"] as const) {
      if (d[m].kpi.realizedThroughMonth !== rtm) throw new Error(`somForecast: ongelijke gerealiseerd-grens (${d[m].kpi.realizedThroughMonth} tegen ${rtm})`);
      if (raster(d[m]) !== raster(delen[0][m]) || d[m].points.length !== 12) throw new Error("somForecast: ongelijk weekraster");
    }
  }

  const t = doelMetTerugval(doel, samen);
  const overrides = samen.conversionOverrides;
  const vervang = overrides
    ? (i: number) => overrides[`${samen.currentYear}-${String(i + 1).padStart(2, "0")}`]
    : undefined;

  const conversions = somKern(delen.map((d) => d.conversions), t.conversions, "conversions", rtm, vervang);
  const revenue = somKern(delen.map((d) => d.revenue), t.revenue, "revenue", rtm);
  // "cpa" zoals in computeForecast: de spend-reeks draagt dat label voor de CPA-afleiding.
  const adSpend = somKern(delen.map((d) => d.adSpend), t.adSpend, "cpa", rtm);
  const roas = deriveForecast(revenue, adSpend, "roas", true);
  const cpa = deriveForecast(adSpend, conversions, "cpa", true);

  const jaren = Object.keys(samen.historicalYears).map(Number).sort((a, b) => a - b)
    .map((y) => sanitizeYear(samen.historicalYears[y]));
  return {
    conversions, revenue, adSpend, roas, cpa,
    budgetRecommendation: computeBudgetRecommendation(conversions, adSpend, rtm, cpa.kpi.annualTarget ?? null),
    dataMaturity: analyzeDataMaturity(jaren, sanitizeCurrentYear(samen.currentYearData)),
  };
}

/**
 * Een kanaal dat stilligt: zijn gerealiseerde maanden blijven staan, elke prognose erna is nul.
 * Voor een bron in `uitgesloten` zegt de band dat er ook bij ("vanaf die dag telt het als nul",
 * uitgeslotenZin); voor een kanaal dat alleen kanaalGestopt stil noemt, zegt de kanaaltab het met
 * dezelfde nullen (stilgelegd, buildChannelForecast).
 */
function zonderPrognose(f: ForecastResult): ForecastResult {
  const points = f.points.map((p) => (p.forecast === null ? p : { ...p, forecast: 0 }));
  const weeklyPoints = f.weeklyPoints.map((w) => (w.forecast === null ? w : { ...w, forecast: 0 }));
  const adjustedAnnual = points.reduce((s, p) => s + (p.realized ?? 0), 0);
  const doel = f.kpi.annualTarget;
  return {
    ...f, points, weeklyPoints,
    kpi: {
      ...f.kpi, adjustedAnnual, forecastLow: adjustedAnnual, forecastHigh: adjustedAnnual, forecastSpreadPct: 0,
      projectionFactor: 0, diffPct: doel > 0 ? ((adjustedAnnual - doel) / doel) * 100 : 0,
    },
  };
}

/**
 * Een hele ClientForecast zonder prognose (zonderPrognose op de drie kernreeksen), met ROAS, CPA en
 * het budgetadvies opnieuw afgeleid uit die nullen. Gedeeld met de kanaaltab, zodat een gestopt
 * kanaal daar hetzelfde jaar krijgt als in "Alle kanalen".
 */
export function stilgelegd(f: ClientForecast): ClientForecast {
  const conversions = zonderPrognose(f.conversions);
  const revenue = zonderPrognose(f.revenue);
  const adSpend = zonderPrognose(f.adSpend);
  const cpa = deriveForecast(adSpend, conversions, "cpa", true);
  return {
    ...f, conversions, revenue, adSpend, cpa,
    roas: deriveForecast(revenue, adSpend, "roas", true),
    budgetRecommendation: computeBudgetRecommendation(conversions, adSpend, conversions.kpi.realizedThroughMonth, cpa.kpi.annualTarget ?? null),
  };
}

/**
 * Is dit kanaal gestopt? Ja als het geen data heeft in de laatste gerealiseerde maand of later
 * (`realizedThroughMonth` 0: december van vorig jaar), tenzij het een SEIZOENSPAUZE is: dezelfde
 * maanden waren vorig jaar ook leeg, en daarna liep het kanaal vorig jaar weer. Een klant die
 * LinkedIn elk jaar van april tot september uitzet, kreeg anders op "Alle kanalen" nul voor zijn
 * hele najaarsseizoen, terwijl zijn eigen tab (en de optelling vóór deze module) dat seizoen
 * gewoon projecteerde. Een kanaal dat vorig jaar in die maanden wél liep, is wel gestopt.
 */
export function kanaalGestopt(
  maanden: readonly Pick<BlendedKanaalReeks["maanden"][number], "month" | "conversions" | "revenue" | "adSpend">[],
  jaar: number,
  realizedThroughMonth: number,
): boolean {
  const laatste = monthIndex(realizedThroughMonth > 0 ? `${jaar}-${String(realizedThroughMonth).padStart(2, "0")}` : `${jaar - 1}-12`);
  const met = maanden.filter((m) => heeftData(m)).map((m) => monthIndex(m.month.slice(0, 7)));
  if (met.some((i) => i >= laatste)) return false;
  const tot = met.filter((i) => i <= laatste);
  if (tot.length === 0) return true;
  const laatsteData = Math.max(...tot);
  for (let i = laatsteData + 1; i <= laatste; i++) if (met.includes(i - 12)) return true;
  const seizoensPauze = met.some((i) => i > laatste - 12 && i <= monthIndex(`${jaar - 1}-12`));
  return !seizoensPauze;
}

/**
 * Een kanaal dat dit jaar t/m de grens geen rij had maar na de grens weer loopt (terug in de
 * partiële maand): computeForecast gaf het grens 0 en een prognose voor elke maand. Hier vanaf de
 * gezamenlijke grens: de maanden t/m de grens zonder prognose (ze zijn voorbij, en het kanaal liep
 * er niet), de rest zijn eigen prognose.
 */
function vanafGrens(f: ForecastResult, rtm: number): ForecastResult {
  const points = f.points.map((p, i) => (i < rtm ? { ...p, forecast: null } : p));
  const weeklyPoints = f.weeklyPoints.map((w) => (w.month <= rtm ? { ...w, forecast: null } : w));
  const adjustedAnnual = points.reduce((s, p) => s + (p.realized ?? p.forecast ?? 0), 0);
  const weg = f.kpi.adjustedAnnual - adjustedAnnual;
  return {
    ...f, points, weeklyPoints,
    kpi: {
      ...f.kpi, adjustedAnnual,
      forecastLow: Math.max(0, f.kpi.forecastLow - weg), forecastHigh: f.kpi.forecastHigh - weg,
      ytdExpected: points.slice(0, rtm).reduce((s, p) => s + p.expected, 0), realizedThroughMonth: rtm,
    },
  };
}

/**
 * De handmatige conversiecorrecties van de klant (op de optelling, per maand) verdeeld over de
 * kanalen, naar hun aandeel in de conversies van die maand (zonder conversies: in de spend, dan
 * gelijk over de kanalen met een rij). Zo ziet elk kanaal de correctie in zijn eigen prestatiefactor,
 * zoals computeForecast hem op de optelling ook in de factor neemt; en de som van de delen is weer
 * de correctie. Zonder dit verving hij alleen het gerealiseerde, en tilde een correctie van een
 * trackingbreuk naar boven de rest van het jaar niet meer op (de demo: augustus-december 2.332 met
 * en zonder correctie, waar de optelling 2.733 -> 3.214 gaf).
 */
function metVerdeeldeCorrecties(
  delen: readonly ClientHistoricalData[],
  correcties: Record<string, number> | undefined,
  jaar: number,
  rtm: number,
): ClientHistoricalData[] {
  if (!correcties) return [...delen];
  const perKanaal = delen.map((): Record<string, number> => ({}));
  const som = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
  for (const [sleutel, waarde] of Object.entries(correcties)) {
    if (!(waarde > 0) || !sleutel.startsWith(`${jaar}-`)) continue;
    const i = Number(sleutel.slice(5, 7)) - 1;
    if (!(i >= 0 && i < rtm)) continue;
    const naar = (veld: Kern) => delen.map((d) => Math.max(0, d.currentYearData[i]?.[veld] ?? 0));
    let gewicht = naar("conversions");
    if (som(gewicht) <= 0) gewicht = naar("adSpend");
    if (som(gewicht) <= 0) gewicht = delen.map((d) => (d.currentYearData[i] ? 1 : 0));
    const totaal = som(gewicht);
    if (totaal <= 0) continue;
    gewicht.forEach((g, k) => { if (g > 0) perKanaal[k][sleutel] = (waarde * g) / totaal; });
  }
  return delen.map((d, k) => (Object.keys(perKanaal[k]).length > 0 ? { ...d, conversionOverrides: perKanaal[k] } : d));
}

/**
 * De prognose voor "Alle kanalen": per kanaal computeForecast op zijn eigen historie, opgeteld.
 *
 * @param samen de optelling zoals de hook hem bouwt, met de KPI-doelen erin (mergeKpiTargets); daar
 *   komen het doel, de handmatige correcties en de datarijpheid vandaan.
 * @param realizedThroughMonth de gezamenlijke grens van de route.
 * @param uitgesloten de bronnen die het venster niet tegenhielden (DataStandSamen.uitgesloten):
 *   gestopt, ontkoppeld of dood. Na hun laatste dag tellen ze als nul.
 *
 * Een kanaal zonder rij dit jaar binnen die grens dat daarna wel loopt (terug in de partiële maand)
 * telt mee vanaf de grens (vanafGrens): het heeft vorig jaar om op te projecteren. Hier stond dat
 * zo'n kanaal "niets om op te projecteren" had, en dan was "Alle kanalen" stil de rest zonder hem.
 * Blijft er geen kanaal over (of kent de route perKanaal niet), dan de oude berekening op de
 * optelling: liever die dan geen jaaroverzicht.
 *
 * Een GESTOPT kanaal (in `uitgesloten`, of volgens kanaalGestopt: zonder data in de laatste
 * gerealiseerde maand of later, en geen seizoenspauze) houdt zijn gerealiseerde maanden en krijgt
 * daarna een prognose van nul. Twee gaten die dat dicht:
 * - Een kanaal dat in april stopte, had nulmaanden van mei tot de grens; die gooit de factor per
 *   kanaal weg als trackingbreuk, en dan projecteerde de som het op zijn tempo van januari-april.
 * - In januari is de grens 0, en dan had elk kanaal "dezelfde grens", ook een dat sinds 2024 stil
 *   ligt: zijn doel viel terug op 2024 en werd voor dit jaar geprojecteerd. De laatste gerealiseerde
 *   maand is dan december van vorig jaar. Zonder gerealiseerde maand dit jaar valt zo'n kanaal weg.
 */
export function blendedForecastUitKanalen(
  clientId: string,
  perKanaal: readonly Pick<BlendedKanaalReeks, "kanaal" | "maanden" | "vanaf" | "eersteDag">[],
  samen: ClientHistoricalData,
  realizedThroughMonth: number,
  uitgesloten: readonly string[] = [],
): ClientForecast {
  const jaar = samen.currentYear;
  const gestopt = (k: Pick<BlendedKanaalReeks, "kanaal" | "maanden">) =>
    uitgesloten.includes(k.kanaal) || kanaalGestopt(k.maanden, jaar, realizedThroughMonth);

  const kanalen = perKanaal
    .map((k) => ({ stil: gestopt(k), historie: kanaalHistorieUitMaanden(clientId, k, jaar, realizedThroughMonth) }))
    .filter((k) => !k.stil || k.historie.currentYearData.some((m) => heeftData(m ?? undefined)));
  const historie = metVerdeeldeCorrecties(kanalen.map((k) => k.historie), samen.conversionOverrides, jaar, realizedThroughMonth);
  const delen = kanalen
    .map((k, i) => {
      const f = computeForecast(historie[i]);
      if (k.stil) return stilgelegd(f);
      if (f.conversions.kpi.realizedThroughMonth === 0 && realizedThroughMonth > 0) {
        return { ...f, conversions: vanafGrens(f.conversions, realizedThroughMonth), revenue: vanafGrens(f.revenue, realizedThroughMonth), adSpend: vanafGrens(f.adSpend, realizedThroughMonth) };
      }
      return f;
    })
    .filter((f) => f.conversions.kpi.realizedThroughMonth === realizedThroughMonth);
  if (delen.length === 0) return computeForecast(samen);
  return somForecast(delen, samen.targetCurrentYear, samen);
}
