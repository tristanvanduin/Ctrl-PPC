// Trendberekening op één plek, met één set drempels.
//
// WAAROM DIT BESTAAT
//
// De CPA-trend werd op ZES plekken zelfstandig uitgerekend — lib/health-score.ts, twee keer in
// components/dashboard/dgm-view.tsx, en in insights-block, tasks-block en recommendations-block
// — met VIER verschillende drempels:
//
//   dgm-view regel 617      > 10 procent
//   dgm-view regel 236      > 15 procent
//   insights-block          > 15 procent
//   tasks-block             > 15 procent
//   recommendations-block   > 15 procent
//   health-score            >= 5 licht, >= 20 sterk
//
// Op een account waar de CPA 12 procent steeg vuurde dgm-view regel 617 dus een waarschuwing af
// terwijl regel 236 in hetzelfde bestand zweeg. Twee blokken op hetzelfde scherm die elkaar
// tegenspreken, over hetzelfde account, uit hetzelfde product. Dat is precies de klasse die
// eerder drie verschillende antwoorden op "welke maand is het" opleverde.
//
// EN DE BEREKENING ZELF DEUGDE NIET
//
// Alle zes vergeleken de EERSTE gerealiseerde maand met de LAATSTE en negeerden alles ertussen.
// Op een reeks van dertien maanden geeft dat twee soorten onzin, allebei met een aanbeveling
// eraan: een campagne die twaalf maanden wegzakt en in de laatste maand herstelt komt uit op
// "+1 procent, niets aan de hand", en een lage eerste maand (een halve maand na de lancering)
// levert een verzonnen groeicijfer van honderden procenten op.
//
// Periode tegen periode heeft dat probleem niet: één maand kan de uitkomst niet meer bepalen.

/** Het aantal maanden aan elke kant van de vergelijking. */
export const TREND_WINDOW = 3;

/**
 * De procentuele verandering tussen de laatste periode en de periode daarvoor.
 *
 * Levert 0 als er te weinig punten zijn of als de basis nul is — niet Infinity of NaN, want
 * die komen verderop in een tekst terecht als "Infinity% gestegen".
 */
export function trendOver(values: number[]): number {
  if (values.length < 2) return 0;
  const venster = Math.min(TREND_WINDOW, Math.floor(values.length / 2));
  const recent = values.slice(-venster);
  const eerder = values.slice(-2 * venster, -venster);
  if (eerder.length === 0) return 0;
  const gem = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const basis = gem(eerder);
  if (!(basis > 0)) return 0;
  const uit = ((gem(recent) - basis) / basis) * 100;
  return Number.isFinite(uit) ? uit : 0;
}

/** Eén set drempels, zodat elk blok hetzelfde zegt over hetzelfde account. */
export const CPA_TREND = {
  /** Boven deze stijging is er iets aan de hand. */
  stijgt: 15,
  /** Boven deze stijging is het ernstig. */
  stijgtHard: 25,
  /** Onder deze daling gaat het aantoonbaar beter. */
  daalt: -15,
} as const;

export interface TrendPunt {
  realized: number | null;
  monthLabel?: string;
}

export interface CpaTrend {
  /** De procentuele verandering, of null als er te weinig maanden zijn. */
  pct: number | null;
  /** Het gemiddelde over de vorige periode. */
  vorig: number;
  /** Het gemiddelde over de laatste periode. */
  huidig: number;
  /** De maanden die vergeleken zijn, voor in de tekst naar de gebruiker. */
  periode: string;
  stijgt: boolean;
  stijgtHard: boolean;
  daalt: boolean;
}

/**
 * De CPA-trend uit een reeks forecast-punten.
 *
 * Punten zonder gerealiseerde waarde vallen weg: een lopende maand hoort niet mee te tellen,
 * en null als nul lezen zou de CPA kunstmatig verlagen.
 */
export function cpaTrendFrom(points: readonly TrendPunt[]): CpaTrend {
  const gerealiseerd = points.filter((p) => p.realized !== null && Number.isFinite(p.realized));
  const leeg: CpaTrend = { pct: null, vorig: 0, huidig: 0, periode: "", stijgt: false, stijgtHard: false, daalt: false };
  if (gerealiseerd.length < 2) return leeg;

  const waarden = gerealiseerd.map((p) => p.realized as number);
  const venster = Math.min(TREND_WINDOW, Math.floor(waarden.length / 2));
  const gem = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const vorig = gem(waarden.slice(-2 * venster, -venster));
  const huidig = gem(waarden.slice(-venster));
  const pct = trendOver(waarden);

  const eersteLabel = gerealiseerd[gerealiseerd.length - 2 * venster]?.monthLabel;
  const laatsteLabel = gerealiseerd[gerealiseerd.length - 1]?.monthLabel;
  const periode = eersteLabel && laatsteLabel ? ` (${eersteLabel} t/m ${laatsteLabel})` : "";

  return {
    pct, vorig, huidig, periode,
    stijgt: pct > CPA_TREND.stijgt,
    stijgtHard: pct > CPA_TREND.stijgtHard,
    daalt: pct < CPA_TREND.daalt,
  };
}
