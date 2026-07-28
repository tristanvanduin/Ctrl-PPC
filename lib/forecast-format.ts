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

export function formatRoas(v: number): string {
  return `${v.toFixed(2)}x`;
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
