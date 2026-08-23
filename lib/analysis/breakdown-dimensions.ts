// De uitsplitsingen die Meta en LinkedIn kennen, en hoe hun waarden heten.
//
// Los van het component gehouden zodat de belofte controleerbaar is: elke dimensie die de UI
// als knop aanbiedt moet ook echt rijen hebben. Stonden die lijsten in de weergave, dan was dat
// alleen met een browser te controleren — en precies dat ging eerder mis, want industrie en
// bedrijfsgrootte stonden wél in de vertaaltabel van de structuur-analyse maar hadden geen data.

export type BreakdownKanaal = "meta" | "linkedin";

export interface BreakdownDimensie {
  /** De waarde van breakdown_type (Meta) of pivot_type (LinkedIn). */
  key: string;
  label: string;
  /**
   * "levering" = hoe/waar de ad getoond wordt (Overzicht: "waar komt het vandaan").
   * "doelgroep" = wie erdoor bereikt wordt (Campagnes: "Doelgroepsignalen", zelfde vraag als
   * Google's AudienceSplit daar beantwoordt). Toegevoegd 23 augustus 2026: Google's
   * Doelgroepsignalen draait op audience-targeting-typedata die Meta/LinkedIn niet syncen, maar
   * leeftijd/gender (Meta) en alle vier LinkedIn-dimensies zijn zelf al doelgroepsignalen — geen
   * nieuwe databron nodig, alleen dezelfde uitsplitsing op de juiste plek tonen.
   */
  groep: "levering" | "doelgroep";
}

export const BREAKDOWN_DIMENSIES: Record<BreakdownKanaal, BreakdownDimensie[]> = {
  // Volgorde is niet willekeurig: plaatsing is waar een Meta-adverteerder als eerste kijkt.
  // Het platform zegt op wélk netwerk je zat, de positie zegt wáár op dat netwerk.
  meta: [
    { key: "platform_position", label: "Plaatsing", groep: "levering" },
    { key: "publisher_platform", label: "Platform", groep: "levering" },
    { key: "device_platform", label: "Device", groep: "levering" },
    { key: "age", label: "Leeftijd", groep: "doelgroep" },
    { key: "gender", label: "Gender", groep: "doelgroep" },
  ],
  // LinkedIn heeft geen leveringsdimensie zoals Meta's plaatsing/platform/device -- alle vier zijn
  // wie-vragen. Op Overzicht (groep "levering") toont BreakdownDonuts hier dus niets; dat is de
  // bewuste consequentie van de scheiding en geen ontbrekende data.
  linkedin: [
    { key: "MEMBER_JOB_FUNCTION", label: "Functie", groep: "doelgroep" },
    { key: "MEMBER_SENIORITY", label: "Senioriteit", groep: "doelgroep" },
    { key: "MEMBER_INDUSTRY", label: "Industrie", groep: "doelgroep" },
    { key: "MEMBER_COMPANY_SIZE", label: "Bedrijfsgrootte", groep: "doelgroep" },
  ],
};

/**
 * De platte enum-waarden van Meta in leesbaar Nederlands. Een onbekende waarde houdt zijn eigen
 * naam: een nieuwe plaatsing hoort zichtbaar te blijven, niet onder "overig" te verdwijnen.
 * LinkedIn heeft dit niet nodig — daar staan de namen in linkedin_urn_labels.
 */
const META_WAARDE_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  threads: "Threads",
  feed: "Feed",
  story: "Stories",
  reels: "Reels",
  right_hand_column: "Rechterkolom",
  marketplace: "Marketplace",
  search: "Zoeken",
  mobile: "Mobiel",
  desktop: "Desktop",
  female: "Vrouw",
  male: "Man",
  unknown: "Onbekend",
};

export function metaWaardeLabel(waarde: string): string {
  return META_WAARDE_LABEL[waarde] ?? waarde;
}
