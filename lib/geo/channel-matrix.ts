// Land × kanaal: hoe de kanaalmix per markt verschilt.
//
// HET PROBLEEM DAT DIT OPLOST
//
// De kanaalverdeling (Zoeken / Display / YouTube) en de landverdeling bestonden allebei al, maar
// nooit in dezelfde rij. Je kon zien dát YouTube een derde van het budget kost en dát Frankrijk
// niet converteert, maar niet of die twee iets met elkaar te maken hebben.
//
// WAAROM DIT GEEN NIEUWE SYNC NODIG HEEFT
//
// Voor Zoeken, Display en Video is één campagne één kanaal. Land × campagne stond al in
// ads_geo_performance_monthly, en het campagnetype in ads_campaign_metadata; de doorsnede is dus
// een join, geen nieuwe API-call.
//
// WAAR HET WÉL BREEKT — EN WAAROM WE DAT NIET GLADSTRIJKEN
//
// Bij Performance Max spant één campagne alle kanalen tegelijk. Google levert de kanaalverdeling
// per asset group (ads_pmax_network_breakdown) en de landverdeling per campagne, maar nergens de
// twee samen. Die doorsnede is dus niet gemeten.
//
// De verleiding is om PMax-spend per land te verdelen volgens de accountbrede kanaalmix. Dat doen
// we niet. Het resultaat zou een model zijn dat er precies uitziet als een meting, en een lezer
// kan het verschil niet zien. PMax krijgt daarom een eigen kanaal ("pmax_onverdeeld") met een
// eigen kolom: het budget is bekend, de kanaaltoewijzing niet. Hetzelfde principe als de
// metrics_complete-vlag op PMax-plaatsingen.

export type ChannelKey = "search" | "display" | "video" | "shopping" | "pmax_onverdeeld" | "overig";

export interface ChannelCell {
  country: string;
  channel: ChannelKey;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

/** Hoe we het kanaal van een rij weten. Ontbreekt dit, dan is het geraden — en dat tonen we niet. */
export type ChannelSource = "campaign_type" | "pmax_unsplit";

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  search: "Zoeken",
  display: "Display",
  video: "Video",
  shopping: "Shopping",
  pmax_onverdeeld: "PMax (onverdeeld)",
  overig: "Overig",
};

/**
 * Vaste kolomvolgorde. Niet op grootte sorteren: een matrix waarvan de kolommen per klant of per
 * periode verspringen is niet te vergelijken, en de lezer moet elke keer opnieuw zoeken.
 */
export const CHANNEL_ORDER: ChannelKey[] = ["search", "display", "video", "shopping", "pmax_onverdeeld", "overig"];

/** Google's advertising_channel_type naar ons kanaalbegrip. */
export function channelFromCampaignType(campaignType: string | null | undefined): ChannelKey {
  switch ((campaignType || "").toUpperCase()) {
    case "SEARCH": return "search";
    case "DISPLAY": return "display";
    case "VIDEO": return "video";
    case "SHOPPING": return "shopping";
    case "PERFORMANCE_MAX": return "pmax_onverdeeld";
    case "DEMAND_GEN":
    case "DISCOVERY": return "display"; // Discover/Gmail vallen bij Google onder hetzelfde net
    default: return "overig";
  }
}

/** Een kanaal waarvan we de kosten kennen maar de kanaaltoewijzing niet. */
export const isUnsplit = (c: ChannelKey): boolean => c === "pmax_onverdeeld";

// ── Aggregatie ─────────────────────────────────────────────────────────────

export interface GeoCampaignRow {
  countryCode: string | null;
  campaignId: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

const emptyCell = (country: string, channel: ChannelKey): ChannelCell => ({
  country, channel, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0,
});

/**
 * Voegt land×campagne-rijen samen tot land×kanaal, met het campagnetype als brug. Rijen zonder
 * land of zonder bekende campagne vallen weg: een cel die niet aan een markt hangt hoort niet in
 * een landmatrix, en meetellen onder "overig" zou het totaal laten kloppen ten koste van de
 * betekenis.
 */
export function buildChannelMatrix(
  rows: GeoCampaignRow[],
  campaignTypeById: Map<string, string>
): ChannelCell[] {
  const cells = new Map<string, ChannelCell>();
  for (const r of rows) {
    const country = (r.countryCode || "").toUpperCase();
    if (!country || !r.campaignId) continue;
    const type = campaignTypeById.get(r.campaignId);
    if (!type) continue;
    const channel = channelFromCampaignType(type);
    const key = `${country}|${channel}`;
    const c = cells.get(key) ?? emptyCell(country, channel);
    c.impressions += r.impressions; c.clicks += r.clicks; c.cost += r.cost;
    c.conversions += r.conversions; c.conversionsValue += r.conversionsValue;
    cells.set(key, c);
  }
  return [...cells.values()];
}

// ── Afgeleide waarden ──────────────────────────────────────────────────────
// Altijd uit de totalen van de cel zelf. Nooit een gemiddelde van ratio's: het gemiddelde van
// vier CPA's weegt een land met 2 conversies even zwaar als een land met 200.

export const cpa = (c: ChannelCell): number | null => (c.conversions > 0 ? c.cost / c.conversions : null);
export const roas = (c: ChannelCell): number | null => (c.cost > 0 ? c.conversionsValue / c.cost : null);
export const cvr = (c: ChannelCell): number | null => (c.clicks > 0 ? c.conversions / c.clicks : null);
export const ctr = (c: ChannelCell): number | null => (c.impressions > 0 ? c.clicks / c.impressions : null);
export const cpc = (c: ChannelCell): number | null => (c.clicks > 0 ? c.cost / c.clicks : null);

export interface MatrixTotals {
  countries: string[];
  channels: ChannelKey[];
  byCountry: Map<string, ChannelCell>;
  byChannel: Map<ChannelKey, ChannelCell>;
  grand: ChannelCell;
}

const addInto = (a: ChannelCell, b: ChannelCell): ChannelCell => ({
  country: a.country, channel: a.channel,
  impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks,
  cost: a.cost + b.cost, conversions: a.conversions + b.conversions,
  conversionsValue: a.conversionsValue + b.conversionsValue,
});

/**
 * Randtotalen. Landen op kosten aflopend (dat is de volgorde waarin je ze wilt lezen), kanalen in
 * de vaste kolomvolgorde — en alleen de kanalen die daadwerkelijk voorkomen, zodat een account
 * zonder video geen lege kolom krijgt.
 */
export function matrixTotals(cells: ChannelCell[]): MatrixTotals {
  const byCountry = new Map<string, ChannelCell>();
  const byChannel = new Map<ChannelKey, ChannelCell>();
  let grand = emptyCell("*", "overig");
  for (const c of cells) {
    byCountry.set(c.country, addInto(byCountry.get(c.country) ?? emptyCell(c.country, "overig"), c));
    byChannel.set(c.channel, addInto(byChannel.get(c.channel) ?? emptyCell("*", c.channel), c));
    grand = addInto(grand, c);
  }
  const countries = [...byCountry.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k]) => k);
  const channels = CHANNEL_ORDER.filter((k) => byChannel.has(k));
  return { countries, channels, byCountry, byChannel, grand };
}

/** Snelle opzoek per (land, kanaal); ontbrekende combinaties zijn echt afwezig, niet nul. */
export function cellIndex(cells: ChannelCell[]): Map<string, ChannelCell> {
  return new Map(cells.map((c) => [`${c.country}|${c.channel}`, c]));
}

// ── Afwijkingsdetectie ─────────────────────────────────────────────────────
// De vraag achter de matrix is niet "wat zijn de cijfers" maar "waar wijkt een markt af van hoe
// dit account normaal presteert". Dat is een vergelijking van de kanaalmix van één land met de
// mix van het account als geheel.

/** Onder dit budget is een afwijking in de mix vooral ruis. */
export const MIN_COUNTRY_COST = 250;
/** Zoveel procentpunt verschil in kostenaandeel voordat een markt echt anders ligt. */
export const MIX_GAP_THRESHOLD = 0.15;

export interface MixDeviation {
  country: string;
  channel: ChannelKey;
  countryShare: number;
  accountShare: number;
  gap: number; // positief = dit land leunt zwaarder op dit kanaal dan het account
}

/**
 * Landen waarvan het kostenaandeel per kanaal materieel afwijkt van het accountgemiddelde.
 * Onverdeelde PMax telt mee in de noemer (het is echt budget) maar wordt zelf niet gemeld: dat
 * een land veel PMax draait is een structuurkeuze, geen bevinding.
 */
export function findMixDeviations(cells: ChannelCell[]): MixDeviation[] {
  const t = matrixTotals(cells);
  if (t.grand.cost <= 0) return [];
  const index = cellIndex(cells);
  const out: MixDeviation[] = [];
  for (const country of t.countries) {
    const countryTotal = t.byCountry.get(country)!;
    if (countryTotal.cost < MIN_COUNTRY_COST) continue;
    for (const channel of t.channels) {
      if (isUnsplit(channel)) continue;
      const cell = index.get(`${country}|${channel}`);
      const countryShare = (cell?.cost ?? 0) / countryTotal.cost;
      const accountShare = (t.byChannel.get(channel)?.cost ?? 0) / t.grand.cost;
      const gap = countryShare - accountShare;
      if (Math.abs(gap) >= MIX_GAP_THRESHOLD) {
        out.push({ country, channel, countryShare, accountShare, gap });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/**
 * Per markt alleen de sterkste afwijking. Een markt die structureel anders in elkaar zit wijkt op
 * álle kanalen tegelijk af — Frankrijk zonder zoekcampagne scoort automatisch ook hoog op video en
 * display, want die aandelen moeten samen op honderd uitkomen. Zonder deze stap vult één markt de
 * hele lijst en komt de tweede markt nooit in beeld, terwijl de derde regel over Frankrijk niets
 * toevoegt aan de eerste.
 */
export function strongestPerCountry(deviations: MixDeviation[]): MixDeviation[] {
  const best = new Map<string, MixDeviation>();
  for (const d of deviations) {
    const cur = best.get(d.country);
    if (!cur || Math.abs(d.gap) > Math.abs(cur.gap)) best.set(d.country, d);
  }
  return [...best.values()].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}
