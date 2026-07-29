// De weergave van forecast-metrieken, op één plek.
//
// formatCurrency stond in drie componenten, METRIC_LABELS in twee, en "is lager beter?" werd
// per component opnieuw als `metric === "cpa"` uitgeschreven. Dat laatste is het gevaarlijke
// deel: wie er een metriek bij zet waar lager beter is, moet dat op elke plek onthouden, en
// een gemiste plek kleurt rood groen. Daarom staan de labels, de formatters en de richting
// hier samen — één definitie per metriek.

import type { ForecastMetric } from "./forecast";

export const METRIC_LABELS: Record<ForecastMetric, string> = {
  conversions: "Conversies",
  revenue: "Omzet",
  roas: "ROAS",
  cpa: "CPA",
};

export function formatNumber(v: number): string {
  return new Intl.NumberFormat("nl-NL").format(Math.round(v));
}

export function formatCurrency(v: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

/**
 * ROAS: Nederlandse notatie, met het maal-teken.
 *
 * Hier stond `${v.toFixed(2)}x`, en op zeven andere plekken stond diezelfde regel nog eens
 * afzonderlijk. Dat leverde drie verschillende schrijfwijzen op voor hetzelfde getal — "1.56",
 * "1.56x" en "1,52×" — en de eerste twee zijn in het Nederlands ronduit fout: de punt is hier het
 * duizendtalteken. In de kaartenrij bovenaan het dashboard stond "ROAS 1.56" naast
 * "Advertentiekosten € 91.890", en binnen diezelfde rij betekende dezelfde punt dus twee dingen.
 *
 * De letter x wordt bovendien voorgelezen als de letter x. Het maal-teken × leest als "keer".
 */
export function formatRoas(v: number): string {
  return `${new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}×`;
}

/**
 * Een verhouding als percentage: 0,124 → "12,4%".
 *
 * Overal in de codebase stond `${(r * 100).toFixed(1)}%`, en dat geeft "12.4%" met een punt.
 * In de kaartenrij bovenaan stond "+12.4%" recht onder "€ 143.520": binnen één kaartje betekende
 * de punt dus twee verschillende dingen. Intl kent de Nederlandse schrijfwijze en zet meteen het
 * procentteken op de juiste plek.
 */
export function formatPercent(ratio: number, decimalen = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "percent",
    minimumFractionDigits: decimalen,
    maximumFractionDigits: decimalen,
  }).format(ratio);
}

/**
 * Een verschil dat al in procenten staat, met zijn teken: 12,4 → "+12,4%".
 *
 * Het plusteken is er expliciet bij. Zonder dat lezen "+12,4%" en "12,4%" als hetzelfde, terwijl
 * de eerste een stijging is en de tweede een niveau — en juist bij een vergelijking naast een
 * getal is dat het verschil tussen "erbij" en "in totaal".
 */
export function formatDeltaPercent(procenten: number, decimalen = 1): string {
  if (!Number.isFinite(procenten)) return "—";
  const getal = new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: decimalen,
    maximumFractionDigits: decimalen,
  }).format(procenten);
  return `${procenten > 0 ? "+" : ""}${getal}%`;
}

/** De formatter die bij de metriek hoort: bedragen in euro's, ROAS met een x, rest als getal. */
export function formatterFor(metric: ForecastMetric): (v: number) => string {
  if (metric === "revenue" || metric === "cpa") return formatCurrency;
  if (metric === "roas") return formatRoas;
  return formatNumber;
}

/**
 * Is een lagere waarde beter? Alleen CPA: goedkoper per conversie is winst. Voor de overige
 * metrieken is meer beter. Gebruik dit overal waar een verschil of ratio een kleur krijgt.
 */
export function isLowerBetter(metric: ForecastMetric): boolean {
  return metric === "cpa";
}
