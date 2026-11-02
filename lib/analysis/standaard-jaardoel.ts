import type { ClientAnnualData, DoelHerkomst } from "../types";
import { formatDeltaPercent } from "../forecast-format";

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
// (lib/kpi-target-merge.ts) -- wint dat doel en komt deze functie er niet meer aan te pas. Dan
// zeggen de schermen ook niet meer "geschat": zie jaardoelTekst onderaan.
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

/** Wat een scherm over het jaardoel zegt, opgesplitst zodat elke zin hem op zijn eigen plek kan zetten. */
export interface JaardoelTekst {
  /** Of het doel in Instellingen is ingevoerd (vast of als groei). False: de schatting. */
  ingevoerd: boolean;
  /** "jaardoel" of "geschat jaardoel"; met lidwoord "het jaardoel" of "het geschatte jaardoel". */
  naam: string;
  /** Wat tussen haakjes achter de naam hoort, zonder haakjes. Null bij een vast doel. */
  toelichting: string | null;
}

/**
 * De naam van het jaardoel met zijn herkomst, voor de health score, de pacing, de grafiek en het
 * rapport. Die zeiden altijd "geschat jaardoel (vorig jaar +10%; er is nog geen doel ingevoerd)", ook
 * naast een doel uit Instellingen: de data droeg alleen het getal. Nu draagt hij de herkomst mee
 * (ClientHistoricalData.doelHerkomst, gezet door mergeKpiTargets), en zegt elk scherm wat waar is:
 *
 * - een vast doel: "jaardoel", zonder toelichting;
 * - een ingevoerde groei: "jaardoel (vorig jaar +15%)", met het teken, ook bij krimp;
 * - niets ingevoerd, of onbekend: de schatting zoals altijd. `lang` voegt "er is nog geen doel
 *   ingevoerd" toe, voor de zinnen die dat al zeiden (zie nogGeenDoelIngevoerd: staat het ANDERE
 *   doel wel in Instellingen, geef dan `ander` mee, en dan noemt de zin het ontbrekende doel).
 *
 * Onbekend (undefined) geldt als de schatting: de prognose van de kanaaltabbladen
 * (buildChannelForecast) komt zonder herkomst, en daar stond deze tekst al. De kanaalbadges en Code
 * Rood (computeAnalysisTargets) dragen hem wel mee.
 */
export function jaardoelTekst(
  herkomst: DoelHerkomst | undefined,
  { lidwoord = false, lang = false, metric = "conversions", ander }: {
    lidwoord?: boolean; lang?: boolean; metric?: "conversions" | "revenue";
    /** De herkomst van het doel van de ANDERE metric (omzet naast conversies, en omgekeerd). */
    ander?: DoelHerkomst;
  } = {},
): JaardoelTekst {
  if (herkomst?.soort === "absoluut") {
    return { ingevoerd: true, naam: lidwoord ? "het jaardoel" : "jaardoel", toelichting: null };
  }
  if (herkomst?.soort === "groei") {
    // Dezelfde notatie als de regel onder het groeiveld in Instellingen (groeiRegel, lib/kpi-kaart.ts).
    const pct = formatDeltaPercent(herkomst.groeiPct, Number.isInteger(herkomst.groeiPct) ? 0 : 1);
    return { ingevoerd: true, naam: lidwoord ? "het jaardoel" : "jaardoel", toelichting: `vorig jaar ${pct}` };
  }
  // De standaardgroei van de metric waar het scherm tegen afrekent (nu beide 10%).
  const groei = metric === "revenue" ? GROEI_OMZET : GROEI_CONVERSIES;
  const standaard = `vorig jaar +${Math.round((groei - 1) * 100)}%`;
  return {
    ingevoerd: false,
    naam: lidwoord ? "het geschatte jaardoel" : "geschat jaardoel",
    toelichting: lang ? `${standaard}; ${nogGeenDoelIngevoerd(metric, ander)}` : standaard,
  };
}

/**
 * "er is nog geen doel ingevoerd", of, als het doel van de andere metric WEL in Instellingen staat,
 * "er is nog geen conversiedoel ingevoerd" (of omzetdoel). Met alleen een omzetdoel zeiden de grafiek,
 * het rapport en de health score "er is nog geen doel ingevoerd" terwijl dat omzetdoel er stond: ze
 * rekenen op het conversiedoel, en alleen dat ontbreekt. Zonder ander doel blijft het woord voor
 * woord de oude zin.
 */
export function nogGeenDoelIngevoerd(metric: "conversions" | "revenue", ander: DoelHerkomst | undefined): string {
  const anderIngevoerd = ander !== undefined && ander.soort !== "standaard";
  return `er is nog geen ${anderIngevoerd ? (metric === "revenue" ? "omzetdoel" : "conversiedoel") : "doel"} ingevoerd`;
}

/** De naam met de toelichting tussen haakjes erachter: "jaardoel (vorig jaar +15%)". */
export function metToelichting(t: JaardoelTekst): string {
  return t.toelichting ? `${t.naam} (${t.toelichting})` : t.naam;
}
