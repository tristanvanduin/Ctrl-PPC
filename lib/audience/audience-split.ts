// Doelgroepverdeling: welk type doelgroepsignaal (affiniteit, in-market, remarketing, custom,
// vergelijkbaar) welk deel van kosten en conversies draagt.
//
// De rekenkern komt bewust uit lib/pmax/network-split.ts en niet hier opnieuw geschreven --
// buildNetworkSplit is daar expliciet generiek gehouden voor precies dit hergebruik ("welk
// segment kost naar verhouding meer dan het oplevert" is dezelfde vraag voor een PMax-netwerk
// als voor een doelgroeptype; alleen het benoemen van de sleutel verschilt). Een tweede kopie
// van diezelfde optelling, aandeel- en CPA-berekening hier zou precies het soort duplicaat zijn
// dat de hygienepoort (median, safeDiv) al een keer heeft blootgelegd.

export { buildNetworkSplit as buildAudienceSplit, findImbalances as findAudienceImbalances, networkTotals as audienceTotals } from "@/lib/pmax/network-split";
export type { NetworkRow as AudienceRow, NetworkSlice as AudienceSlice, NetworkImbalance as AudienceImbalance } from "@/lib/pmax/network-split";

// Google Ads' audience_type-waarden, in de termen van het "Audience performance"-rapport in de
// interface. Onbekende waarden houden hun eigen naam.
const AUDIENCE_TYPE_LABEL: Record<string, string> = {
  AFFINITY: "Affiniteit",
  IN_MARKET: "In-market",
  CUSTOM: "Custom",
  REMARKETING: "Remarketing",
  SIMILAR: "Vergelijkbare doelgroepen",
  DETAILED_DEMOGRAPHIC: "Demografisch",
  LIFE_EVENT: "Levensgebeurtenis",
  UNSPECIFIED: "Onbekend",
  UNKNOWN: "Onbekend",
};

export function audienceTypeLabel(t: string): string {
  return AUDIENCE_TYPE_LABEL[(t || "").toUpperCase()] ?? t;
}
