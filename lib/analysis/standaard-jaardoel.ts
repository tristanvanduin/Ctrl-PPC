import type { ClientAnnualData } from "../types";

// Het jaardoel zolang er geen doel is ingevoerd: het laatst VOLLEDIGE jaar plus groei.
//
// Waarom dit een eigen bestand is. Deze regel stond op twee plekken los uitgeschreven
// (app/api/google-ads/client-data/route.ts en lib/api/blended-historical.ts) en op een derde plek
// helemaal niet: `buildChannelForecast` voor Meta en LinkedIn viel terug op nul. Gevolg op het
// scherm: Google's beurs-sectie toonde per week een verwachting en een ratio, en dezelfde sectie
// op Meta en LinkedIn toonde alleen het gerealiseerde -- niet omdat die kanalen anders zijn, maar
// omdat één van de drie plekken de afspraak niet kende. "Ligt het aan mij of zijn deze niet
// uniform?" Nee, dat lag hier.
//
// De percentages zijn geen natuurwet en horen dat ook niet te lijken: het is een extrapolatie met
// een groeiaanname erin, geen afspraak met de klant. De schermen die hem gebruiken zeggen dat er
// ook bij ("vorig jaar +10%; er is nog geen doel ingevoerd"). Zodra er wél een doel staat --
// client_targets voor Meta/LinkedIn, de KPI-instellingen voor Google en blended
// (lib/kpi-target-merge.ts) -- wint dat doel en komt deze functie er niet meer aan te pas.
//
// Spend groeit met vijf en niet met tien procent: het doel is meer conversies uit relatief minder
// budget, niet evenredig meer uitgeven.

export const GROEI_CONVERSIES = 1.10;
export const GROEI_OMZET = 1.10;
export const GROEI_SPEND = 1.05;

/** De som over een jaar aan maandrijen. */
export interface JaarTotaal {
  conversions: number;
  revenue: number;
  adSpend: number;
}

export function standaardJaardoel(vorigJaar: JaarTotaal | null): ClientAnnualData {
  return {
    conversions: Math.round((vorigJaar?.conversions ?? 0) * GROEI_CONVERSIES),
    revenue: Math.round((vorigJaar?.revenue ?? 0) * GROEI_OMZET),
    adSpend: Math.round((vorigJaar?.adSpend ?? 0) * GROEI_SPEND),
  };
}

/**
 * Het ingevoerde doel waar het bestaat, anders het standaarddoel per metric.
 *
 * Per metric en niet als geheel: een klant die alleen een conversiedoel heeft ingevoerd, hoort
 * voor omzet en spend niet op nul te vallen -- dat leest als "doel gehaald" (of juist als een
 * onhaalbaar doel) terwijl er gewoon niets is ingevuld.
 */
export function jaardoelMetTerugval(
  ingevoerd: Partial<ClientAnnualData>,
  vorigJaar: JaarTotaal | null,
): ClientAnnualData {
  const standaard = standaardJaardoel(vorigJaar);
  return {
    conversions: ingevoerd.conversions && ingevoerd.conversions > 0 ? ingevoerd.conversions : standaard.conversions,
    revenue: ingevoerd.revenue && ingevoerd.revenue > 0 ? ingevoerd.revenue : standaard.revenue,
    adSpend: ingevoerd.adSpend && ingevoerd.adSpend > 0 ? ingevoerd.adSpend : standaard.adSpend,
  };
}
