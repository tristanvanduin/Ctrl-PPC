// Demo-videodata (YouTube) voor de GreenTech-demo. Twee campagnes met een bewust verschillend
// verhaal, zodat de duiding iets te zeggen heeft: de awareness-campagne trekt goedkoop bereik maar
// verliest kijkers direct (zwakke hook), de merkfilm houdt mensen vast tot het eind. Puur
// presentatie — alleen actief in demo-modus.

import type { VideoCampaignRow } from "@/lib/video/video-performance";
import type { PlacementInput } from "@/lib/video/placement-analysis";

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

// Demo-placements: waar het videobudget landde. Bewust een herkenbaar beeld — twee vakkanalen die
// hun werk doen, en daarnaast het klassieke YouTube-lek: een kinder-/spelapp en een breed
// entertainmentkanaal die samen honderden euro's kosten zonder één conversie. Plus een paar te
// kleine placements, zodat zichtbaar is dat die géén advies krijgen in plaats van blind uitgesloten
// te worden.
function pl(
  placement: string, displayName: string, placementType: string,
  cost: number, impressions: number, views: number, clicks: number, conversions: number,
  campaignName = "GRT | YouTube | Awareness NL",
): PlacementInput {
  return { placement, displayName, placementType, targetUrl: "", campaignName, impressions, clicks, cost, conversions, videoViews: views };
}

export const DEMO_PLACEMENTS: PlacementInput[] = [
  // Werken: vakpubliek, converteren tegen een normale CPA.
  pl("UC-tuinbouwtv", "TuinbouwTV", "YOUTUBE_CHANNEL", 620, 88_000, 26_400, 410, 18),
  pl("UC-greentechtalks", "GreenTech Talks", "YOUTUBE_CHANNEL", 430, 61_000, 19_800, 295, 12),
  pl("UC-agritech", "AgriTech Weekly", "YOUTUBE_CHANNEL", 260, 38_000, 11_500, 160, 6, "GRT | YouTube | Merkfilm beurs"),
  // Het lek: veel vertoningen en klikken, nul resultaat.
  pl("mobileapp-puzzelrijk", "Puzzelrijk (spel)", "MOBILE_APPLICATION", 340, 96_000, 8_200, 720, 0),
  pl("UC-clipsdaily", "Clips Daily", "YOUTUBE_CHANNEL", 215, 74_000, 12_900, 180, 0),
  pl("mobileapp-kidsgames", "Kids Games Wereld", "MOBILE_APPLICATION", 155, 52_000, 4_100, 430, 0),
  // Duur maar converteert: hoort een 'bekijken' te worden, geen uitsluiting.
  pl("UC-lifestylenl", "Lifestyle NL", "YOUTUBE_CHANNEL", 290, 41_000, 9_600, 140, 1),
  // Te klein om iets over te zeggen — bewust aanwezig om te tonen dat die met rust worden gelaten.
  pl("UC-kleinkanaal-a", "Kwekerij Vlog", "YOUTUBE_CHANNEL", 14, 1_900, 380, 9, 0),
  pl("UC-kleinkanaal-b", "Serre & Co", "YOUTUBE_CHANNEL", 8, 1_100, 210, 4, 0),
];
