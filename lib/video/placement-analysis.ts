// Welke YouTube-placements zijn kandidaat om uit te sluiten.
//
// Bij YouTube bepaalt Google waar je advertentie landt, en dat is precies waar budget weglekt:
// kinder-apps waar per ongeluk geklikt wordt, auto-play-kanalen die niemand actief kijkt, content
// die niets met de doelgroep te maken heeft. Op campagneniveau zie je dat niet — het verdwijnt in
// het gemiddelde. Op placementniveau wel.
//
// De verleiding is om alles zonder conversies uit te sluiten. Dat is fout: verreweg de meeste
// placements zijn klein, en "0 conversies" op 40 vertoningen is geen bewijs maar ruis. Uitsluiten
// op basis daarvan gooit bereik weg dat prima werkte. Daarom telt hier hetzelfde principe als bij
// de verzadigingsdetectie: pas een oordeel als er genoeg volume onder ligt om het te dragen.
//
// De uitkomst is bewust een VOORSTEL, geen automatische actie. Uitsluiten is moeilijk terug te
// draaien in zijn effect (je verliest de leerdata van die placement), dus de mens beslist.

export interface PlacementInput {
  placement: string;
  displayName: string;
  placementType: string;
  targetUrl: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  videoViews: number;
}

export interface PlacementAgg {
  placement: string;
  displayName: string;
  placementType: string;
  targetUrl: string;
  campaigns: string[];
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  videoViews: number;
  cpm: number | null;
  cpv: number | null;
  cpa: number | null;
  viewRate: number | null;
}

/** Minimale spend voordat een placement überhaupt de moeite van een oordeel waard is. */
export const MIN_SPEND_TO_JUDGE = 25;
/** Minimale views of klikken: zonder deze basis is "0 conversies" geen signaal maar ruis. */
export const MIN_VIEWS_TO_JUDGE = 500;
export const MIN_CLICKS_TO_JUDGE = 25;
/** Hoeveel duurder dan de mediaan-CPA een converterende placement mag zijn voordat hij opvalt. */
export const CPA_MULTIPLE_FOR_REVIEW = 2.5;

export type PlacementVerdict = "uitsluiten" | "bekijken" | "houden" | "te_weinig_data";

export interface PlacementJudgement {
  agg: PlacementAgg;
  verdict: PlacementVerdict;
  /** Waarom, in één zin — zodat de aanbeveling navolgbaar is en niet als orakel aankomt. */
  reason: string;
}

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);

/** Apps zijn bij video-/displaycampagnes de klassieke budgetlek: veel klikken, zelden intentie. */
export function isAppPlacement(placementType: string): boolean {
  return placementType.toUpperCase().startsWith("MOBILE_APP");
}

export const PLACEMENT_TYPE_LABEL: Record<string, string> = {
  YOUTUBE_CHANNEL: "YouTube-kanaal",
  YOUTUBE_VIDEO: "YouTube-video",
  MOBILE_APPLICATION: "Mobiele app",
  MOBILE_APP_CATEGORY: "App-categorie",
  WEBSITE: "Website",
  MIXED: "Gemengd",
  UNKNOWN: "Onbekend",
};

export function placementTypeLabel(t: string): string {
  return PLACEMENT_TYPE_LABEL[t.toUpperCase()] ?? t;
}

/** Sommeer per placement; ratio's uit de totalen. */
export function aggregatePlacements(rows: PlacementInput[]): PlacementAgg[] {
  const m = new Map<string, PlacementAgg & { campaignSet: Set<string> }>();
  for (const r of rows) {
    const key = r.placement || r.displayName;
    if (!key) continue;
    const a = m.get(key) ?? {
      placement: r.placement, displayName: r.displayName || r.placement,
      placementType: r.placementType, targetUrl: r.targetUrl,
      campaigns: [], campaignSet: new Set<string>(),
      impressions: 0, clicks: 0, cost: 0, conversions: 0, videoViews: 0,
      cpm: null, cpv: null, cpa: null, viewRate: null,
    };
    if (r.displayName) a.displayName = r.displayName;
    if (r.campaignName) a.campaignSet.add(r.campaignName);
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.cost += r.cost;
    a.conversions += r.conversions;
    a.videoViews += r.videoViews;
    m.set(key, a);
  }
  return [...m.values()].map((a) => ({
    placement: a.placement,
    displayName: a.displayName,
    placementType: a.placementType,
    targetUrl: a.targetUrl,
    campaigns: [...a.campaignSet].sort(),
    impressions: a.impressions,
    clicks: a.clicks,
    cost: a.cost,
    conversions: a.conversions,
    videoViews: a.videoViews,
    cpm: a.impressions > 0 ? (a.cost / a.impressions) * 1000 : null,
    cpv: a.videoViews > 0 ? a.cost / a.videoViews : null,
    cpa: a.conversions > 0 ? a.cost / a.conversions : null,
    viewRate: a.impressions > 0 ? a.videoViews / a.impressions : null,
  }));
}

/** Mediane CPA over de placements die wél converteren — de eigen maatstaf van het account. */
export function medianCpa(aggs: PlacementAgg[]): number | null {
  const cpas = aggs.map((a) => a.cpa).filter((v): v is number => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (cpas.length === 0) return null;
  const mid = Math.floor(cpas.length / 2);
  return cpas.length % 2 === 0 ? (cpas[mid - 1] + cpas[mid]) / 2 : cpas[mid];
}

/**
 * Beoordeelt elke placement. Geeft bewust "te_weinig_data" zolang de basis te dun is: liever geen
 * aanbeveling dan een uitsluiting op toeval, want weggegooid bereik komt niet vanzelf terug.
 */
export function judgePlacements(aggs: PlacementAgg[]): PlacementJudgement[] {
  const median = medianCpa(aggs);

  return aggs.map((agg) => {
    const enoughBase = agg.videoViews >= MIN_VIEWS_TO_JUDGE || agg.clicks >= MIN_CLICKS_TO_JUDGE;
    if (agg.cost < MIN_SPEND_TO_JUDGE || !enoughBase) {
      return {
        agg,
        verdict: "te_weinig_data" as const,
        reason: `Te weinig volume (${eur(agg.cost)}, ${int(agg.videoViews)} views) om iets te kunnen zeggen.`,
      };
    }

    if (agg.conversions === 0) {
      const app = isAppPlacement(agg.placementType);
      return {
        agg,
        verdict: "uitsluiten" as const,
        reason: app
          ? `App-plaatsing kostte ${eur(agg.cost)} over ${int(agg.clicks)} klikken zonder één conversie. Klikken in apps zijn vaak onbedoeld; dit is zelden je doelgroep.`
          : `Kostte ${eur(agg.cost)} over ${int(agg.videoViews)} views en ${int(agg.clicks)} klikken zonder één conversie.`,
      };
    }

    if (median != null && agg.cpa != null && agg.cpa > median * CPA_MULTIPLE_FOR_REVIEW) {
      return {
        agg,
        verdict: "bekijken" as const,
        reason: `Converteert wél, maar tegen ${eur(agg.cpa)} per conversie — ruim boven de mediaan van ${eur(median)} over je placements.`,
      };
    }

    return { agg, verdict: "houden" as const, reason: `Presteert binnen de bandbreedte van je overige placements.` };
  });
}

/** Wat het zou schelen als je alle uitsluit-kandidaten daadwerkelijk uitsluit. */
export function wastedSpend(judgements: PlacementJudgement[]): number {
  return judgements.filter((j) => j.verdict === "uitsluiten").reduce((s, j) => s + j.agg.cost, 0);
}
