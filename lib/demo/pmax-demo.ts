// Demo-netwerkverdeling voor Performance Max. Bewust een herkenbaar en veelvoorkomend patroon:
// Zoeken draagt de conversies, terwijl Display een fors deel van het budget opsoupeert met
// weinig resultaat — precies de scheefheid die je in PMax niet ziet zolang je alleen naar het
// campagnetotaal kijkt. YouTube zit ertussenin en Gemengd is klein.
//
// De cijfers zijn zo gekozen dat de scheefheid materieel is (ruim boven de drempels) zonder
// karikaturaal te worden.

import type { NetworkRow } from "@/lib/pmax/network-split";

function nw(networkType: string, cost: number, conversions: number, impressions: number, clicks: number): NetworkRow {
  return { networkType, cost, conversions, conversionsValue: Math.round(conversions * 135), impressions, clicks };
}

export const DEMO_PMAX_NETWORKS: NetworkRow[] = [
  // Zoeken: 46% van de kosten, ~68% van de conversies — het werkpaard.
  nw("SEARCH", 5_240, 118, 214_000, 6_900),
  // Display: 31% van de kosten, ~13% van de conversies — de scheefheid.
  nw("CONTENT", 3_520, 22, 1_640_000, 4_100),
  // YouTube: bereik met bescheiden directe conversie.
  nw("YOUTUBE_WATCH", 1_820, 24, 690_000, 2_300),
  // Gemengd: klein restje dat Google niet toewijst.
  nw("MIXED", 690, 10, 158_000, 820),
];
