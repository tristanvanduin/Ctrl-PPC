// De rekenkant van de bovenkant van het Overzicht in de nieuwe weergave (bouwplan fase 3):
// de kanaalkaarten, de hoofdgrafiek en de nadruk in de kerncijfertegels.
//
// WAAROM DIT LOS STAAT VAN DE COMPONENTEN
//
// De kaarten, de tegels en de grafiek staan onder elkaar en gaan over dezelfde periode. Zodra een
// van de drie zijn eigen optelling maakt, staan er op één scherm twee totalen die een paar
// conversies verschillen, en dat is precies de fout die fase 2 heeft opgeruimd (zes
// conversietotalen over zes vensters). Alles hier rekent daarom op DEZELFDE maandreeksen per
// kanaal die de KPI-band krijgt (ChannelPeriodData.perKanaal in lib/use-channel-period-data.ts) en
// op dezelfde periode (usePeriod().range): de som over de kanalen is het totaal van de band, en de
// som over de maanden van de grafiek ook. lib/__overzicht_bovenkant_test.ts houdt dat vast.
//
// Zuiver en zonder React, zodat het te toetsen is zonder het klantdashboard te mounten.

import { monthsIn, type Month, type PeriodRange } from "@/lib/period/period-range";
import { heeftData, type BronReeks, type Totalen } from "@/lib/period/apply-period";
import { DAG_DOOD_VANAF_DAGEN } from "@/lib/sync/datastand";
import { ALLE_KANALEN, type Kanaal, type Kanaalkeuze } from "@/lib/kanalen/beschikbaar";

// ── De klik op een kaart ────────────────────────────────────────────────────────────────────────

/**
 * Wat er gekozen is na een klik op de kaart van `geklikt`: dat kanaal, of terug naar "Alle
 * kanalen" als het al gekozen was. Eén knop per kanaal die aan en uit gaat, in plaats van een
 * aparte knop "Alle kanalen": de kaart IS het filter, en dezelfde kaart haalt het er weer af.
 */
export function volgendeKanaalkeuze(huidig: Kanaalkeuze, geklikt: Kanaal): Kanaalkeuze {
  return huidig === geklikt ? "blended" : geklikt;
}

// ── Totalen en aandelen per kanaal ──────────────────────────────────────────────────────────────

const nul = (): Totalen => ({ conversions: 0, revenue: 0, adSpend: 0 });

/** De drie kerncijfers van één kanaal over de periode. Een maand zonder rij telt als nul, zoals in
 *  de band (slicePeriod telt alleen de maanden die er zijn). */
export function kanaalTotalen(reeks: BronReeks | undefined, periode: PeriodRange): Totalen {
  const t = nul();
  if (!reeks) return t;
  for (const maand of monthsIn(periode)) {
    const m = reeks.maanden.get(maand);
    if (!m) continue;
    t.conversions += m.conversions || 0;
    t.revenue += m.revenue || 0;
    t.adSpend += m.adSpend || 0;
  }
  return t;
}

/**
 * Hele procenten die samen PRECIES 100 zijn (de methode van de grootste rest).
 *
 * Los afronden geeft bij drie kanalen van elk een derde 33 + 33 + 33 = 99, en bij 12,5 / 12,5 / 75
 * 13 + 13 + 75 = 101. Op vier kaarten naast elkaar telt de lezer dat op, en dan klopt het scherm
 * niet met zichzelf. Hier krijgt elk deel zijn naar beneden afgeronde procent, en gaan de punten
 * die overblijven naar de delen met de grootste rest (bij gelijke rest het eerste: de vaste
 * kanaalvolgorde, zodat het niet per render wisselt).
 *
 * Null als er niets te verdelen valt (totaal nul of een ongeldige waarde): een aandeel van niets is
 * geen 0%, het bestaat niet.
 */
export function heleProcenten(waarden: readonly number[]): number[] | null {
  if (waarden.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const totaal = waarden.reduce((a, b) => a + b, 0);
  if (totaal <= 0) return null;
  const exact = waarden.map((v) => (v / totaal) * 100);
  const uit = exact.map((v) => Math.floor(v));
  const over = 100 - uit.reduce((a, b) => a + b, 0);
  const volgorde = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let n = 0; n < over; n += 1) uit[volgorde[n % volgorde.length].i] += 1;
  return uit;
}

/** Wat een kanaalkaart aan cijfers toont, over de gekozen periode. */
export interface KaartCijfers extends Totalen {
  kanaal: Kanaal;
  /** Kosten per conversie; null zonder conversies (een bedrag zou een prijs suggereren die er niet is). */
  cpa: number | null;
  /** Het aandeel in de kosten van alle kanalen samen, in hele procenten; null als er geen kosten zijn. */
  aandeelKosten: number | null;
  /** Idem voor de conversies. */
  aandeelConversies: number | null;
}

/**
 * De cijfers per kanaalkaart, in de vaste kanaalvolgorde.
 *
 * De aandelen gaan altijd over ALLE kanalen van de klant, ook als er één gekozen is: de rij kaarten
 * is het overzicht waartegen je het gekozen kanaal leest, en een kaart die na een klik "100%" zegt
 * heeft niets meer te vertellen.
 *
 * Null zolang de reeks van een van de kanalen er nog niet is. Een half geladen rij zou aandelen
 * tonen over minder kanalen dan er zijn, en die verspringen dan zodra het laatste binnenkomt.
 */
export function kaartCijfers(
  perKanaal: Partial<Record<Kanaal, BronReeks>>,
  kanalen: readonly Kanaal[],
  periode: PeriodRange,
): KaartCijfers[] | null {
  const lijst = ALLE_KANALEN.filter((k) => kanalen.includes(k));
  if (lijst.some((k) => !perKanaal[k])) return null;
  const totalen = lijst.map((k) => kanaalTotalen(perKanaal[k], periode));
  const kosten = heleProcenten(totalen.map((t) => t.adSpend));
  const conversies = heleProcenten(totalen.map((t) => t.conversions));
  return lijst.map((kanaal, i) => ({
    kanaal,
    ...totalen[i],
    cpa: totalen[i].conversions > 0 ? totalen[i].adSpend / totalen[i].conversions : null,
    aandeelKosten: kosten ? kosten[i] : null,
    aandeelConversies: conversies ? conversies[i] : null,
  }));
}

// ── De koppel- en datastand op een kaart ────────────────────────────────────────────────────────


/**
 * De regel onder de kanaalnaam: tot welke dag dit kanaal data heeft, en of dat aandacht vraagt.
 *
 * - Geen dag: het kanaal heeft geen data; dat is een feit, geen alarm (de kaart toont dan streepjes).
 * - Loopt de data meer dan twee weken achter (dezelfde grens als de dagstand, DAG_DOOD_VANAF_DAGEN), dan staat er "stil sinds" in rood. Behalve als de
 *   route zegt dat de sync WEL draait (`achterMaarSyncDraait`: gepauzeerd of ontkoppeld met een
 *   gezonde sync): dan is er gewoon geen besteding, en zegt de kaart dat zonder alarm.
 * - De demo krijgt "demodata" en nooit rood: de vaste cijfers houden op een vaste dag op, en dat
 *   is geen storing.
 *
 * `vandaag` en `dataTot` zijn "YYYY-MM-DD". Null als er niets te zeggen valt (de stand is nog niet
 * bekend).
 */
export function kaartStand(inp: {
  dataTot: string | null | undefined;
  vandaag: string;
  demo?: boolean;
  achterMaarSyncDraait?: boolean;
  /** Is de stand van dit kanaal al bekend? Zo niet, dan zegt de kaart nog niets. */
  bekend?: boolean;
}): { tekst: string; alarm: boolean } | null {
  if (inp.bekend === false) return null;
  const dag = inp.dataTot && /^\d{4}-\d{2}-\d{2}/.test(inp.dataTot) ? inp.dataTot.slice(0, 10) : null;
  if (!dag) return { tekst: "geen data", alarm: false };
  const MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const datum = `${Number(dag.slice(8, 10))} ${MAAND[Number(dag.slice(5, 7)) - 1]} ${dag.slice(0, 4)}`;
  if (inp.demo) return { tekst: `demodata t/m ${datum}`, alarm: false };
  const dagen = Math.floor((Date.parse(`${inp.vandaag.slice(0, 10)}T00:00:00Z`) - Date.parse(`${dag}T00:00:00Z`)) / 86_400_000);
  if (Number.isFinite(dagen) && dagen > DAG_DOOD_VANAF_DAGEN) {
    return inp.achterMaarSyncDraait
      ? { tekst: `geen data na ${datum}`, alarm: false }
      : { tekst: `stil sinds ${datum}`, alarm: true };
  }
  return { tekst: `data t/m ${datum}`, alarm: false };
}

// ── De hoofdgrafiek ─────────────────────────────────────────────────────────────────────────────

/** Eén maand van de hoofdgrafiek: de kanalen los, en het totaal en de CPA over wat getoond wordt. */
export interface GrafiekMaand {
  /** "YYYY-MM" */
  maand: Month;
  /** Per getoond kanaal de cijfers van deze maand; nullen als het kanaal die maand geen rij heeft. */
  perKanaal: Partial<Record<Kanaal, Totalen>>;
  conversions: number;
  adSpend: number;
  revenue: number;
  /** Kosten per conversie over de getoonde kanalen; null in een maand zonder conversies. */
  cpa: number | null;
  /** Geen enkel getoond kanaal deed deze maand iets: de grafiek tekent dan niets, en zegt dat. */
  leeg: boolean;
}

/**
 * De maanden van de gekozen periode, met per maand de getoonde kanalen gestapeld.
 *
 * `getoond` is op "Alle kanalen" elk kanaal van de klant en op een gekozen kanaal alleen dat
 * kanaal. Elke maand van de periode staat erin, ook een lege: een grafiek die lege maanden
 * weglaat, laat een pauze eruitzien als een doorlopende reeks.
 *
 * De invariant waar de test op staat: de som van `conversions` (en `adSpend`, `revenue`) over de
 * rijen is het totaal van de KPI-band over dezelfde periode en dezelfde kanalen.
 */
export function grafiekMaanden(
  perKanaal: Partial<Record<Kanaal, BronReeks>>,
  getoond: readonly Kanaal[],
  periode: PeriodRange,
): GrafiekMaand[] {
  const lijst = ALLE_KANALEN.filter((k) => getoond.includes(k));
  return monthsIn(periode).map((maand) => {
    const rij: GrafiekMaand = { maand, perKanaal: {}, conversions: 0, adSpend: 0, revenue: 0, cpa: null, leeg: true };
    for (const kanaal of lijst) {
      const m = perKanaal[kanaal]?.maanden.get(maand);
      const t: Totalen = { conversions: m?.conversions || 0, revenue: m?.revenue || 0, adSpend: m?.adSpend || 0 };
      rij.perKanaal[kanaal] = t;
      rij.conversions += t.conversions;
      rij.adSpend += t.adSpend;
      rij.revenue += t.revenue;
      if (heeftData(t)) rij.leeg = false;
    }
    rij.cpa = rij.conversions > 0 ? rij.adSpend / rij.conversions : null;
    return rij;
  });
}

// ── Eén nadruk per band ─────────────────────────────────────────────────────────────────────────

/** Onder deze verandering (in procentpunten) krijgt geen enkele tegel nadruk: dan bewoog er niets. */
export const NADRUK_VANAF_PCT = 5;

/**
 * Welke tegel de nadruk krijgt: die met de grootste verandering, of -1 als geen enkele tegel
 * minstens NADRUK_VANAF_PCT bewoog (of er geen vergelijking is).
 *
 * Eén en niet vijf: als elke tegel roept, wijst er geen iets aan. De nadruk zegt "hier bewoog het
 * meest", in welke richting dan ook; of dat gunstig is, zegt de kleur van de pil. Bij een gelijke
 * verandering wint de eerste tegel, zodat de nadruk niet tussen twee tegels heen en weer springt.
 */
export function nadrukIndex(pcts: readonly (number | null | undefined)[], vanaf: number = NADRUK_VANAF_PCT): number {
  let beste = -1;
  let grootste = vanaf;
  pcts.forEach((p, i) => {
    if (p === null || p === undefined || !Number.isFinite(p)) return;
    const a = Math.abs(p);
    if (a >= grootste && (beste === -1 || a > grootste)) { grootste = a; beste = i; }
  });
  return beste;
}
