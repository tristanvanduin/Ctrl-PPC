// De doelkaarten in Instellingen (components/dashboard/client-settings.tsx): van opgeslagen doel naar
// kaart en terug, voor de kaarten met een groeimodus (conversies en omzet).
//
// Puur en apart van het paneel, zodat het te testen is (lib/__kpi_kaart_krimp_test.ts). De aanleiding:
// een opgeslagen KRIMPdoel (-10%) werd op het dashboard toegepast (mergeKpiTargets: vorig jaar x 0,9),
// maar het paneel las de kaart alleen als "aan" bij een groei > 0. Dan stond de kaart bij het openen
// uit, met de velden verborgen, en schreef de volgende opslag van welk veld ook groei 0 weg: het doel
// werd stil vorig jaar +10%. Krimpdoelen blijven toegestaan, maar alleen boven -100%: vorig jaar x 0
// (of minder) is geen doel, en dan valt het dashboard terug op het standaarddoel. Zo'n waarde staat
// hier dus ook niet als "aan", en wordt niet opgeslagen.

import type { KpiMode } from "./client-settings";
import { formatDeltaPercent } from "./forecast-format";

export type KpiPeriod = "year" | "month";
export type KpiInputMode = "absolute" | "growth";

export interface KpiConfig {
  enabled: boolean;
  value: number;
  period: KpiPeriod;
  inputMode: KpiInputMode;
  growthPct: number;
}

/** Het opgeslagen deel van één groeikaart (conversionsMode/-GrowthPct/-Absolute, of die van omzet). */
export interface GroeiDoel {
  mode: KpiMode;
  growthPct: number;
  absolute: number;
}

/**
 * Is er een groei ingevoerd? Elke eindige waarde behalve 0 en boven -100, dus ook een krimp: dezelfde
 * regel als opGroei in mergeKpiTargets ("groei 0 is niets ingevoerd"; een groei van -100% of lager
 * geeft geen doel). Een null of NaN uit een oude rij telt daar ook als niets, en hoort hier dus geen
 * kaart aan te zetten. Hier stond geen ondergrens: een opgeslagen -100% zette de kaart aan met
 * "-100% ten opzichte van vorig jaar", terwijl het dashboard het standaarddoel nam en "er is nog geen
 * doel ingevoerd" zei.
 */
function groeiIngevoerd(pct: number): boolean {
  return Number.isFinite(pct) && pct !== 0 && pct > -100;
}

/** De kaart bij het openen van Instellingen. Aan zodra het dashboard er een doel uit haalt. */
export function groeiKaartUitDoel(doel: GroeiDoel): KpiConfig {
  return {
    enabled: doel.absolute > 0 || groeiIngevoerd(doel.growthPct),
    value: doel.absolute,
    period: "year",
    inputMode: doel.mode === "growth" ? "growth" : "absolute",
    growthPct: doel.growthPct,
  };
}

/**
 * Wat handleSave van de kaart opslaat. Een kaart die uit staat, slaat niets op (groei 0, geen vast doel),
 * en een groei die geen doel kan geven (-100% of lager, zie groeiIngevoerd) ook niet: die zou bij het
 * volgende openen als "uit" staan, terwijl hij in de database als ingevoerd stond.
 */
export function groeiDoelUitKaart(kaart: KpiConfig): GroeiDoel {
  return {
    mode: kaart.inputMode === "growth" ? "growth" : "absolute",
    growthPct: kaart.enabled && groeiIngevoerd(kaart.growthPct) ? kaart.growthPct : 0,
    absolute: kaart.enabled && kaart.inputMode === "absolute"
      ? (kaart.period === "month" ? kaart.value * 12 : kaart.value)
      : 0,
  };
}

/**
 * De regel onder het groeiveld, met het teken: "+10% ten opzichte van vorig jaar", "-10% ...". Null
 * zonder groei. Hier stond vast een plusteken en de regel verscheen alleen bij > 0, dus wie -10
 * intypte, kreeg geen bevestiging van wat het dashboard ging doen.
 */
export function groeiRegel(growthPct: number): string | null {
  if (!groeiIngevoerd(growthPct)) return null;
  return `${formatDeltaPercent(growthPct, Number.isInteger(growthPct) ? 0 : 1)} ten opzichte van vorig jaar`;
}
