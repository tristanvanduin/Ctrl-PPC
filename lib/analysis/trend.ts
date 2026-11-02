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

import type { ClientForecast } from "@/lib/forecast";
import { median } from "@/lib/util/stats";

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
  /** Kosten zonder één conversie (deriveForecast): geen CPA, wel gemeten. */
  geenNoemer?: boolean;
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
  /**
   * De maanden in het recente venster (de laatste TREND_WINDOW maanden met kosten) met kosten maar
   * zonder één conversie. Niet leeg: dan staan daalt, stijgt en stijgtHard uit. Die maand heeft geen
   * CPA om mee te middelen, en zonder hem las de reeks als "CPA daalt … optimalisaties werken" direct
   * na € 2.000 zonder één conversie, terwijl de health-score er een waarschuwing voor gaf. Een
   * "stijgt" met de getallen van de overige maanden zou "van € 25 naar € 18, een stijging van -28%"
   * schrijven. Elke lezer zegt het dan zelf, met deze maanden erbij.
   */
  zonderConversies: string[];
}

/**
 * De CPA-trend uit een reeks forecast-punten.
 *
 * Punten zonder gerealiseerde waarde vallen weg: een lopende maand hoort niet mee te tellen,
 * en null als nul lezen zou de CPA kunstmatig verlagen. Een punt met `geenNoemer` (kosten zonder
 * conversie) telt niet in de gemiddelden maar wel in `zonderConversies`.
 */
export function cpaTrendFrom(points: readonly TrendPunt[]): CpaTrend {
  const gerealiseerd = points.filter((p) => p.realized !== null && Number.isFinite(p.realized));
  const metKosten = points.filter((p) => (p.realized !== null && Number.isFinite(p.realized)) || p.geenNoemer);
  const zonderConversies = metKosten.slice(-TREND_WINDOW).filter((p) => p.geenNoemer).map((p) => p.monthLabel ?? "");
  const leeg: CpaTrend = { pct: null, vorig: 0, huidig: 0, periode: "", stijgt: false, stijgtHard: false, daalt: false, zonderConversies };
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

  const oordeel = zonderConversies.length === 0;
  return {
    pct, vorig, huidig, periode,
    stijgt: oordeel && pct > CPA_TREND.stijgt,
    stijgtHard: oordeel && pct > CPA_TREND.stijgtHard,
    daalt: oordeel && pct < CPA_TREND.daalt,
    zonderConversies,
  };
}

/**
 * De CPA-trend van een forecast, met de regel voor kosten zonder conversies erin: één plek voor de
 * health-score, de inzichten, de aanbevelingen en de rest.
 *
 * Een maand met kosten en geen conversie telt alleen als er minstens één conversie te verwachten
 * was: zijn kosten zijn minstens een gewone CPA (de mediaan van de gemeten maand-CPA's, zonder
 * die het CPA-doel). Drie euro restkosten na een pauze, bij een CPA van € 20, is 0,15 verwachte
 * conversie: die gaf de health-score een cijfer lager en de tekst "slechter wordt de efficiency
 * niet", terwijl dezelfde € 3 met één conversie de beste score kreeg. Zo'n maand valt dan weg,
 * zoals een maand van 0 / 0. Zonder gewone CPA en zonder doel telt hij wel: dan is er niets om
 * hem tegen af te zetten.
 */
export function cpaTrendVanForecast(forecast: Pick<ClientForecast, "cpa" | "adSpend">): CpaTrend {
  const punten = forecast.cpa.points;
  const gewoon = median(punten.filter((p) => p.realized !== null).map((p) => p.realized as number))
    ?? (forecast.cpa.kpi.annualTarget > 0 ? forecast.cpa.kpi.annualTarget : null);
  const telt = (p: (typeof punten)[number]) =>
    !p.geenNoemer || gewoon === null || (forecast.adSpend.points[p.month - 1]?.realized ?? 0) >= gewoon;
  return cpaTrendFrom(punten.filter((p) => (p.realized !== null || p.geenNoemer) && telt(p)));
}
