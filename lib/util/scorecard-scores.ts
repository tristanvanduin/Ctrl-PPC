// Gedeelde scorebanden voor de campagnetype-scorecards (Search/Display/Shopping/PMax).
//
// Deze drie functies stonden als kopie in display-scorecard.ts, shopping-scorecard.ts en
// pmax-scorecard.ts (en onder andere namen in search-scorecard.ts), met een commentaar dat het
// "bewust niet gedeeld" was. Dat hield geen stand: drie kopieën van dezelfde vier banden is
// precies het patroon waarmee median en safeDiv eerder aan drie verschillende gedragingen
// kwamen — de vierde kopie is degene die het nét anders doet, en dan spreken twee scorecards
// elkaar tegen over hetzelfde account. Eén huis dus, met bandgrens-tests ernaast
// (lib/util/__scorecard_scores_test.ts).
//
// De banden zelf komen uit de Efficiency-factor in lib/health-score.ts, zodat de scorecards
// hetzelfde schaalgevoel houden als de accountbrede gezondheidsscore.

/**
 * Trendpercentage → 0-20 punten, voor metrics waar DALEN goed is (CPA, CPC, CPM).
 * `<` betekent "stijgt minder dan", dus elke daling scoort in de beste band.
 */
export function trendScoreDalendIsGoed(trendPct: number): number {
  if (trendPct < -10) return 20;
  if (trendPct < 5) return 16;
  if (trendPct < 20) return 10;
  return 4;
}

/** Trendpercentage → 0-20 punten, voor metrics waar STIJGEN goed is (CTR). */
export function trendScoreStijgendIsGoed(trendPct: number): number {
  if (trendPct > 10) return 20;
  if (trendPct > -10) return 14;
  if (trendPct > -25) return 8;
  return 4;
}

/**
 * Een "slecht aandeel" (0-1: verspilling, dure netwerken of segmenten) → 0-20 punten.
 * Laag aandeel is goed; boven de 40% blijft er weinig van de score over.
 */
export function aandeelScoreOmgekeerd(aandeel: number): number {
  if (aandeel < 0.10) return 20;
  if (aandeel < 0.25) return 14;
  if (aandeel < 0.40) return 8;
  return 4;
}
