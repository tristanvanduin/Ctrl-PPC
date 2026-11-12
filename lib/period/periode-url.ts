// De periodekeuze in de adresbalk (bouwplan fase 2).
//
// Geen tweede model: dit is dezelfde keuze die de PeriodProvider al bewaart (preset, eigen bereik,
// vergelijking), alleen opgeschreven als twee zoekparameters. De waarden zijn de namen van het
// model zelf (last_3m, previous_period), zodat er geen vertaaltabel tussen zit die uit de pas kan
// lopen:
//
//   ?periode=last_3m                         een preset
//   ?periode=2026-03..2026-08                een eigen bereik (preset "custom")
//   &vergelijk=previous_period               alleen als het niet de standaard is
//
// De adresbalk gaat voor de bewaarde keuze als er een geldige periode in staat; staat er niets, of
// iets wat geen periode is, dan zegt de adresbalk niets en geldt wat de gebruiker de vorige keer
// koos. Een losse ?vergelijk= zonder periode telt daarom niet: een halve keuze uit een link mengen
// met de andere helft uit het geheugen geeft een toestand die niemand gekozen heeft.

import {
  PERIOD_PRESETS, COMPARISON_MODES, DEFAULT_COMPARISON, isValidMonth, normalizeRange,
  type ComparisonMode, type PeriodPreset, type PeriodeKeuze,
} from "./period-range";

export const PERIODE_PARAM = "periode";
export const VERGELIJK_PARAM = "vergelijk";

const EIGEN_BEREIK = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/;

/**
 * De keuze in één vaste vorm: het eigen bereik alleen bij "custom" (een preset draagt er geen), en
 * de grenzen in de goede volgorde. Twee keuzes die hetzelfde betekenen zijn dan ook gelijk als
 * tekst, en dat is waarmee de adresbalk en de lokale staat vergeleken worden.
 */
export function schonePeriodeKeuze(k: PeriodeKeuze): PeriodeKeuze {
  const eigen = k.preset === "custom" && k.custom && isValidMonth(k.custom.start) && isValidMonth(k.custom.end)
    ? normalizeRange(k.custom.start, k.custom.end) : null;
  return { preset: k.preset, custom: eigen, comparison: k.comparison };
}

/** De keuze uit de adresbalk, of null als er geen geldige periode in staat. */
export function periodeUitParams(p: { get(sleutel: string): string | null }): PeriodeKeuze | null {
  const ruw = p.get(PERIODE_PARAM);
  if (!ruw) return null;
  const v = p.get(VERGELIJK_PARAM);
  const comparison = (COMPARISON_MODES as readonly string[]).includes(v ?? "") ? (v as ComparisonMode) : DEFAULT_COMPARISON;
  if (ruw !== "custom" && (PERIOD_PRESETS as readonly string[]).includes(ruw)) {
    return { preset: ruw as PeriodPreset, custom: null, comparison };
  }
  const m = EIGEN_BEREIK.exec(ruw);
  if (!m || !isValidMonth(m[1]) || !isValidMonth(m[2])) return null;
  return { preset: "custom", custom: normalizeRange(m[1], m[2]), comparison };
}

/**
 * Zet de keuze in de zoekparameters, of haalt hem eruit (null). De andere parameters blijven staan.
 *
 * De periode staat er altijd voluit in, ook als het de standaard is: een link zonder periode
 * betekent "wat jij de vorige keer koos", en dan zou de ontvanger van een gedeelde link iets anders
 * zien dan de afzender. De vergelijking alleen als hij afwijkt; zonder periode telt hij toch niet.
 */
export function zetPeriodeParams(p: URLSearchParams, keuze: PeriodeKeuze | null): void {
  if (!keuze) { p.delete(PERIODE_PARAM); p.delete(VERGELIJK_PARAM); return; }
  const k = schonePeriodeKeuze(keuze);
  // "custom" zonder bereik rekent de provider uit als de laatste twaalf maanden; dan staat dat er.
  p.set(PERIODE_PARAM, k.preset === "custom" ? (k.custom ? `${k.custom.start}..${k.custom.end}` : "last_12m") : k.preset);
  if (k.comparison === DEFAULT_COMPARISON) p.delete(VERGELIJK_PARAM);
  else p.set(VERGELIJK_PARAM, k.comparison);
}
