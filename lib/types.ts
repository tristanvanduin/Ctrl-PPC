import type { DataStandSamen } from "./sync/datastand";

export interface WeeklyRecord {
  week: number;    // 1-based week within the month (1–5)
  month: number;   // 1–12
  conversions: number;
  revenue: number;
  adSpend: number;
}

export interface MonthlyRecord {
  month: number; // 1–12
  conversions: number;
  revenue: number;
  adSpend: number;
  weeks: WeeklyRecord[];
}

export interface ClientAnnualData {
  conversions: number;
  revenue: number;
  adSpend: number;
}

/**
 * Waar het jaardoel van één metric vandaan komt. Het getal alleen zegt dat niet: een ingevoerde groei
 * van 10% en het standaarddoel (vorig jaar +10%) geven hetzelfde getal, en toch is het ene een
 * afspraak en het andere een schatting.
 *
 * - `absoluut`: een vast doel, ingevoerd in Instellingen.
 * - `groei`: een groeipercentage, ingevoerd in Instellingen (vorig jaar + groeiPct).
 * - `standaard`: niets ingevoerd, dus standaardJaardoel (lib/analysis/standaard-jaardoel.ts).
 */
export type DoelHerkomst =
  | { soort: "absoluut" }
  | { soort: "groei"; groeiPct: number }
  | { soort: "standaard" };

/** De herkomst per metric met een eigen doelveld in Instellingen. Spend volgt uit CPA of ROAS. */
export interface DoelHerkomstPerMetric {
  conversions: DoelHerkomst;
  revenue: DoelHerkomst;
}

export interface ClientHistoricalData {
  clientId: string;
  /** Target for the current year */
  targetCurrentYear: ClientAnnualData;
  /**
   * Waar `targetCurrentYear` vandaan komt (mergeKpiTargets zet hem, en computeAnalysisTargets voor
   * de kanaalbadges, KanaalHealthRanking en Code Rood). De schermen zeggen daarmee "jaardoel" of
   * "geschat jaardoel"; hier stond alleen het getal, en toen zei elk scherm "geschat ... er is nog
   * geen doel ingevoerd", ook naast een doel uit Instellingen. Ontbreekt hij (de prognose van de
   * kanaaltabbladen, buildChannelForecast, die zijn doel uit client_targets haalt), dan de
   * schatting, zoals voorheen.
   */
  doelHerkomst?: DoelHerkomstPerMetric;
  /**
   * Historical years keyed by year number (e.g., { 2022: [...], 2023: [...], 2024: [...], 2025: [...] }).
   * More years = better forecasts. The engine weighs recent years heavier.
   */
  historicalYears: Record<number, MonthlyRecord[]>;
  /** Current year data — realized months + null for future months */
  currentYearData: (MonthlyRecord | null)[];
  /** What year is "current" */
  currentYear: number;
  /** Manual conversion overrides for months with broken tracking. Key = "YYYY-MM", value = estimated conversions */
  conversionOverrides?: Record<string, number>;
  /**
   * Tot welke dag de data definitief is en welke maand de laatste volle is, zoals de bron die
   * vaststelt (de Google client-data-route zet hem mee). Het venster van de KPI-band eindigt
   * hierop in plaats van op de kalender. Ontbreekt hij (null of weggelaten), dan volgen de presets
   * de kalender, zoals vroeger.
   */
  dataStand?: DataStandSamen | null;
  /**
   * De eerste dag met data ("YYYY-MM-DD") van een kanaal dat midden in een maand begon, of na een
   * pauze van een hele maand terugkwam (de eerste dag van zijn huidige loop). Alleen voor
   * het tempo zonder jaardoel: is die partiële maand de laatste gerealiseerde, dan telt het tempo
   * de dagen vanaf deze dag en niet de hele maand. Weglaten: de hele maand, zoals voorheen.
   */
  eersteDag?: string | null;
  /**
   * Het jaardoel is een deeljaar op jaarbasis (kanaalHistorieUitMaanden, voor een kanaal dat vorig
   * jaar later begon): het hoort bij twaalf maanden, ook die zonder historie. Dan vult de
   * verwachting zo'n maand zonder realisatie (januari) met het gemiddelde van de historie, en niet
   * met nul. Weglaten: nul, zoals voorheen.
   */
  doelOpJaarbasis?: boolean;
}

// ── Backwards compatibility: map old field names to new structure ──

/** @deprecated Use historicalYears / currentYearData instead */
export function getHistoricalYear(data: ClientHistoricalData, year: number): MonthlyRecord[] {
  if (year === data.currentYear) {
    return data.currentYearData.map((m, i) => m ?? {
      month: i + 1, conversions: 0, revenue: 0, adSpend: 0, weeks: [],
    });
  }
  return data.historicalYears[year] ?? Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, conversions: 0, revenue: 0, adSpend: 0, weeks: [],
  }));
}
