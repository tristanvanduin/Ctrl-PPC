// Video-prestaties (YouTube / Demand Gen) met de juiste lens.
//
// Het probleem dat dit oplost: een TrueView-campagne levert weinig klikken en vrijwel geen directe
// conversies. Beoordeel je die op CTR en CPA — de standaard-search-maten — dan lijkt elke
// videocampagne mislukt. De maten die er wél toe doen zijn CPM (wat kost bereik), CPV (wat kost
// een view), view rate (hoeveel vertoningen worden een view) en kijkdiepte (waar haken ze af).
//
// De kijkdiepte is diagnostisch: zakt het al bij p25 weg, dan pakt je opening niet. Blijft p75
// hoog, dan landt de boodschap en zit het probleem elders (targeting, aanbod, landingspagina).

export interface VideoCampaignRow {
  campaignId: string;
  campaignName: string;
  campaignType: string | null;
  month: string;
  impressions: number;
  cost: number;
  videoViews: number;
  avgCpm: number;
  avgCpv: number;
  videoViewRate: number;
  videoQuartileP25: number;
  videoQuartileP50: number;
  videoQuartileP75: number;
  videoQuartileP100: number;
}

export interface VideoCampaignAgg {
  campaignId: string;
  campaignName: string;
  impressions: number;
  cost: number;
  videoViews: number;
  /** Uit de venstertotalen, niet uit een gemiddelde van maandwaarden. */
  cpm: number | null;
  cpv: number | null;
  viewRate: number | null;
  /** Kijkdiepte, gewogen naar vertoningen zodat een kleine maand niet meeweegt als een grote. */
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p100: number | null;
}

// Drempels voor de kijkdiepte-diagnose. Bewust ruim gekozen: dit is een richtinggevend signaal
// voor de creatieve briefing, geen hard oordeel. Google's eigen benchmarks lopen sterk uiteen per
// branche en videolengte, dus we claimen geen precisie die we niet hebben.
export const HOOK_WEAK_P25 = 0.5;      // minder dan de helft haalt 25% -> opening pakt niet
export const COMPLETION_STRONG_P75 = 0.4; // 40%+ haalt 75% -> boodschap landt

export type VideoDiagnosis = "hook_zwak" | "boodschap_landt" | "middenmoot" | "te_weinig_data";

/** Sommeer maandrijen per campagne; ratio's uit de totalen, kijkdiepte gewogen naar vertoningen. */
export function aggregateVideoCampaigns(rows: VideoCampaignRow[]): VideoCampaignAgg[] {
  interface Acc {
    campaignId: string; campaignName: string;
    impressions: number; cost: number; videoViews: number;
    // gewogen sommen voor de quartielen (gewicht = vertoningen van die maand)
    wP25: number; wP50: number; wP75: number; wP100: number; wBase: number;
  }
  const m = new Map<string, Acc>();
  for (const r of rows) {
    const a = m.get(r.campaignId) ?? {
      campaignId: r.campaignId, campaignName: r.campaignName,
      impressions: 0, cost: 0, videoViews: 0,
      wP25: 0, wP50: 0, wP75: 0, wP100: 0, wBase: 0,
    };
    a.campaignName = r.campaignName || a.campaignName;
    a.impressions += r.impressions;
    a.cost += r.cost;
    a.videoViews += r.videoViews;
    const w = r.impressions;
    if (w > 0) {
      a.wP25 += r.videoQuartileP25 * w;
      a.wP50 += r.videoQuartileP50 * w;
      a.wP75 += r.videoQuartileP75 * w;
      a.wP100 += r.videoQuartileP100 * w;
      a.wBase += w;
    }
    m.set(r.campaignId, a);
  }

  return [...m.values()].map((a) => ({
    campaignId: a.campaignId,
    campaignName: a.campaignName,
    impressions: a.impressions,
    cost: a.cost,
    videoViews: a.videoViews,
    cpm: a.impressions > 0 ? (a.cost / a.impressions) * 1000 : null,
    cpv: a.videoViews > 0 ? a.cost / a.videoViews : null,
    viewRate: a.impressions > 0 ? a.videoViews / a.impressions : null,
    p25: a.wBase > 0 ? a.wP25 / a.wBase : null,
    p50: a.wBase > 0 ? a.wP50 / a.wBase : null,
    p75: a.wBase > 0 ? a.wP75 / a.wBase : null,
    p100: a.wBase > 0 ? a.wP100 / a.wBase : null,
  }));
}

/**
 * Duidt de kijkdiepte. Geeft bewust "te_weinig_data" terug bij een dunne basis: bij een paar
 * honderd vertoningen is een quartielpercentage ruis, en een advies daarop is een gok.
 */
export function diagnoseVideo(agg: VideoCampaignAgg, minImpressions = 1000): VideoDiagnosis {
  if (agg.impressions < minImpressions || agg.p25 == null || agg.p75 == null) return "te_weinig_data";
  if (agg.p25 < HOOK_WEAK_P25) return "hook_zwak";
  if (agg.p75 >= COMPLETION_STRONG_P75) return "boodschap_landt";
  return "middenmoot";
}

export const VIDEO_DIAGNOSIS_LABEL: Record<VideoDiagnosis, string> = {
  hook_zwak: "Opening pakt niet",
  boodschap_landt: "Boodschap landt",
  middenmoot: "Middenmoot",
  te_weinig_data: "Te weinig data",
};

export const VIDEO_DIAGNOSIS_EXPLAIN: Record<VideoDiagnosis, string> = {
  hook_zwak: "Minder dan de helft haalt 25% van de video. De eerste seconden houden geen aandacht vast — dat is een creatief probleem, geen biedprobleem.",
  boodschap_landt: "Een ruim deel kijkt tot 75% door. De video doet zijn werk; zoekt de conversie niet door, kijk dan naar targeting, aanbod of landingspagina.",
  middenmoot: "De kijkdiepte is niet slecht en niet sterk. Ruimte om de opening te testen tegen een variant.",
  te_weinig_data: "Nog te weinig vertoningen om de kijkdiepte betrouwbaar te duiden.",
};
