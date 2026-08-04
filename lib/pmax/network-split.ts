// De netwerkverdeling binnen Performance Max: waar gaat het budget heen, en waar komen de
// conversies vandaan.
//
// "PMax is een black box" stond hier, en dat is achterhaald. Google verdeelt het budget nog steeds
// zélf over Zoeken, Zoekpartners, Display, YouTube, Maps, Discover en Gmail -- die verdeling is
// geen knop -- maar hij RAPPORTEERT hem inmiddels wel, met kosten en conversies per kanaal. Deze
// module bestaat bij de gratie van die rapportage.
//
// Het onderscheid dat telt is dus niet zichtbaar-versus-onzichtbaar maar stuurbaar-versus-meetbaar.
// De verdeling is meetbaar en niet stuurbaar, en juist daarom hoort ze op het scherm: als een
// derde van je budget naar Maps gaat en daar een tiende van de conversies vandaan komt, kun je dat
// niet met een schuifje rechtzetten, maar wel met assets, signalen en uitsluitingen. Zonder dit
// blok zie je de scheefheid niet en stuur je dus nergens op.
//
// Nagekeken augustus 2026 tegen Google's eigen aankondiging van de PMax-updates voor 2026; die
// noemt kanaalrapportage, budgetprojectie, demografie en placementrapportage als nieuw, en géén
// knop voor de verdeling.
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

// Google's ad_network_type-waarden in het Nederlands, in de termen van het "Where your conversions
// come from"-rapport in de interface. Onbekende waarden houden hun eigen naam, zodat een nieuw
// netwerk zichtbaar blijft in plaats van stilletjes onder "overig" te verdwijnen.
//
// SINDS API v23 (januari 2026) is deze lijst langer geworden, en dat is geen detail: waar PMax
// eerder alles buiten Zoeken op MIXED gooide, komen Maps, Discover en Gmail er nu apart uit. In
// echte accounts is Maps regelmatig de grootste kostenpost van de campagne. Stond die hier niet,
// dan verscheen de grootste taartpunt als de kale enum-naam "MAPS".
//
// Let op de historie in de data: kanaaldata bestaat pas vanaf 1 juni 2025, en oudere maanden
// blijven MIXED. GOOGLE_OWNED_CHANNELS is de verzamelnaam van vóór de opsplitsing en komt alleen
// nog in historische rijen voor.
const NETWORK_LABEL: Record<string, string> = {
  SEARCH: "Zoeken",
  SEARCH_PARTNERS: "Zoekpartners",
  CONTENT: "Display",
  YOUTUBE: "YouTube",
  MAPS: "Maps",
  DISCOVER: "Discover",
  GMAIL: "Gmail",
  GOOGLE_TV: "Google TV",
  GOOGLE_OWNED_CHANNELS: "Google-eigen kanalen",
  MIXED: "Cross-network",
  // Oudere waarden uit de tijd vóór v23; blijven staan voor historische rijen.
  YOUTUBE_WATCH: "YouTube",
  YOUTUBE_SEARCH: "YouTube (zoeken)",
  UNSPECIFIED: "Onbekend",
  UNKNOWN: "Onbekend",
};

export function networkLabel(t: string): string {
  return NETWORK_LABEL[(t || "").toUpperCase()] ?? t;
}

// ── Intentie versus bereik ─────────────────────────────────────────────────
// Meerdere analyses vragen "hoeveel van het PMax-budget gaat naar inventaris waar niemand actief
// naar je zoekt". Die tweedeling stond op drie plekken uitgeschreven als CONTENT + YOUTUBE_WATCH,
// en dat is sinds v23 stilletjes fout: YouTube heet nu YOUTUBE, en Maps, Discover en Gmail komen
// er als eigen kanalen bij. Een account waar een derde van het budget naar Maps gaat zou zo op
// nul procent bereikinventaris uitkomen. Daarom staat de tweedeling nu één keer hier.

const INTENT_NETWORKS = new Set(["SEARCH", "SEARCH_PARTNERS"]);
// Geen van beide: deze dragen geen kanaalinformatie, dus ze horen aan geen van beide kanten.
const UNATTRIBUTED_NETWORKS = new Set(["MIXED", "UNSPECIFIED", "UNKNOWN", "GOOGLE_OWNED_CHANNELS"]);

/** Zoekt de gebruiker actief? Zoeken en zoekpartners wel, de rest niet. */
export function isIntentNetwork(t: string): boolean {
  return INTENT_NETWORKS.has((t || "").toUpperCase());
}

/**
 * Bereikinventaris: Display, YouTube, Maps, Discover, Gmail, Google TV. Maps zit hier bewust bij —
 * iemand die een route zoekt heeft wel intentie, maar niet naar jouw aanbod, en in PMax gedraagt
 * het zich als bereik. MIXED en de verzamelwaarden vallen buiten beide: die zeggen niet wáár het
 * geld heen ging, en meetellen zou een uitspraak doen die de data niet draagt.
 */
export function isBrowseNetwork(t: string): boolean {
  const u = (t || "").toUpperCase();
  return !INTENT_NETWORKS.has(u) && !UNATTRIBUTED_NETWORKS.has(u) && u.length > 0;
}

/**
 * Een netwerk moet dit deel van de kosten dragen voordat de scheefheid iets betekent. Onder deze
 * grens is een verschil tussen twee aandelen vooral afrondingsruis.
 */
export const MIN_COST_SHARE_TO_FLAG = 0.10;
/** Vanaf dit verschil tussen kosten- en conversie-aandeel is de scheefheid het benoemen waard. */
export const SHARE_GAP_THRESHOLD = 0.15;

/** Sommeer per netwerk en leid de aandelen af uit de totalen. */
/**
 * De verdeling van kosten en conversies over een dimensie, met per segment het aandeel, de CPA
 * en het verschil tussen beide aandelen.
 *
 * De rekenkern is niet Google-specifiek — "welk segment kost naar verhouding meer dan het
 * oplevert" is dezelfde vraag voor een PMax-netwerk, een Meta-plaatsing of een LinkedIn-functie.
 * Alleen het benoemen en normaliseren van de sleutel verschilt, en dat gaat via de opties. Zonder
 * die opening zou de kanaalweergave deze dertig regels moeten overschrijven, inclusief de
 * subtiliteiten (nul-segmenten eruit, conversie-aandeel null zolang er nergens conversies zijn).
 *
 * @param opties labelOf vertaalt de sleutel naar een leesbare naam; normalizeKey bepaalt wanneer
 *               twee rijen hetzelfde segment zijn. Standaard: Google's netwerknamen en hoofdletters.
 */
export function buildNetworkSplit(
  rows: NetworkRow[],
  opties?: { labelOf?: (key: string) => string; normalizeKey?: (key: string) => string }
): NetworkSlice[] {
  const labelOf = opties?.labelOf ?? networkLabel;
  const normalizeKey = opties?.normalizeKey ?? ((k: string) => (k || "UNKNOWN").toUpperCase());
  const m = new Map<string, NetworkRow>();
  for (const r of rows) {
    const key = normalizeKey(r.networkType);
    const a = m.get(key) ?? { networkType: key, cost: 0, conversions: 0, conversionsValue: 0, impressions: 0, clicks: 0 };
    a.cost += r.cost;
    a.conversions += r.conversions;
    a.conversionsValue += r.conversionsValue;
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    m.set(key, a);
  }

  // Netwerken zonder enige activiteit vallen af. Sinds v23 rapporteert Google elk kanaal apart,
  // ook de kanalen waar niets gebeurde: in veel accounts staat Gmail op precies nul kosten, nul
  // vertoningen en nul conversies. Zo'n segment is onzichtbaar in de ring maar kost wel een
  // legenda-regel en een kleur uit het palet, waardoor de kanalen die er wél toe doen opschuiven
  // naar minder onderscheidbare kleuren. Een netwerk met nul kosten maar wél vertoningen blijft
  // staan — dat is gratis bereik, en dat is informatie.
  const all = [...m.values()].filter((r) => r.cost > 0 || r.impressions > 0 || r.conversions > 0);
  const totalCost = all.reduce((s, r) => s + r.cost, 0);
  const totalConv = all.reduce((s, r) => s + r.conversions, 0);

  return all
    .map((r) => {
      const costShare = totalCost > 0 ? r.cost / totalCost : 0;
      const conversionShare = totalConv > 0 ? r.conversions / totalConv : null;
      return {
        networkType: r.networkType,
        label: labelOf(r.networkType),
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
