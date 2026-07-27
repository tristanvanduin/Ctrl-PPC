// De netwerkverdeling binnen Performance Max: waar gaat het budget heen, en waar komen de
// conversies vandaan.
//
// PMax is voor de adverteerder een black box — Google verdeelt het budget zelf over Zoeken,
// Display, YouTube, Discover en Gmail. Die verdeling wordt wél gesynct maar bereikte tot nu toe
// alleen de AI-lagen, nooit het scherm. Terwijl juist híer de scheefheid zichtbaar wordt: als 40%
// van je budget naar Display gaat en daar 5% van de conversies vandaan komt, is dat het gesprek.
//
// Vandaar dat kosten en conversies naast elkaar staan en niet los: het aandeel op zichzelf zegt
// weinig, het verschil tussen de twee aandelen is het signaal.

export interface NetworkRow {
  networkType: string;
  cost: number;
  conversions: number;
  conversionsValue: number;
  impressions: number;
  clicks: number;
}

export interface NetworkSlice {
  networkType: string;
  label: string;
  cost: number;
  conversions: number;
  conversionsValue: number;
  impressions: number;
  clicks: number;
  /** Aandeel in de totale kosten (0-1). */
  costShare: number;
  /** Aandeel in de totale conversies (0-1); null als er nergens conversies zijn. */
  conversionShare: number | null;
  /** Kosten per conversie binnen dit netwerk; null zonder conversies. */
  cpa: number | null;
  /**
   * Kostenaandeel min conversie-aandeel. Positief = dit netwerk kost naar verhouding méér dan het
   * oplevert. Null zolang er geen conversies zijn om tegen af te zetten.
   */
  shareGap: number | null;
}

// Google's ad_network_type-waarden, in het Nederlands. Onbekende waarden houden hun eigen naam,
// zodat een nieuw netwerk zichtbaar blijft in plaats van stilletjes onder "overig" te verdwijnen.
const NETWORK_LABEL: Record<string, string> = {
  SEARCH: "Zoeken",
  SEARCH_PARTNERS: "Zoekpartners",
  CONTENT: "Display",
  YOUTUBE_WATCH: "YouTube",
  YOUTUBE_SEARCH: "YouTube (zoeken)",
  YOUTUBE: "YouTube",
  MIXED: "Gemengd",
  UNSPECIFIED: "Onbekend",
  UNKNOWN: "Onbekend",
};

export function networkLabel(t: string): string {
  return NETWORK_LABEL[(t || "").toUpperCase()] ?? t;
}

/**
 * Een netwerk moet dit deel van de kosten dragen voordat de scheefheid iets betekent. Onder deze
 * grens is een verschil tussen twee aandelen vooral afrondingsruis.
 */
export const MIN_COST_SHARE_TO_FLAG = 0.10;
/** Vanaf dit verschil tussen kosten- en conversie-aandeel is de scheefheid het benoemen waard. */
export const SHARE_GAP_THRESHOLD = 0.15;

/** Sommeer per netwerk en leid de aandelen af uit de totalen. */
export function buildNetworkSplit(rows: NetworkRow[]): NetworkSlice[] {
  const m = new Map<string, NetworkRow>();
  for (const r of rows) {
    const key = (r.networkType || "UNKNOWN").toUpperCase();
    const a = m.get(key) ?? { networkType: key, cost: 0, conversions: 0, conversionsValue: 0, impressions: 0, clicks: 0 };
    a.cost += r.cost;
    a.conversions += r.conversions;
    a.conversionsValue += r.conversionsValue;
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    m.set(key, a);
  }

  const all = [...m.values()];
  const totalCost = all.reduce((s, r) => s + r.cost, 0);
  const totalConv = all.reduce((s, r) => s + r.conversions, 0);

  return all
    .map((r) => {
      const costShare = totalCost > 0 ? r.cost / totalCost : 0;
      const conversionShare = totalConv > 0 ? r.conversions / totalConv : null;
      return {
        networkType: r.networkType,
        label: networkLabel(r.networkType),
        cost: r.cost,
        conversions: r.conversions,
        conversionsValue: r.conversionsValue,
        impressions: r.impressions,
        clicks: r.clicks,
        costShare,
        conversionShare,
        cpa: r.conversions > 0 ? r.cost / r.conversions : null,
        shareGap: conversionShare == null ? null : costShare - conversionShare,
      };
    })
    // Grootste kostenpost eerst: de donut leest dan met de klok mee van groot naar klein.
    .sort((a, b) => b.cost - a.cost);
}

export interface NetworkImbalance {
  slice: NetworkSlice;
  /** "duur" = kost meer dan het oplevert; "efficiënt" = levert meer dan het kost. */
  kind: "duur" | "efficient";
}

/**
 * De netwerken waar kosten- en conversie-aandeel materieel uiteenlopen. Bewust stil bij kleine
 * netwerken en bij accounts zonder conversies: een scheefheid van 20% op 3% van het budget is
 * geen bevinding, en zonder conversies valt er niets tegen af te zetten.
 */
export function findImbalances(slices: NetworkSlice[]): NetworkImbalance[] {
  const out: NetworkImbalance[] = [];
  for (const s of slices) {
    if (s.shareGap == null) continue;
    if (s.costShare < MIN_COST_SHARE_TO_FLAG) continue;
    if (s.shareGap >= SHARE_GAP_THRESHOLD) out.push({ slice: s, kind: "duur" });
    else if (s.shareGap <= -SHARE_GAP_THRESHOLD) out.push({ slice: s, kind: "efficient" });
  }
  return out.sort((a, b) => Math.abs(b.slice.shareGap!) - Math.abs(a.slice.shareGap!));
}

/** Totalen voor het midden van de donut. */
export function networkTotals(slices: NetworkSlice[]) {
  return {
    cost: slices.reduce((s, r) => s + r.cost, 0),
    conversions: slices.reduce((s, r) => s + r.conversions, 0),
    hasConversions: slices.some((r) => r.conversions > 0),
  };
}
