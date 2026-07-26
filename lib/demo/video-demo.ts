// Demo-videodata (YouTube) voor de GreenTech-demo. Twee campagnes met een bewust verschillend
// verhaal, zodat de duiding iets te zeggen heeft: de awareness-campagne trekt goedkoop bereik maar
// verliest kijkers direct (zwakke hook), de merkfilm houdt mensen vast tot het eind. Puur
// presentatie — alleen actief in demo-modus.

import type { VideoCampaignRow } from "@/lib/video/video-performance";

function vrow(
  campaignId: string, campaignName: string, month: string,
  impressions: number, cost: number, views: number,
  p25: number, p50: number, p75: number, p100: number,
): VideoCampaignRow {
  return {
    campaignId, campaignName, campaignType: "VIDEO", month,
    impressions, cost, videoViews: views,
    avgCpm: impressions > 0 ? (cost / impressions) * 1000 : 0,
    avgCpv: views > 0 ? cost / views : 0,
    videoViewRate: impressions > 0 ? views / impressions : 0,
    videoQuartileP25: p25, videoQuartileP50: p50, videoQuartileP75: p75, videoQuartileP100: p100,
  };
}

export const DEMO_VIDEO_ROWS: VideoCampaignRow[] = [
  // Breed prospecting: goedkoop bereik, maar men haakt vroeg af — opening pakt niet.
  vrow("demo-v-awareness", "GRT | YouTube | Awareness NL", "2026-05-01", 412_000, 2_140, 118_000, 0.41, 0.22, 0.13, 0.09),
  vrow("demo-v-awareness", "GRT | YouTube | Awareness NL", "2026-06-01", 438_000, 2_290, 126_500, 0.43, 0.24, 0.14, 0.10),
  vrow("demo-v-awareness", "GRT | YouTube | Awareness NL", "2026-07-01", 401_000, 2_080, 114_000, 0.40, 0.21, 0.12, 0.08),
  // Merkfilm op een warmer publiek: duurder bereik, maar men kijkt door.
  vrow("demo-v-brandfilm", "GRT | YouTube | Merkfilm beurs", "2026-05-01", 96_000, 1_480, 41_500, 0.88, 0.71, 0.52, 0.44),
  vrow("demo-v-brandfilm", "GRT | YouTube | Merkfilm beurs", "2026-06-01", 103_000, 1_610, 45_200, 0.90, 0.73, 0.55, 0.47),
  vrow("demo-v-brandfilm", "GRT | YouTube | Merkfilm beurs", "2026-07-01", 91_500, 1_420, 39_800, 0.87, 0.70, 0.51, 0.43),
];
