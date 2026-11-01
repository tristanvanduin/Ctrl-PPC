// Hoe de Google-routes twee perioden vergelijken: met dezelfde paarregel en dezelfde historie als
// het klantdashboard.
//
// WAAROM DIT BESTAAT
//
// Het portfolio-scorebord (/api/google-ads/overview) zette de som van de gekozen periode af tegen
// de som van de vergelijking, zonder te kijken of het account in die maanden al liep. Een account
// dat halverwege de vergelijkingsperiode begon, kreeg zo groei over maanden waarin het vorig jaar
// nog niet bestond. Het klantdashboard paart sinds stap 0 (gepaardeTotalen in
// lib/period/apply-period.ts); het scorebord gebruikt nu dezelfde functie, dus dezelfde regel.
//
// DE HISTORIE HOORT ERBIJ
//
// De start van een bron is de eerste maand met data. Die moet je in de HISTORIE zoeken, niet in het
// opgehaalde venster: een seizoensaccount dat in januari vorig jaar stil lag, zou anders lezen als
// een account dat toen nog niet bestond, en het scorebord zou een andere start zien dan het
// dashboard (dat HISTORIE_JAREN jaar laadt). Daarom kijken beide routes even ver terug.

import type { GoogleAdsMetrics } from "./google-ads";
import { googleAdsMonthlyToApiData } from "./adapter";
import { gepaardeTotalen, type BronReeks, type Totalen } from "@/lib/period/apply-period";
import type { PeriodRange } from "@/lib/period/period-range";

/** Hoeveel kalenderjaren vóór het lopende jaar de Google-routes ophalen. */
export const HISTORIE_JAREN = 5;

/**
 * Maandrijen uit de Google Ads API als BronReeks op "YYYY-MM". Afgerond zoals de adapter dat doet
 * (googleAdsMonthlyToApiData), zodat het percentage over dezelfde getallen gaat als de totalen ernaast.
 * Twee rijen in dezelfde maand worden opgeteld.
 */
export function googleMaandReeks(naam: string, rijen: readonly GoogleAdsMetrics[]): BronReeks {
  const maanden = new Map<string, Totalen>();
  for (const r of rijen) {
    const k = String(r.date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const [m] = googleAdsMonthlyToApiData([r]);
    const t = maanden.get(k) ?? { conversions: 0, revenue: 0, adSpend: 0 };
    t.conversions += m.conversions;
    t.revenue += m.revenue;
    t.adSpend += m.adSpend;
    maanden.set(k, t);
  }
  return { naam, maanden };
}

const pct = (huidig: number, vorig: number): number | null =>
  vorig > 0 ? parseFloat((((huidig - vorig) / vorig) * 100).toFixed(1)) : null;

/** De yoy-percentages van het scorebord: gepaard, op één decimaal, null zonder basis. */
export function jaarOpJaar(
  reeks: BronReeks,
  period: PeriodRange,
  comparison: PeriodRange,
): { convChange: number | null; revChange: number | null; spendChange: number | null } {
  const { huidig, vorig } = gepaardeTotalen([reeks], period, comparison);
  return {
    convChange: pct(huidig.conversions, vorig.conversions),
    revChange: pct(huidig.revenue, vorig.revenue),
    spendChange: pct(huidig.adSpend, vorig.adSpend),
  };
}
