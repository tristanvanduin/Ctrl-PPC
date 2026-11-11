// De pure kant van de KPI-band voor Meta, LinkedIn en Microsoft: van dagrijen naar het
// ClientHistoricalData-schema dat comparePeriods() kent, en de optelling voor "Alle kanalen".
//
// Waarom dit los staat van de hook (lib/use-channel-period-data.ts). De rekenregels zaten in de
// hook zelf en waren dus alleen via een gemounte React-boom te testen; een test die de band wilde
// narekenen moest de lus overschrijven, en dan controleert hij een kopie in plaats van wat er op
// het scherm komt. Hier staan ze één keer, en de hook en de tests (lib/demo/__demo_band_bron_test.ts)
// gebruiken precies deze functies.
//
// Dag -> maand gebeurt hier NIET zelf: dat doet kanaalMaandenUitDagen (channel-report-blend.ts), de
// ene plek waar de conversieselectie van de klant op dagrijen wordt toegepast. De band telde eerder
// met een eigen lus en een eigen select-lijst; zodra die van het Jaaroverzicht of de rapportage
// afweek, stonden er twee getallen voor dezelfde conversie op één pagina.
//
// `weeks` blijft overal een lege array: comparePeriods()/slicePeriod() gebruiken alleen
// month/conversions/revenue/adSpend uit een MonthlyRecord, nooit .weeks -- die is er puur omdat
// het type dat vereist.

import { today } from "@/lib/reporting-date";
import { addMonths, monthIndex, type Month } from "@/lib/period/period-range";
import {
  kanaalMaandenUitDagen, KANAAL_DAGBRON, dagbronSelect, type MonthlyChannelRow,
} from "@/lib/analysis/channel-report-blend";
import { conversionSourcesFor, type ChannelConversionChannel, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import type { ClientHistoricalData, MonthlyRecord } from "@/lib/types";

export type NietGoogleKanaal = "meta" | "linkedin" | "microsoft";

export const NIET_GOOGLE: readonly NietGoogleKanaal[] = ["meta", "linkedin", "microsoft"];

/** De sleutel waaronder de conversieselectie en de dagbron van een kanaal staan. */
export const CONVERSIE_KANAAL: Record<NietGoogleKanaal, ChannelConversionChannel> = {
  meta: "meta_ads",
  linkedin: "linkedin_ads",
  microsoft: "microsoft_ads",
};

/** De dagtabel en de select-lijst van een kanaal, zoals elke lezer van die tabel ze gebruikt. */
export function kanaalDagbron(kanaal: NietGoogleKanaal): { table: string; select: string } {
  const ck = CONVERSIE_KANAAL[kanaal];
  return { table: KANAAL_DAGBRON[ck].table, select: dagbronSelect(ck) };
}

export interface MaandTotaal { year: number; month: number; conversions: number; revenue: number; adSpend: number }

/** Maandrijen uit kanaalMaandenUitDagen (month "YYYY-MM-01", cost, conversions_value) als maandtotalen. */
export function maandTotalenUitKanaalRijen(rijen: readonly MonthlyChannelRow[]): MaandTotaal[] {
  const uit: MaandTotaal[] = [];
  for (const r of rijen) {
    const m = /^(\d{4})-(\d{2})/.exec(String(r.month ?? ""));
    if (!m) continue;
    uit.push({
      year: Number(m[1]),
      month: Number(m[2]),
      conversions: r.conversions || 0,
      revenue: r.conversions_value || 0,
      adSpend: r.cost || 0,
    });
  }
  return uit;
}

/**
 * De maandreeks zoals de blended route hem per kanaal meestuurt (perKanaal[].maanden: month
 * "YYYY-MM", conversions/revenue/adSpend, al met de selectie van de klant geteld) als maandtotalen.
 * Dezelfde vorm als maandTotalenUitKanaalRijen oplevert, zodat kanaalStandUitMaanden er direct op
 * rekent: de band uit de route en de band uit de dagrijen gaan door één wortel.
 */
export function maandTotalenUitMaandreeks(maanden: readonly { month: string; conversions: number; revenue: number; adSpend: number }[]): MaandTotaal[] {
  const uit: MaandTotaal[] = [];
  for (const m of maanden) {
    const r = /^(\d{4})-(\d{2})/.exec(String(m.month ?? ""));
    if (!r) continue;
    uit.push({ year: Number(r[1]), month: Number(r[2]), conversions: m.conversions || 0, revenue: m.revenue || 0, adSpend: m.adSpend || 0 });
  }
  return uit;
}

/**
 * De laadgrens van een bron waarvan de HELE historie geladen is (de blended route leest alle
 * dagrijen, zonder datumfilter). De band leest `geladenVanaf: null` als "onbekend tot waar
 * geladen is" en noemt een maand vóór de start dan "niet geladen" (ontbrekendeMaanden in
 * apply-period.ts); met een grens die vóór elke mogelijke rij ligt, is zo'n maand gewoon leeg:
 * "de data begint pas in ...". Vóór 2000 bestond geen van de kanalen.
 */
export const HELE_HISTORIE_GELADEN_VANAF: Month = "2000-01";

/** Het jaar van vandaag in Amsterdam. Niet getFullYear(): dat is de klok van de browser, en die
 *  zegt op oudejaarsavond na 23:00 UTC nog het oude jaar terwijl de rest van de app al verder is. */
function huidigJaar(): number {
  return Number(today().slice(0, 4));
}

export function bouwHistorischeData(clientId: string, maanden: readonly MaandTotaal[], jaar: number = huidigJaar()): ClientHistoricalData {
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  const currentYearData: (MonthlyRecord | null)[] = Array(12).fill(null);

  for (const m of maanden) {
    const record: MonthlyRecord = { month: m.month, conversions: m.conversions, revenue: m.revenue, adSpend: m.adSpend, weeks: [] };
    if (m.year === jaar) {
      currentYearData[m.month - 1] = record;
    } else {
      (historicalYears[m.year] ??= []).push(record);
    }
  }

  return {
    clientId,
    // Ongebruikt door comparePeriods()/PeriodSummary -- die lezen alleen currentYearData en
    // historicalYears. Nul in plaats van weglaten omdat het type het veld verplicht stelt.
    targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    historicalYears,
    currentYearData,
    currentYear: jaar,
  };
}

/** De laatste dag waarop een kanaal een rij heeft, "YYYY-MM-DD", of null zonder rijen. */
export function laatsteDagUitRijen(rijen: readonly Record<string, unknown>[]): string | null {
  let laatste: string | null = null;
  for (const r of rijen) {
    const d = String(r.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (laatste === null || d > laatste) laatste = d;
  }
  return laatste;
}

/**
 * De eerste dag waarop een kanaal iets deed, "YYYY-MM-DD", of null zonder zo'n rij.
 *
 * Een rij zonder besteding, conversie of waarde telt niet: dezelfde regel als de start van een bron
 * (bronStart in apply-period.ts, die een maand met drie nullen overslaat). Telde zo'n nulrij op de
 * 1e wel, dan was die maand "vol" terwijl de besteding pas op de 23e begon, en paarde de partiële
 * eerste maand weer tegen een volle (review [0]). Alle selecteerbare conversievelden tellen, niet
 * alleen de selectie: een dag met leads liep, ook als de klant leads niet meetelt.
 */
export function eersteDagUitRijen(rijen: readonly Record<string, unknown>[], channel: ChannelConversionChannel): string | null {
  return actieveDagen(rijen, channel)[0] ?? null;
}

/** De dagen waarop een kanaal iets deed (de regel van eersteDagUitRijen), oplopend en uniek. */
function actieveDagen(rijen: readonly Record<string, unknown>[], channel: ChannelConversionChannel): string[] {
  const velden = ["spend", "conversion_value", ...conversionSourcesFor(channel).map((s) => s.field)];
  const dagen = new Set<string>();
  for (const r of rijen) {
    const d = String(r.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!velden.some((v) => !!Number(r[v] ?? 0))) continue;
    dagen.add(d);
  }
  return [...dagen].sort();
}

/**
 * De eerste dag van de HUIDIGE loop van een kanaal: de eerste actieve dag na de laatste hele
 * kalendermaand zonder activiteit, en zonder zo'n gat de eerste dag ooit. Null zonder actieve dag.
 *
 * Voor het tempo zonder doel (forecastCoreMetric, `eersteDag`): begon het kanaal midden in de
 * laatste gerealiseerde maand, dan telt het tempo de dagen vanaf die dag. Met de eerste dag OOIT
 * kreeg een Meta die januari-maart liep, april-juni stillag en op 20 juli terugkwam zijn 12 dagen
 * juli over 31 dagen gespreid: 38 per maand waar hij 100 doet. Bewust niet voor `vanaf` (de eerste
 * volle maand): daarvóór valt de historie weg, en dan verloor een kanaal dat heel vorig jaar liep
 * na een zomerpauze zijn vorig jaar en zijn doel.
 *
 * Een pauze binnen één maand (geen hele lege kalendermaand) blijft buiten deze regel: een weekend
 * zonder levering is van een korte pauze niet te onderscheiden.
 */
export function startLaatsteLoop(dagen: readonly string[]): string | null {
  const geldig = [...new Set(dagen.map((d) => String(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  let start: string | null = geldig[0] ?? null;
  for (let i = 1; i < geldig.length; i++) {
    if (monthIndex(geldig[i].slice(0, 7)) - monthIndex(geldig[i - 1].slice(0, 7)) >= 2) start = geldig[i];
  }
  return start;
}

/** startLaatsteLoop over de actieve dagen van dagrijen (de regel van eersteDagUitRijen). */
export function startLaatsteLoopUitRijen(rijen: readonly Record<string, unknown>[], channel: ChannelConversionChannel): string | null {
  return startLaatsteLoop(actieveDagen(rijen, channel));
}

/**
 * De eerste maand die een dagkanaal VOLLEDIG gemeten heeft: de maand van de eerste rij als die op
 * de 1e valt, anders de maand erna. Hetzelfde als volleMaand (lib/sync/datastand.ts) aan het eind
 * van de reeks doet, maar dan aan het begin: Microsoft begon bij de demo op 23 juli 2025, en die
 * negen dagen telden als een volle juli tegen een volle juli 2026.
 *
 * Een leesvenster dat op de 1e begint (monthsAgo) raakt dit niet: daar is de eerste rij de 1e.
 */
export function eersteVolleMaand(eersteDag: string | null | undefined): Month | null {
  if (!eersteDag || !/^\d{4}-\d{2}-\d{2}$/.test(eersteDag)) return null;
  const maand = eersteDag.slice(0, 7);
  return eersteDag.slice(8, 10) === "01" ? maand : addMonths(maand, 1);
}

/** Wat de band van één niet-Google-kanaal nodig heeft: de reeks en tot waar die loopt. */
export interface KanaalStand {
  data: ClientHistoricalData;
  laatsteDag: string | null;
  /** De eerste volle maand (eersteVolleMaand), voor de paring; null zonder rijen. */
  vanaf: Month | null;
}

/**
 * Maandtotalen plus de twee dagscalairen -> de reeks voor de band. De zuivere kern: de band uit
 * de dagrijen (kanaalStandUitDagen) en de band uit de maandreeks van de blended route (perKanaal,
 * met laatsteDag en vanaf erbij) moeten per constructie dezelfde functie zijn -- de route telt
 * dag -> maand met dezelfde kanaalMaandenUitDagen en dezelfde selectie, dus twee ingangen, één
 * uitkomst, en geen tweede lezing van de dagtabellen in de browser.
 */
export function kanaalStandUitMaanden(
  clientId: string,
  maanden: readonly MaandTotaal[],
  laatsteDag: string | null,
  vanaf: Month | null,
  jaar?: number,
): KanaalStand {
  return { data: bouwHistorischeData(clientId, maanden, jaar), laatsteDag, vanaf };
}

/** Dagrijen (gelezen met kanaalDagbron) -> de reeks voor de band, met de selectie van de klant:
 *  de compositie van kanaalStandUitMaanden over kanaalMaandenUitDagen. */
export function kanaalStandUitDagen(
  clientId: string,
  rijen: Array<Record<string, unknown>>,
  kanaal: NietGoogleKanaal,
  convConfig: ChannelConversionConfig,
  jaar?: number,
): KanaalStand {
  const ck = CONVERSIE_KANAAL[kanaal];
  return kanaalStandUitMaanden(
    clientId,
    maandTotalenUitKanaalRijen(kanaalMaandenUitDagen(rijen, ck, convConfig)),
    laatsteDagUitRijen(rijen),
    eersteVolleMaand(eersteDagUitRijen(rijen, ck)),
    jaar,
  );
}

/** Alle kanalen bij elkaar optellen, maand voor maand, voor de "Alle kanalen"-weergave. */
export function samenvoegen(clientId: string, sets: readonly ClientHistoricalData[], jaar?: number): ClientHistoricalData {
  const totalen = new Map<string, MaandTotaal>();
  const optellen = (year: number, m: MonthlyRecord | null) => {
    if (!m) return;
    const k = `${year}-${m.month}`;
    const a = totalen.get(k) ?? { year, month: m.month, conversions: 0, revenue: 0, adSpend: 0 };
    a.conversions += m.conversions || 0;
    a.revenue += m.revenue || 0;
    a.adSpend += m.adSpend || 0;
    totalen.set(k, a);
  };
  for (const d of sets) {
    for (const [jaarStr, maanden] of Object.entries(d.historicalYears ?? {})) {
      const j = Number(jaarStr);
      for (const m of maanden ?? []) optellen(j, m);
    }
    for (const m of d.currentYearData ?? []) optellen(d.currentYear, m);
  }
  return bouwHistorischeData(clientId, [...totalen.values()], jaar);
}
