// Bouwt een ClientHistoricalData/ClientForecast voor Meta en LinkedIn uit hun eigen dag-tabellen,
// voor het Meta/LinkedIn-equivalent van Google's "Jaaroverzicht 2026" (23 augustus 2026).
//
// computeForecast() (lib/forecast.ts) is zelf al kanaalneutraal -- hij rekent op ClientHistoricalData,
// niet op iets Google-specifieks. Wat wél Google-specifiek was: de databron (/api/google-ads/
// client-data via lib/api/adapter.ts) en het jaardoel (client_settings.kpiTargets). Dit bestand is het
// Meta/LinkedIn-equivalent van dat eerste stuk, hergebruikt buildClientDataFromApi (dezelfde adapter
// die Google al gebruikt) en leest het jaardoel uit client_targets -- de kanaal-gescoopte tabel die
// hier al voor bestond (migratie 002/082, fase 2 MASTERPLAN.md) maar nog geen jaardoel-UI heeft. Geen
// ingevuld doel is geen fout: computeForecast() valt dan terug op het historisch totaal, exact zoals
// hij dat voor Google ook al doet.

import type { ClientAnnualData, ClientHistoricalData } from "@/lib/types";
import { buildClientDataFromApi, type ApiMonthlyData, type ApiWeeklyData, type YearDataInput } from "@/lib/api/adapter";
import { computeForecast, type ClientForecast } from "@/lib/forecast";
import { kanaalGestopt, stilgelegd } from "@/lib/forecast-som";
import { resolveTargets, type TargetRow } from "./o2-targets-cost";
import { jaardoelMetTerugval } from "./standaard-jaardoel";
import { volleMaand, dagkanaalDataTot, type DataStandSamen } from "@/lib/sync/datastand";
import { startLaatsteLoop } from "@/lib/period/kanaal-maanden";

export interface ChannelForecastRow {
  /** YYYY-MM-DD */
  date: string;
  spend: number;
  conv: number;
  revenue: number;
}

// Zelfde patroon als lib/api/adapter.ts's generateEvenWeeks: welke maanden vijf periodes van
// zeven dagen krijgen i.p.v. vier. Hier verdelen we ECHTE dagcijfers over die periodes, dus zonder
// de afronding die een gelijke verdeling nodig had.
function weeksInMonth(month: number): number {
  return [1, 3, 5, 7, 8, 10, 12].includes(month) ? 5 : 4;
}

function weekOfDay(day: number, month: number): number {
  return Math.min(Math.ceil(day / 7), weeksInMonth(month));
}

function emptyMonthly(month: number): ApiMonthlyData {
  return { month, conversions: 0, revenue: 0, adSpend: 0, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversionRate: 0 };
}

/** Groepeert dagrijen per jaar in maand- en weektotalen, in de vorm die de gedeelde adapter verwacht. */
function aggregateByYear(rows: ChannelForecastRow[]): Map<number, { monthly: ApiMonthlyData[]; weekly: ApiWeeklyData[] }> {
  const perYear = new Map<number, { monthly: Map<number, ApiMonthlyData>; weekly: Map<string, ApiWeeklyData> }>();

  for (const r of rows) {
    const [yStr, mStr, dStr] = r.date.split("-");
    const year = Number(yStr), month = Number(mStr), day = Number(dStr);
    if (!year || !month || !day) continue;

    let bucket = perYear.get(year);
    if (!bucket) { bucket = { monthly: new Map(), weekly: new Map() }; perYear.set(year, bucket); }

    const m = bucket.monthly.get(month) ?? emptyMonthly(month);
    m.conversions += r.conv; m.revenue += r.revenue; m.adSpend += r.spend;
    bucket.monthly.set(month, m);

    const week = weekOfDay(day, month);
    const key = `${month}-${week}`;
    const w = bucket.weekly.get(key) ?? { week, month, conversions: 0, revenue: 0, adSpend: 0 };
    w.conversions += r.conv; w.revenue += r.revenue; w.adSpend += r.spend;
    bucket.weekly.set(key, w);
  }

  // Elke maand met rijen krijgt AL zijn emmers, een lege met nullen. De forecast leest de weken op
  // positie (weeks[w] is W(w+1), en het aantal weken is weeks.length): met alleen de emmers van
  // dagen met rijen had Meta's maart (start 13 maart) [wk2..wk5], en dan stonden 13-14 maart onder
  // "W1 Mrt", 29-31 maart onder W4 en ontbrak W5. Een lege week in de HISTORIE is dan wel een nul in
  // de weekvorm; computeWeeklyDistribution (lib/forecast.ts) neemt zo'n maand niet als patroon.
  for (const bucket of perYear.values()) {
    for (const month of bucket.monthly.keys()) {
      for (let week = 1; week <= weeksInMonth(month); week++) {
        if (!bucket.weekly.has(`${month}-${week}`)) bucket.weekly.set(`${month}-${week}`, { week, month, conversions: 0, revenue: 0, adSpend: 0 });
      }
    }
  }

  const out = new Map<number, { monthly: ApiMonthlyData[]; weekly: ApiWeeklyData[] }>();
  for (const [year, bucket] of perYear) {
    out.set(year, { monthly: [...bucket.monthly.values()], weekly: [...bucket.weekly.values()] });
  }
  return out;
}

/**
 * @param todayIso vandaag als YYYY-MM-DD (lib/reporting-date's today()) -- bepaalt het huidige jaar
 *   en, samen met de laatste dag in `rows`, hoeveel maanden daarvan als "gerealiseerd" tellen (de
 *   rest wordt null, voor projectie).
 * @param dataTot de laatste definitieve dag van dit kanaal zoals de blended route hem bepaalde
 *   (dataTotVanDagbron: na een geslaagde sync de dag vóór die sync). Rijen zeggen niet of de sync na
 *   de laatste rij nog slaagde, en de syncs schrijven geen nulrijen: zonder deze dag verloor een
 *   gepauzeerd account met een gezonde sync zijn echte halve maand aan een projectie, terwijl
 *   "Alle kanalen" dezelfde maanden als gemeten telde (review [10], [14]). Samen met de nieuwste
 *   rij via dagkanaalDataTot: een rij die later valt dan deze dag telt t/m de dag ervoor (de rij van
 *   de syncdag is een deel van die dag). Weglaten = de rijen, zoals voorheen.
 */
export function buildChannelHistoricalData(
  clientId: string,
  rows: ChannelForecastRow[],
  targetCurrentYear: ClientAnnualData,
  todayIso: string,
  dataTot?: string | null,
): ClientHistoricalData | null {
  if (rows.length === 0) return null;

  const currentYear = Number(todayIso.slice(0, 4));
  const realizedThroughMonth = gerealiseerdTot(rows, todayIso, dataTot);
  const byYear = aggregateByYear(rows);

  const historicalYearsInput: YearDataInput[] = [...byYear.entries()]
    .filter(([year]) => year < currentYear)
    .sort(([a], [b]) => a - b)
    .map(([year, { monthly, weekly }]) => ({ year, monthly, weekly }));

  const current = byYear.get(currentYear) ?? { monthly: [], weekly: [] };
  // Rijen na die grens (de partiële maand, en de lopende) horen ook niet in de gerealiseerde reeks.
  const monthly = current.monthly.filter((m) => m.month <= realizedThroughMonth);
  const weekly = current.weekly.filter((w) => w.month <= realizedThroughMonth);

  const data = buildClientDataFromApi(
    clientId, historicalYearsInput, monthly, weekly,
    targetCurrentYear, currentYear, realizedThroughMonth,
  );
  // De eerste dag van de huidige loop (startLaatsteLoop: na een pauze van een hele maand de dag
  // waarop het kanaal terugkwam), voor het tempo zonder doel als die partiële maand de laatste
  // gerealiseerde is (forecastCoreMetric): dezelfde dag die de blended route meegeeft. Met de eerste
  // dag OOIT kreeg een kanaal dat op 20 juli terugkwam na een pauze, zijn 12 dagen juli over 31
  // gespreid. De rijen zijn hooguit de nieuwste 1000 dagen; is de echte start ouder, dan valt deze
  // dag in een jaar dat de regel niet raakt.
  const eersteDag = startLaatsteLoop(rows.filter((r) => r.spend || r.conv || r.revenue).map((r) => String(r.date ?? "")));
  return eersteDag ? { ...data, eersteDag } : data;
}

/** De gerealiseerd-grens (1-12, 0 = nog niets) van een dagreeks, zie buildChannelHistoricalData. */
function gerealiseerdTot(rows: ChannelForecastRow[], todayIso: string, dataTot?: string | null): number {
  const currentYear = Number(todayIso.slice(0, 4));
  // Gerealiseerd is t/m de laatste VOLLE maand met data (volleMaand, lib/sync/datastand.ts), niet
  // t/m "vorige kalendermaand". Een halfvolle maand telde eerst als eindstand: hij drukte met het
  // zwaarste recency-gewicht de jaarprognose omlaag en de rest van die maand werd nooit
  // geprojecteerd (sloop-audit 1 sep 2026: de lopende maand). Dezelfde fout zat er nog in zodra de
  // sync stilstond: bij data t/m 26 augustus, bekeken op 1 november, telde augustus (26 van de 31
  // dagen) als volle maand. Nu is augustus partieel en loopt de realisatie t/m juli -- dezelfde
  // grens als de blended historie en de KPI-band.
  const laatsteDag = rows.reduce<string | null>((acc, r) => {
    const d = String(r.date ?? "").slice(0, 10);
    return acc === null || d > acc ? d : acc;
  }, null);
  const vol = volleMaand({ dataTot: dagkanaalDataTot(laatsteDag, dataTot), nu: todayIso.slice(0, 10) }).laatsteVolleMaand;
  return vol === null || Number(vol.slice(0, 4)) < currentYear ? 0 : Number(vol.slice(5, 7));
}

/**
 * @param targetChannel client_targets' channel-waarde: "meta_ads" of "linkedin_ads".
 *
 * Jaardoel: alleen conversions/conversion_value/spend uit client_targets (de kanaal-brede
 * jaargrootheden). Een eventuele losse cpa/roas-rij (zoals meta-briefing die al leest) wordt hier
 * bewust niet gebruikt -- forecast.cpa/roas leiden hun eigen doel af uit spend/conversions-doelen,
 * consistent met hoe elke andere metric hier werkt. Er is nog geen scherm om deze doelen in te
 * vullen (net als bij Google); zonder doel valt computeForecast() terug op het historisch totaal.
 */
export function buildChannelForecast(
  clientId: string,
  rows: ChannelForecastRow[],
  targetRows: TargetRow[],
  targetChannel: string,
  todayIso: string,
  /** Zie buildChannelHistoricalData. */
  dataTot?: string | null,
  /**
   * `gestopt`: de route noemt dit kanaal in `uitgesloten` (ontkoppeld, of zijn data komt niet meer),
   * en dan is het op "Alle kanalen" na zijn laatste dag nul, ook als zijn maanden op een
   * seizoenspauze lijken. Zie tabStandUitRoute.
   */
  opties: { gestopt?: boolean } = {},
): { data: ClientHistoricalData; forecast: ClientForecast } | null {
  const targets = resolveTargets(targetRows, targetChannel, todayIso);

  // Zonder ingevoerd doel terugvallen op vorig jaar plus groei -- dezelfde regel die de
  // Google-route en de blended historie al toepassen (lib/analysis/standaard-jaardoel.ts).
  //
  // Dit stond hier op nul, en dat is precies waarom de beurs-sectie op Meta en LinkedIn er anders
  // uitzag dan op Google: `toFairWeeks` spreidt het jaardoel over de weken, dus met een doel van
  // nul was elke week "verwacht 0" en elke ratio 0% -- geen verwachting, geen balk, geen kleur.
  // Op Google werkte dezelfde sectie wél, niet omdat dat kanaal anders is maar omdat zijn route
  // de terugval kende en deze niet.
  const currentYear = Number(todayIso.slice(0, 4));
  const vorigJaar = rows.reduce<{ conversions: number; revenue: number; adSpend: number } | null>((acc, r) => {
    if (Number(r.date.slice(0, 4)) !== currentYear - 1) return acc;
    const t = acc ?? { conversions: 0, revenue: 0, adSpend: 0 };
    t.conversions += r.conv;
    t.revenue += r.revenue;
    t.adSpend += r.spend;
    return t;
  }, null);

  const targetCurrentYear: ClientAnnualData = jaardoelMetTerugval(
    { conversions: targets.conversions, revenue: targets.conversion_value, adSpend: targets.spend },
    vorigJaar,
  );

  const data = buildChannelHistoricalData(clientId, rows, targetCurrentYear, todayIso, dataTot);
  if (!data) return null;
  // Dezelfde stopregel als "Alle kanalen" (kanaalGestopt): geen data in de laatste gerealiseerde
  // maand of later, en geen seizoenspauze, dan na het gerealiseerde een prognose van nul. Zonder
  // regel projecteerde een gepauzeerd account met een gezonde sync november en december op zijn
  // oude tempo (566 voor het jaar), terwijl de som hetzelfde kanaal op 454 zette.
  const maanden = [...aggregateByYear(rows)].flatMap(([jaar, { monthly }]) =>
    monthly.map((m) => ({ month: `${jaar}-${String(m.month).padStart(2, "0")}`, conversions: m.conversions, revenue: m.revenue, adSpend: m.adSpend })));
  const forecast = computeForecast(data);
  const stop = opties.gestopt === true || kanaalGestopt(maanden, currentYear, gerealiseerdTot(rows, todayIso, dataTot));
  return { data, forecast: stop ? stilgelegd(forecast) : forecast };
}

/**
 * Welke dag en welke stop de kanaaltab van de blended route overneemt, zodat hij hetzelfde jaar
 * geeft als het deel van dit kanaal op "Alle kanalen".
 *
 * Een kanaal in `uitgesloten` (ontkoppeld, een verlopen token, of zo ver achter dat het venster niet
 * meer op hem wacht) telt in de som na zijn laatste dag als nul, t/m de GEZAMENLIJKE grens. De tab
 * kreeg zijn eigen dag mee: bij een LinkedIn die op 15 juni ophield, bleef de tab gerealiseerd t/m
 * mei, zag kanaalGestopt data in de partiële juni en projecteerde hij juni t/m december, ook de
 * maanden die al voorbij zijn (730 tegen 332 in de som). Met de gezamenlijke dag zijn die maanden
 * gemeten nullen, en de stop is dezelfde als in de som: ook als de maanden op een seizoenspauze
 * lijken, want de som vraagt het dan niet aan kanaalGestopt.
 *
 * Elk ander kanaal houdt zijn eigen dag. Zonder stand (de route faalde) geen dag, en dan de rijen.
 */
export function tabStandUitRoute(
  stand: Pick<DataStandSamen, "dataTot" | "uitgesloten" | "bronnen"> | null | undefined,
  kanaal: string,
): { dataTot: string | null; gestopt: boolean } {
  const gestopt = stand?.uitgesloten?.includes(kanaal) ?? false;
  const dataTot = gestopt ? stand?.dataTot ?? null : stand?.bronnen?.find((b) => b.bron === kanaal)?.dataTot ?? null;
  return { dataTot, gestopt };
}
