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
  /**
   * Of kosten/klikken/conversies bekend zijn. Bij Performance Max levert Google alleen
   * vertoningen per placement. Ontbreekt deze vlag, dan gaan we uit van volledige cijfers
   * (de video-campagnes leveren die wel).
   */
  metricsComplete?: boolean;
  source?: "video" | "pmax";
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
  /** False zodra er PMax-bereik in zit: dan zijn kosten en conversies onvolledig. */
  metricsComplete: boolean;
  /** Vertoningen waarvoor geen kosten/conversies bekend zijn (de PMax-kant). */
  impressionsWithoutMetrics: number;
  sources: Array<"video" | "pmax">;
}

/** Minimale spend voordat een placement überhaupt de moeite van een oordeel waard is. */
export const MIN_SPEND_TO_JUDGE = 25;
/** Minimale views of klikken: zonder deze basis is "0 conversies" geen signaal maar ruis. */
export const MIN_VIEWS_TO_JUDGE = 500;
export const MIN_CLICKS_TO_JUDGE = 25;
/** Hoeveel duurder dan de mediaan-CPA een converterende placement mag zijn voordat hij opvalt. */
export const CPA_MULTIPLE_FOR_REVIEW = 2.5;
/**
 * Bereikdrempel voor placements waarvan alleen vertoningen bekend zijn (Performance Max).
 * Hoger dan de spend-drempel, want vertoningen zijn een zwakker signaal dan besteed budget.
 */
export const MIN_IMPRESSIONS_WITHOUT_METRICS = 5_000;

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
  const m = new Map<string, PlacementAgg & { campaignSet: Set<string>; sourceSet: Set<"video" | "pmax"> }>();
  for (const r of rows) {
    const key = r.placement || r.displayName;
    if (!key) continue;
    const a = m.get(key) ?? {
      placement: r.placement, displayName: r.displayName || r.placement,
      placementType: r.placementType, targetUrl: r.targetUrl,
      campaigns: [], campaignSet: new Set<string>(), sourceSet: new Set<"video" | "pmax">(),
      impressions: 0, clicks: 0, cost: 0, conversions: 0, videoViews: 0,
      cpm: null, cpv: null, cpa: null, viewRate: null,
      metricsComplete: true, impressionsWithoutMetrics: 0, sources: [],
    };
    if (r.displayName) a.displayName = r.displayName;
    if (r.campaignName) a.campaignSet.add(r.campaignName);
    a.sourceSet.add(r.source ?? "video");
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.cost += r.cost;
    a.conversions += r.conversions;
    a.videoViews += r.videoViews;
    // Eén rij zonder kosten/conversies maakt het totaal onvolledig: je mag dan geen CPA claimen
    // over bereik waarvan je de kosten niet kent.
    if (r.metricsComplete === false) {
      a.metricsComplete = false;
      a.impressionsWithoutMetrics += r.impressions;
    }
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
    // Ratio's alleen als de onderliggende cijfers compleet zijn; anders zouden ze een
    // PMax-placement goedkoper laten lijken dan hij is (kosten onbekend, niet nul).
    cpm: a.metricsComplete && a.impressions > 0 ? (a.cost / a.impressions) * 1000 : null,
    cpv: a.metricsComplete && a.videoViews > 0 ? a.cost / a.videoViews : null,
    cpa: a.metricsComplete && a.conversions > 0 ? a.cost / a.conversions : null,
    viewRate: a.metricsComplete && a.impressions > 0 ? a.videoViews / a.impressions : null,
    metricsComplete: a.metricsComplete,
    impressionsWithoutMetrics: a.impressionsWithoutMetrics,
    sources: [...a.sourceSet].sort(),
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
    // Performance Max: Google geeft alleen vertoningen per placement. Een kosten- of CPA-oordeel
    // is hier onmogelijk — dat zou een claim zijn over cijfers die niemand heeft. Wat wél kan is
    // een plaatsing herkennen die er inhoudelijk niet thuishoort en materieel bereik krijgt.
    if (!agg.metricsComplete) {
      if (agg.impressions < MIN_IMPRESSIONS_WITHOUT_METRICS) {
        return {
          agg,
          verdict: "te_weinig_data" as const,
          reason: `Alleen vertoningen bekend (Performance Max levert geen kosten of conversies per placement) en met ${int(agg.impressions)} vertoningen te weinig bereik om iets te vinden.`,
        };
      }
      if (isAppPlacement(agg.placementType)) {
        return {
          agg,
          verdict: "uitsluiten" as const,
          reason: `App-plaatsing met ${int(agg.impressions)} vertoningen vanuit Performance Max. Kosten en conversies geeft Google hier niet, dus dit oordeel gaat op plaatsingssoort en bereik — apps leveren zelden zakelijke aanvragen. Uitsluiten kan alleen accountbreed.`,
        };
      }
      return {
        agg,
        verdict: "bekijken" as const,
        reason: `${int(agg.impressions)} vertoningen vanuit Performance Max, maar Google levert daar geen kosten of conversies per placement. Beoordeel zelf of deze plek bij je doelgroep past; harde cijfers zijn er niet.`,
      };
    }

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
