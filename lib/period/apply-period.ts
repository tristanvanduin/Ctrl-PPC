// De brug tussen de periodekeuze en de datalaag.
//
// WAAROM DIT NODIG IS
//
// De datalaag denkt in kalenderjaren: historicalYears is gesleuteld op jaartal en
// currentYearData is een rij van twaalf vakjes. Een periode als "november 2025 tot en met
// februari 2026" loopt daar dwars doorheen. Deze module maakt van beide een doorlopende reeks
// op maandsleutel, zodat een periode gewoon een snede is.
//
// Alles hier werkt op data die de app AL heeft opgehaald. Er gaat geen query overheen: het
// dashboard laadt dertien maanden plus historie, en een periodefilter binnen dat venster is
// dus puur rekenwerk. Kiest iemand een periode die verder terug ligt dan wat er geladen is,
// dan levert dit de maanden die er wel zijn en meldt missing welke ontbreken — stilzwijgend
// een kortere reeks teruggeven zou een trend opleveren over minder maanden dan gevraagd, en
// niets zou dat verraden.

import type { ClientHistoricalData, MonthlyRecord } from "../types";
import { monthIndex, monthsIn, type Month, type PeriodRange } from "./period-range";

/** Een maandrij met zijn absolute maandsleutel erbij. */
export interface DatedMonth extends MonthlyRecord {
  /** "YYYY-MM" */
  key: Month;
  year: number;
}

export interface PeriodSlice {
  months: DatedMonth[];
  /** Gevraagde maanden waarvoor geen data bestaat. */
  missing: Month[];
  totals: { conversions: number; revenue: number; adSpend: number };
}

const key = (year: number, month: number): Month => `${year}-${String(month).padStart(2, "0")}`;

/**
 * Alle beschikbare maanden als een doorlopende reeks, oplopend op datum.
 *
 * currentYearData bevat null voor maanden die nog niet gerealiseerd zijn; die vallen weg.
 * Dat is geen verlies: een lege toekomstige maand als nul meetellen zou elk gemiddelde en
 * elke trend naar beneden trekken.
 */
export function flattenMonths(data: ClientHistoricalData): DatedMonth[] {
  const out: DatedMonth[] = [];

  for (const [jaarStr, maanden] of Object.entries(data.historicalYears ?? {})) {
    const jaar = Number(jaarStr);
    if (!Number.isFinite(jaar)) continue;
    for (const m of maanden ?? []) {
      if (m) out.push({ ...m, key: key(jaar, m.month), year: jaar });
    }
  }

  for (const m of data.currentYearData ?? []) {
    if (m) out.push({ ...m, key: key(data.currentYear, m.month), year: data.currentYear });
  }

  // Een maand kan in beide bronnen staan als het huidige jaar ook in historicalYears zit.
  // Dan wint currentYearData, want dat is de verse kant.
  const perKey = new Map<Month, DatedMonth>();
  for (const m of out) perKey.set(m.key, m);

  return [...perKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** De maanden binnen een periode, plus welke gevraagde maanden ontbreken. */
export function slicePeriod(data: ClientHistoricalData, period: PeriodRange): PeriodSlice {
  const alle = new Map(flattenMonths(data).map((m) => [m.key, m]));
  const gevraagd = monthsIn(period);

  const months: DatedMonth[] = [];
  const missing: Month[] = [];
  for (const k of gevraagd) {
    const m = alle.get(k);
    if (m) months.push(m);
    else missing.push(k);
  }

  return {
    months,
    missing,
    totals: {
      conversions: months.reduce((s, m) => s + (m.conversions || 0), 0),
      revenue: months.reduce((s, m) => s + (m.revenue || 0), 0),
      adSpend: months.reduce((s, m) => s + (m.adSpend || 0), 0),
    },
  };
}

export interface PeriodDelta {
  huidig: number;
  vorig: number;
  /** Procentuele verandering, of null als er geen basis is om tegen af te zetten. */
  pct: number | null;
}

/**
 * De verandering tussen twee perioden.
 *
 * pct is null en niet 0 wanneer de vergelijkingsperiode nul was. Van niets naar iets is geen
 * "0 procent groei" en ook geen oneindige: het is geen percentage. Dat onderscheid is precies
 * wat er eerder in deze codebase misging, waar een deling terugviel op een getal dat plausibel
 * oogde.
 */
export function delta(huidig: number, vorig: number): PeriodDelta {
  return { huidig, vorig, pct: vorig > 0 ? ((huidig - vorig) / vorig) * 100 : null };
}

// ── Gepaard vergelijken ────────────────────────────────────────────────────

/** De drie kerncijfers van een maand of een optelling van maanden. */
export type Totalen = { conversions: number; revenue: number; adSpend: number };

/** Eén bron (een kanaal, of de hele klant) als maandreeks op "YYYY-MM". */
export interface BronReeks {
  naam: string;
  maanden: ReadonlyMap<Month, Totalen>;
  /**
   * De eerste VOLLE maand van de bron, als die later ligt dan de eerste maand met data. Een
   * dagkanaal waarvan de eerste rij op de 23e valt, heeft die maand maar negen dagen gemeten; zonder
   * dit veld paarde die maand tegen een volle maand een jaar later (Microsoft bij de demo: +244%
   * kosten bij een vlak dagtempo). Weglaten = de eerste maand met data, zoals bij een maandbron die
   * geen dagen kent.
   */
  vanaf?: Month | null;
  /** De eerste maand die geladen is, als de lezer niet de hele historie ophaalt. Alleen voor de
   *  uitleg: een start die hierop valt is de laadgrens, niet het begin van de data. */
  geladenVanaf?: Month | null;
}

/** Wat er per bron in de vergelijking terechtkwam. */
export interface BronPaar {
  naam: string;
  /** De eerste maand waarin de bron iets deed, of null als dat nergens zo is. */
  start: Month | null;
  /** Vanaf welke maand de bron in de vergelijking telt: de eerste volle maand, nooit vóór start. */
  vanaf: Month | null;
  /** Zie BronReeks.geladenVanaf; null als de hele historie er is. */
  geladenVanaf: Month | null;
  /** Maandparen die meetelden en waarin de bron aan minstens een kant data had. */
  gepaard: number;
  /** Maanden in de gekozen periode met data die geen tegenhanger hadden. */
  ongepaardHuidig: number;
  /** Idem in de vergelijkingsperiode. */
  ongepaardVorig: number;
}

export interface GepaardeTotalen {
  huidig: Totalen;
  vorig: Totalen;
  /** Het aantal (bron, maand) met data dat buiten de vergelijking viel, per kant. */
  ongepaard: { huidig: number; vorig: number };
  perBron: BronPaar[];
}

const nul = (): Totalen => ({ conversions: 0, revenue: 0, adSpend: 0 });

function optellen(t: Totalen, m: Totalen | undefined): void {
  if (!m) return;
  t.conversions += m.conversions || 0;
  t.revenue += m.revenue || 0;
  t.adSpend += m.adSpend || 0;
}

/** Een maand waarin de bron iets deed. Een rij met drie nullen is voor de start geen rij. Los, zodat
 *  de blended prognose (lib/forecast-som.ts) een gestopt kanaal met dezelfde regel herkent. */
export const heeftData = (m: Totalen | undefined): boolean =>
  !!m && !!(m.conversions || m.revenue || m.adSpend);

/**
 * Maand i van de periode tegen maand i van de vergelijking, per bron.
 *
 * WAAROM PER BRON EN NIET OP DE OPTELLING
 *
 * Een kanaal dat in de vergelijkingsperiode nog niet bestond (Meta en LinkedIn bij GreenTech,
 * sinds maart 2026) telde als groei: in de optelling heeft een maand data zodra één kanaal dat
 * heeft, dus viel het ontbrekende kanaal nergens op. Op de demo stond er "+89%" kosten, waarvan
 * het grootste deel bestond uit kanalen die er vorig jaar simpelweg niet waren.
 *
 * DE REGEL
 *
 * De start van een bron is de eerste maand waarin hij een rij heeft. Een paar telt voor die bron
 * alleen mee als BEIDE maanden op of na de start liggen. Vanaf de start telt een ontbrekende maand
 * als nul: een kanaal dat een maand gepauzeerd was, deed die maand echt niets, en dat hoort in de
 * vergelijking.
 *
 * Is de eerste maand maar deels gemeten (BronReeks.vanaf), dan telt het paar pas vanaf de maand
 * erna. De partiële maand blijft in de totalen staan; alleen tegen een volle maand zetten kan niet.
 *
 * Een rij met drie nullen vóór de eerste echte maand telt niet als start. De adapter vult een
 * historisch jaar zonder data aan met nulmaanden (apiDataToMonthlyRecords in lib/api/adapter.ts),
 * en een view kan een kanaal een lege rij geven voordat het liep. Als start geteld kwam die van
 * een klant die in juni begon op januari te liggen, en telden januari t/m mei van vorig jaar als
 * "echt nul" -- precies de groei uit het niets die deze regel moet voorkomen. Na de start is een
 * nulmaand gewoon een pauze, en die telt.
 *
 * Het einde van de data lost deze functie bewust niet op: dat doet het venster (vensterEindMaand
 * in period-range). Hier ophouden waar de data ophoudt zou een gestopt kanaal laten verdwijnen
 * in plaats van als daling te laten tellen.
 *
 * Werkt op kale maandtotalen, zodat een server-route of de pacing (die geen ClientHistoricalData
 * hebben) dezelfde regel gebruiken in plaats van een eigen versie te verzinnen.
 */
export function gepaardeTotalen(
  reeksen: readonly BronReeks[],
  period: PeriodRange,
  comparison: PeriodRange,
): GepaardeTotalen {
  const huidig = nul();
  const vorig = nul();
  const ongepaard = { huidig: 0, vorig: 0 };
  const perBron: BronPaar[] = [];
  const a = monthsIn(period);
  const b = monthsIn(comparison);
  const lengte = Math.max(a.length, b.length);

  for (const reeks of reeksen) {
    const { start, vanaf: vanafMaand } = bronStart(reeks);
    const paar: BronPaar = {
      naam: reeks.naam, start, vanaf: vanafMaand, geladenVanaf: reeks.geladenVanaf ?? null,
      gepaard: 0, ongepaardHuidig: 0, ongepaardVorig: 0,
    };
    perBron.push(paar);
    if (vanafMaand === null) continue;
    const vanaf = monthIndex(vanafMaand);

    for (let i = 0; i < lengte; i += 1) {
      const x = a[i] !== undefined ? reeks.maanden.get(a[i]) : undefined;
      const y = b[i] !== undefined ? reeks.maanden.get(b[i]) : undefined;
      // Bij ongelijke lengte heeft het overschot geen tegenhanger: dat telt als ongepaard.
      const telt = a[i] !== undefined && b[i] !== undefined
        && monthIndex(a[i]) >= vanaf && monthIndex(b[i]) >= vanaf;
      if (telt) {
        optellen(huidig, x);
        optellen(vorig, y);
        if (heeftData(x) || heeftData(y)) paar.gepaard += 1;
      } else {
        if (heeftData(x)) paar.ongepaardHuidig += 1;
        if (heeftData(y)) paar.ongepaardVorig += 1;
      }
    }
    ongepaard.huidig += paar.ongepaardHuidig;
    ongepaard.vorig += paar.ongepaardVorig;
  }

  return { huidig, vorig, ongepaard, perBron };
}

/**
 * De start van een bron (de eerste maand met data) en de maand vanaf waar hij meetelt: vanaf, maar
 * nooit vóór die start. Los, zodat de blended prognose (lib/forecast-som.ts) dezelfde grens trekt
 * als de vergelijking in plaats van een eigen versie.
 */
export function bronStart(reeks: Pick<BronReeks, "maanden" | "vanaf">): { start: Month | null; vanaf: Month | null } {
  let start: Month | null = null;
  for (const [k, m] of reeks.maanden) {
    if (heeftData(m) && (start === null || monthIndex(k) < monthIndex(start))) start = k;
  }
  if (start === null) return { start, vanaf: null };
  const vanaf = reeks.vanaf && monthIndex(reeks.vanaf) > monthIndex(start) ? reeks.vanaf : start;
  return { start, vanaf };
}

/**
 * De ontbrekende maanden van een snede (PeriodSlice.missing), gesplitst naar wat ze zijn.
 *
 * Een maand zonder rij NA de eerste maand met data en t/m het eind van de data (`dataTot`, anders de
 * laatste maand met data) is een gemeten nul: het kanaal liep niet, en de totalen en gepaardeTotalen
 * tellen hem ook zo. Alleen een maand vóór die start of na dat eind is echt "geen data": niet
 * geladen, of nog niet binnen. De band noemde beide "geen data geladen ... tellen hierboven niet
 * mee", direct onder de zin dat een maand zonder data na de start als nul telt (review [6]).
 * Over alle bronnen samen, zoals `data` ze optelt: een maand is pas leeg als geen enkel kanaal er
 * een rij heeft.
 */
export function ontbrekendeMaanden(
  data: ClientHistoricalData,
  missing: readonly Month[],
  dataTot?: string | null,
): { nietGeladen: Month[]; gemetenNul: Month[] } {
  const metData = flattenMonths(data).filter(heeftData).map((m) => m.key);
  const eerste = metData[0];
  const eind = dataTot && /^\d{4}-\d{2}/.test(dataTot) ? dataTot.slice(0, 7) : metData[metData.length - 1];
  const nul = (k: Month) => eerste !== undefined && eind !== undefined
    && monthIndex(k) > monthIndex(eerste) && monthIndex(k) <= monthIndex(eind);
  return { nietGeladen: missing.filter((k) => !nul(k)), gemetenNul: missing.filter(nul) };
}

/** ClientHistoricalData als BronReeks, via dezelfde afvlakking als slicePeriod. */
export function alsBronReeks(naam: string, data: ClientHistoricalData, vanaf?: Month | null, geladenVanaf?: Month | null): BronReeks {
  return {
    naam,
    maanden: new Map(flattenMonths(data).map((m): [Month, Totalen] =>
      [m.key, { conversions: m.conversions, revenue: m.revenue, adSpend: m.adSpend }])),
    vanaf: vanaf ?? null,
    geladenVanaf: geladenVanaf ?? null,
  };
}

/**
 * De drie kerncijfers vergeleken tussen twee perioden.
 *
 * current en previous zijn de volle snedes: de getallen die in beeld staan. De deltas gaan alleen
 * over de gepaarde maanden (zie gepaardeTotalen), dus deltas.x.huidig en .vorig kunnen kleiner
 * zijn dan de totalen. `ongepaard` en `perBron` zeggen wat er buiten de vergelijking viel, zodat
 * de UI dat kan melden.
 *
 * Geef bij een optelling van kanalen de losse kanalen mee als `bronnen`. Zonder bronnen is de
 * data zelf de enige bron; met een volledige historie geeft dat exact de oude delta.
 */
export function comparePeriods(
  data: ClientHistoricalData,
  period: PeriodRange,
  comparison: PeriodRange | null,
  bronnen?: readonly BronReeks[],
): {
  current: PeriodSlice;
  previous: PeriodSlice | null;
  deltas: { conversions: PeriodDelta; revenue: PeriodDelta; adSpend: PeriodDelta } | null;
  ongepaard: { huidig: number; vorig: number };
  perBron: BronPaar[];
} {
  const current = slicePeriod(data, period);
  if (!comparison) return { current, previous: null, deltas: null, ongepaard: { huidig: 0, vorig: 0 }, perBron: [] };

  const previous = slicePeriod(data, comparison);
  const p = gepaardeTotalen(bronnen ?? [alsBronReeks("totaal", data)], period, comparison);
  return {
    current,
    previous,
    deltas: {
      conversions: delta(p.huidig.conversions, p.vorig.conversions),
      revenue: delta(p.huidig.revenue, p.vorig.revenue),
      adSpend: delta(p.huidig.adSpend, p.vorig.adSpend),
    },
    ongepaard: p.ongepaard,
    perBron: p.perBron,
  };
}
