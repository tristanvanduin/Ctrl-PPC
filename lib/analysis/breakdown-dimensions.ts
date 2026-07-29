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
}

export const BREAKDOWN_DIMENSIES: Record<BreakdownKanaal, BreakdownDimensie[]> = {
  // Volgorde is niet willekeurig: plaatsing is waar een Meta-adverteerder als eerste kijkt.
  // Het platform zegt op wélk netwerk je zat, de positie zegt wáár op dat netwerk.
  meta: [
    { key: "platform_position", label: "Plaatsing" },
    { key: "publisher_platform", label: "Platform" },
    { key: "device_platform", label: "Device" },
    { key: "age", label: "Leeftijd" },
    { key: "gender", label: "Gender" },
  ],
  linkedin: [
    { key: "MEMBER_JOB_FUNCTION", label: "Functie" },
    { key: "MEMBER_SENIORITY", label: "Senioriteit" },
    { key: "MEMBER_INDUSTRY", label: "Industrie" },
    { key: "MEMBER_COMPANY_SIZE", label: "Bedrijfsgrootte" },
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
