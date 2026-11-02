// De weergave van forecast-metrieken, op één plek.
//
// formatCurrency stond in drie componenten, METRIC_LABELS in twee, en "is lager beter?" werd
// per component opnieuw als `metric === "cpa"` uitgeschreven. Dat laatste is het gevaarlijke
// deel: wie er een metriek bij zet waar lager beter is, moet dat op elke plek onthouden, en
// een gemiste plek kleurt rood groen. Daarom staan de labels, de formatters en de richting
// hier samen — één definitie per metriek.

import type { BudgetRecommendation, ForecastMetric } from "./forecast";

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

/**
 * Telt een metriek op over maanden en weken? Conversies en omzet wel; ROAS en CPA zijn
 * verhoudingen. Daarvan realiseer je geen percentage van een jaardoel, en over weken verdeel je ze
 * niet maar houd je het gemiddelde aan. Dezelfde regel stond vijf keer inline, en een gemiste
 * plek telde een ROAS van 2,4 op tot 3 per week.
 */
export function isOptelbaar(metric: ForecastMetric): boolean {
  return metric === "conversions" || metric === "revenue";
}

/**
 * Een maand of week zonder realisatie EN zonder prognose: vóór de start van het kanaal, of een
 * gat in de data. Dat is geen nul. `realized ?? forecast ?? 0` met het label "Prognose" maakte er
 * een voorspelde nul van, met een groene of rode ratio die op niets gemeten rust.
 */
export function zonderData(p: { realized: number | null; forecast: number | null }): boolean {
  return p.realized === null && p.forecast === null;
}

/**
 * Hoe een maand of week zonder waarde heet. Meestal "Geen data". Maar een verhouding met een teller
 * en zonder noemer (geenNoemer, deriveForecast) is gemeten: kosten zonder één conversie (CPA), of
 * omzet zonder kosten (ROAS). Die heette ook "Geen data", in het grijs, terwijl het voor een CPA de
 * slechtste maand van het jaar was. Het oordeel erbij: slecht voor een CPA, goed voor een ROAS.
 */
export function geenWaardeLabel(p: { geenNoemer?: boolean; geenNoemerPrognose?: boolean }, metric: ForecastMetric): string {
  // Een prognose met kosten maar zonder één verwachte conversie (geenNoemerPrognose): er is wel
  // data, € 1.820 verwachte kosten per maand. "Geen data" zei daar het tegendeel.
  if (p.geenNoemerPrognose) return metric === "cpa" ? "Geen conversies verwacht" : "Geen kosten verwacht";
  if (!p.geenNoemer) return "Geen data";
  return metric === "cpa" ? "Geen conversies" : "Geen kosten";
}

/**
 * Hoe het CPA-getal van het budgetadvies heet. Zonder conversies YTD valt computeBudgetRecommendation
 * terug op doelkosten / doelconversies (cpaUitDoel), en dat is geen "huidige CPA": het rapport zei
 * "geen conversies YTD, dus geen CPA" en twee regels later "Huidige CPA: € 20", en de CPA-kaart
 * ernaast "Gerealiseerd YTD —". Eén naam voor elke tekst die dat getal noemt.
 */
export function budgetCpaNaam(budget: Pick<BudgetRecommendation, "cpaUitDoel">): string {
  return budget.cpaUitDoel ? "het CPA-doel" : "de huidige CPA";
}
