// Video, placements en de PMax-netwerkverdeling als signaalverhalen.
//
// Waarom deze module bestaat: de analyses eronder waren gebouwd als losse schermen. Je zag "Opening
// pakt niet" of "3 placements kostten €710", maar er gebeurde niets mee — geen hypothese, geen taak,
// geen sprintitem. Een dashboard dat iets constateert en het daarbij laat, verplaatst het werk naar
// het hoofd van de lezer.
//
// Hier worden diezelfde uitkomsten vertaald naar het gedeelde signaalframe, zodat ze door dezelfde
// molen gaan als de andere bevindingen: renderen in de SOP-sectie én als voorstel in de wachtrij.
// De analyse zelf verandert niet; alleen de doorgifte komt erbij.

import { type DetectionResult, type SignalStory, type SignalEvidence } from "./types";
import { diagnoseVideo, VIDEO_DIAGNOSIS_EXPLAIN, type VideoCampaignAgg } from "@/lib/video/video-performance";
import { type PlacementJudgement } from "@/lib/video/placement-analysis";
import { findImbalances, type NetworkSlice } from "@/lib/pmax/network-split";

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const eur2 = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v);
const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));
const ev = (metric: string, value: string, prev?: string): SignalEvidence => ({ metric, value, prev });

/** Minimale verspilling voordat een uitsluit-voorstel de wachtrij waard is. */
export const PLACEMENT_WASTE_MIN_TOTAL = 50;

/**
 * Kijkdiepte-signalen: waar de video zijn publiek verliest. Alleen de uitgesproken uitkomsten
 * worden een verhaal — "middenmoot" en "te weinig data" horen niet in een actiewachtrij.
 */
export function buildVideoDepthSignals(aggs: VideoCampaignAgg[]): DetectionResult {
  const id = "video_kijkdiepte";
  const triggered: SignalStory[] = [];

  for (const a of aggs) {
    const d = diagnoseVideo(a);
    if (d !== "hook_zwak") continue; // alleen het probleem is een actie; "landt goed" is bevestiging

    triggered.push({
      id: `video_hook_${a.campaignId}`,
      category: "creative",
      scope: `${a.campaignName} — video-opening`,
      story: `Van de kijkers van ${a.campaignName} haalt ${pct(a.p25)} het eerste kwart van de video, en ${pct(a.p75)} driekwart. ${VIDEO_DIAGNOSIS_EXPLAIN.hook_zwak}`,
      actionDirection: `test een nieuwe opening (eerste 5 seconden) tegen de huidige; dit is een creatief probleem, dus bieden of budget verhogen lost het niet op`,
      certainty: "bewezen_binnen_platform",
      evidence: [
        ev("kijkdiepte 25%", pct(a.p25)),
        ev("kijkdiepte 75%", pct(a.p75)),
        ev("vertoningen", int(a.impressions)),
        ev("kosten", eur(a.cost)),
        ...(a.cpv != null ? [ev("CPV", eur2(a.cpv))] : []),
      ],
    });
  }

  return { triggered, checked: [id] };
}

/**
 * Uitsluit-voorstellen voor placements. Bundelt tot één verhaal per bron in plaats van per
 * placement: twintig losse voorstellen voor twintig kanalen maakt de wachtrij onbruikbaar, terwijl
 * de handeling er één is (een uitsluitingslijst bijwerken).
 *
 * De twee bronnen blijven wél gescheiden, want ze verschillen in bewijskracht én in handeling:
 * bij video ken je de kosten en sluit je per campagne uit, bij Performance Max ken je alleen het
 * bereik en gaat uitsluiten accountbreed.
 */
export function buildPlacementWasteSignals(judgements: PlacementJudgement[]): DetectionResult {
  const id = "placement_verspilling";
  const triggered: SignalStory[] = [];

  const excluding = judgements.filter((j) => j.verdict === "uitsluiten");
  const withCost = excluding.filter((j) => j.agg.metricsComplete);
  const impressionsOnly = excluding.filter((j) => !j.agg.metricsComplete);

  const wasted = withCost.reduce((s, j) => s + j.agg.cost, 0);
  if (withCost.length > 0 && wasted >= PLACEMENT_WASTE_MIN_TOTAL) {
    const top = [...withCost].sort((a, b) => b.agg.cost - a.agg.cost).slice(0, 3);
    triggered.push({
      id: "placement_verspilling_video",
      category: "budget_pacing",
      scope: "YouTube-placements (videocampagnes)",
      story: `${withCost.length} placement${withCost.length === 1 ? "" : "s"} kostte${withCost.length === 1 ? "" : "n"} samen ${eur(wasted)} zonder één conversie, waaronder ${top.map((t) => t.agg.displayName || t.agg.placement).join(", ")}.`,
      actionDirection: `zet deze placements op de uitsluitingslijst van de videocampagnes; dat budget komt vrij voor de plekken die wél converteren`,
      certainty: "bewezen_binnen_platform",
      evidence: [
        ev("placements zonder conversie", String(withCost.length)),
        ev("verspild budget", eur(wasted)),
        ...top.map((t) => ev(t.agg.displayName || t.agg.placement, eur(t.agg.cost))),
      ],
    });
  }

  if (impressionsOnly.length > 0) {
    const reach = impressionsOnly.reduce((s, j) => s + j.agg.impressions, 0);
    const top = [...impressionsOnly].sort((a, b) => b.agg.impressions - a.agg.impressions).slice(0, 3);
    triggered.push({
      id: "placement_verspilling_pmax",
      category: "budget_pacing",
      scope: "Performance Max-placements",
      story: `${impressionsOnly.length} plaatsing${impressionsOnly.length === 1 ? "" : "en"} uit Performance Max met samen ${int(reach)} vertoningen hoort inhoudelijk niet bij de doelgroep (${top.map((t) => t.agg.displayName || t.agg.placement).join(", ")}). Google levert voor PMax geen kosten of conversies per placement, dus wat dit kost is niet vast te stellen.`,
      actionDirection: `beoordeel deze plaatsingen en zet ze zo nodig op de uitsluitingslijst op accountniveau — bij Performance Max kan dat niet per campagne`,
      // Zonder kosten en conversies is dit een oordeel op plaatsingssoort en bereik, geen bewijs.
      certainty: "indicatie",
      evidence: [
        ev("plaatsingen", String(impressionsOnly.length)),
        ev("vertoningen", int(reach)),
        ev("kosten", "onbekend (PMax levert deze niet per placement)"),
        ...top.map((t) => ev(t.agg.displayName || t.agg.placement, `${int(t.agg.impressions)} vertoningen`)),
      ],
    });
  }

  return { triggered, checked: [id] };
}

/**
 * Scheefheid in de PMax-netwerkverdeling: een netwerk dat naar verhouding meer kost dan het
 * oplevert. Binnen PMax meet Google alles met hetzelfde model, dus kosten- en conversie-aandeel
 * zijn hier wél tegen elkaar af te zetten — anders dan over kanalen heen.
 */
export function buildPmaxNetworkSignals(slices: NetworkSlice[]): DetectionResult {
  const id = "pmax_netwerkverdeling";
  const triggered: SignalStory[] = [];

  for (const { slice, kind } of findImbalances(slices)) {
    if (kind !== "duur") continue; // een efficiënt netwerk is goed nieuws, geen actiepunt
    triggered.push({
      id: `pmax_netwerk_${slice.networkType}`,
      category: "budget_pacing",
      scope: `Performance Max — ${slice.label}`,
      story: `${slice.label} krijgt ${pct(slice.costShare)} van het PMax-budget maar levert ${pct(slice.conversionShare)} van de conversies${slice.cpa != null ? `, tegen een CPA van ${eur(slice.cpa)}` : ""}. Naar verhouding kost dit netwerk meer dan het oplevert.`,
      actionDirection: `de verdeling is niet rechtstreeks te sturen; bij te sturen via de assetmix (minder of andere beeld- en videoassets), scherpere doelgroepsignalen en placement-uitsluitingen`,
      certainty: "bewezen_binnen_platform",
      evidence: [
        ev(`${slice.label} kostenaandeel`, pct(slice.costShare)),
        ev(`${slice.label} conversie-aandeel`, pct(slice.conversionShare)),
        ev(`${slice.label} kosten`, eur(slice.cost)),
        ...(slice.cpa != null ? [ev(`${slice.label} CPA`, eur(slice.cpa))] : []),
      ],
    });
  }

  return { triggered, checked: [id] };
}
