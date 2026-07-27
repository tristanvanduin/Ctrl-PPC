// PMax en Video in de demo. Het account adverteert op Search, Display, Video en Performance Max —
// géén Shopping, want een vakbeurs verkoopt geen producten via deze kanalen. PMax draait hier dus
// zónder feed: asset groups met tekst, beeld en video, gestuurd op leads.
//
// WAAROM DIT ER MOEST KOMEN
//
// De analyse-kant hiervan stond er al: de video-diepteanalyse, de placement-uitsluitadviezen, de
// PMax-netwerkverdeling, de PMax-expertlaag en vijf controlepunten in de second opinion. Alleen had
// de demo geen enkele PMax- of videocampagne, dus al die schermen bleven leeg. Een functie die in
// de demo niets laat zien, bestaat voor wie de demo bekijkt niet.
//
// WAT DE DATA MOET DRAGEN
//
// PMax zonder feed heeft één karakteristieke faalvorm: het budget lekt weg naar Display en YouTube
// terwijl de conversies uit Search komen. Dat is precies wat de netwerkverdeling hier laat zien.
// Bij video is de faalvorm een zwakke hook — mensen klikken weg vóór de eerste vijf seconden om —
// en dat is af te lezen aan het eerste kwartiel. Beide zijn echte, herkenbare patronen; ze zijn
// hier ingebouwd omdat een account zonder één van beide de uitzondering is, niet de regel.
//
// Puur presentatie: alleen actief in demo-modus, nooit vermengd met echte data.

import { splitAlong, splitInt } from "./split";

type Row = Record<string, unknown>;

interface MonthTotals {
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

const totals = (r: Row): MonthTotals => ({
  month: String(r.month),
  impressions: Number(r.impressions ?? 0),
  clicks: Number(r.clicks ?? 0),
  cost: Number(r.cost ?? 0),
  conversions: Number(r.conversions ?? 0),
  conversions_value: Number(r.conversions_value ?? 0),
});

export const PMAX_CAMPAIGN = { id: "demo-c-pmax", name: "GreenTech | PMax | Standhouders" };
export const VIDEO_CAMPAIGN = { id: "demo-c-video", name: "GRT | Video | YouTube awareness" };

// ── Videometrieken ─────────────────────────────────────────────────────────
// De kwartielen zijn het hart hiervan. p25 = het aandeel vertoningen dat een kwart van de video
// haalde; onder de helft betekent dat de opening niet pakt. 0,42 zet de demo net onder die grens,
// zodat de diepteanalyse een zwakke hook meldt in plaats van een lege kaart. De rest van de trap
// (0,28 / 0,19 / 0,14) is normaal verval: wie eenmaal blijft hangen, kijkt meestal door.
const VIDEO_SHAPE = {
  viewRate: 0.28,
  quartiles: { p25: 0.42, p50: 0.28, p75: 0.19, p100: 0.14 },
};

/** Videovelden voor één campagnemaand; null-velden voor alles wat geen video is. */
export function videoMetricsFor(campaignType: string, impressions: number, cost: number) {
  const cpm = impressions > 0 ? (cost / impressions) * 1000 : 0;
  if (campaignType !== "VIDEO") {
    // avg_cpm rapporteert Google voor élk campagnetype; de rest alleen waar video speelt.
    return {
      avg_cpm: cpm, video_views: null, avg_cpv: null, video_view_rate: null,
      video_quartile_p25: null, video_quartile_p50: null, video_quartile_p75: null, video_quartile_p100: null,
    };
  }
  const views = Math.round(impressions * VIDEO_SHAPE.viewRate);
  return {
    avg_cpm: cpm,
    video_views: views,
    avg_cpv: views > 0 ? cost / views : 0,
    video_view_rate: VIDEO_SHAPE.viewRate,
    video_quartile_p25: VIDEO_SHAPE.quartiles.p25,
    video_quartile_p50: VIDEO_SHAPE.quartiles.p50,
    video_quartile_p75: VIDEO_SHAPE.quartiles.p75,
    video_quartile_p100: VIDEO_SHAPE.quartiles.p100,
  };
}

// ── Asset groups ───────────────────────────────────────────────────────────
// Drie groepen die de PMax-campagne exact verdelen. "Bezoekers — breed" is de budgetslurper:
// een derde van de kosten voor een tiende van de leads. Dat is het patroon achter controlepunt
// 47 (asset groups die budget absorberen zonder conversies) en het is bij PMax zonder feed de
// meest voorkomende: een brede groep zonder scherp signaal trekt het algoritme mee.

interface AssetGroupDef { id: string; name: string; costW: number; convW: number }

const ASSET_GROUPS: AssetGroupDef[] = [
  { id: "demo-ag-standhouders-nl", name: "Standhouders — Nederland", costW: 0.36, convW: 0.48 },
  { id: "demo-ag-standhouders-intl", name: "Standhouders — internationaal", costW: 0.32, convW: 0.41 },
  { id: "demo-ag-bezoekers-breed", name: "Bezoekers — breed", costW: 0.32, convW: 0.11 },
];

export function assetGroupRows(clientId: string, campaignMonthly: Row[], months: string[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  for (const raw of campaignMonthly) {
    if (raw.campaign_id !== PMAX_CAMPAIGN.id) continue;
    const t = totals(raw);
    if (!months.includes(t.month)) continue;
    const costW = ASSET_GROUPS.map((a) => a.costW);
    const convW = ASSET_GROUPS.map((a) => a.convW);
    const imp = splitInt(t.impressions, costW);
    const clk = splitInt(t.clicks, costW);
    const cost = splitInt(t.cost, costW);
    const conv = splitInt(t.conversions, convW);
    const val = splitAlong(t.conversions_value, conv, convW);
    ASSET_GROUPS.forEach((a, i) => {
      rows.push({
        client_id: clientId, month: t.month,
        campaign_id: PMAX_CAMPAIGN.id, campaign_name: PMAX_CAMPAIGN.name,
        asset_group_id: a.id, asset_group_name: a.name, asset_group_status: "ENABLED",
        impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i],
        conversions_value: val[i], synced_at: syncedAt,
      });
    });
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}

// ── Netwerkverdeling binnen PMax ───────────────────────────────────────────
// Het beeld waar controlepunt 46 naar vraagt. YouTube kost hier 38% van het budget en levert 19%
// van de leads; Search is omgekeerd. Dat is geen bug in PMax maar de bekende consequentie van
// sturen op één doel zonder feed: het algoritme koopt goedkoop bereik in waar dat te krijgen is.
// De analyse hoort dat te zien en er een budgetgesprek van te maken, niet een alarm.

const PMAX_NETWORKS: Array<{ type: string; costW: number; convW: number; impW: number }> = [
  { type: "SEARCH", costW: 0.34, convW: 0.62, impW: 0.12 },
  { type: "CONTENT", costW: 0.28, convW: 0.19, impW: 0.46 },
  { type: "YOUTUBE_WATCH", costW: 0.38, convW: 0.19, impW: 0.42 },
];

export function pmaxNetworkRows(clientId: string, assetGroupRowsIn: Row[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  for (const ag of assetGroupRowsIn) {
    const t = totals(ag);
    const imp = splitInt(t.impressions, PMAX_NETWORKS.map((n) => n.impW));
    const clk = splitInt(t.clicks, PMAX_NETWORKS.map((n) => n.costW));
    const cost = splitInt(t.cost, PMAX_NETWORKS.map((n) => n.costW));
    const conv = splitInt(t.conversions, PMAX_NETWORKS.map((n) => n.convW));
    const val = splitAlong(t.conversions_value, conv, PMAX_NETWORKS.map((n) => n.convW));
    PMAX_NETWORKS.forEach((n, i) => {
      rows.push({
        client_id: clientId, month: ag.month,
        campaign_id: ag.campaign_id, campaign_name: ag.campaign_name,
        asset_group_id: ag.asset_group_id, asset_group_name: ag.asset_group_name,
        network_type: n.type, impressions: imp[i], clicks: clk[i], cost: cost[i],
        conversions: conv[i], conversions_value: val[i], synced_at: syncedAt,
      });
    });
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}

// ── Assets binnen de asset groups ──────────────────────────────────────────
// Controlepunt 48 vraagt naar assetkwaliteit én type-dekking. "Bezoekers — breed" heeft daarom
// bewust géén video-asset: bij PMax betekent dat Google er zelf een genereert uit de overige
// assets, en dat is zelden de sterkste. Het is een concreet, uitvoerbaar gebrek — precies wat een
// aanbeveling nodig heeft.

interface AssetDef { group: string; type: string; text: string; label: string }

const ASSETS: AssetDef[] = [
  { group: "demo-ag-standhouders-nl", type: "TEXT", text: "Boek uw stand op GreenTech 2026", label: "BEST" },
  { group: "demo-ag-standhouders-nl", type: "TEXT", text: "Ontmoet 12.000 tuinbouwprofessionals", label: "GOOD" },
  { group: "demo-ag-standhouders-nl", type: "IMAGE", text: "Beursvloer overzicht", label: "GOOD" },
  { group: "demo-ag-standhouders-nl", type: "YOUTUBE_VIDEO", text: "GreenTech in 30 seconden", label: "BEST" },
  { group: "demo-ag-standhouders-intl", type: "TEXT", text: "Exhibit at GreenTech Amsterdam", label: "GOOD" },
  { group: "demo-ag-standhouders-intl", type: "TEXT", text: "Meet the global horticulture sector", label: "LOW" },
  { group: "demo-ag-standhouders-intl", type: "IMAGE", text: "Internationale standhouders", label: "GOOD" },
  { group: "demo-ag-standhouders-intl", type: "YOUTUBE_VIDEO", text: "Exhibitor testimonial 2025", label: "GOOD" },
  { group: "demo-ag-bezoekers-breed", type: "TEXT", text: "Bezoek de vakbeurs voor tuinbouwtechniek", label: "LOW" },
  { group: "demo-ag-bezoekers-breed", type: "TEXT", text: "Registreer uw team", label: "GOOD" },
  { group: "demo-ag-bezoekers-breed", type: "IMAGE", text: "Kas met LED-verlichting", label: "LOW" },
  // Geen YOUTUBE_VIDEO in deze groep — dat is het gat.
];

const AG_NAME: Record<string, string> = Object.fromEntries(ASSET_GROUPS.map((a) => [a.id, a.name]));

export function pmaxAssetRows(clientId: string, months: string[], syncedAt: string): Row[] {
  return months.flatMap((month) =>
    ASSETS.map((a, i) => ({
      client_id: clientId, month,
      campaign_id: PMAX_CAMPAIGN.id, campaign_name: PMAX_CAMPAIGN.name,
      asset_group_id: a.group, asset_group_name: AG_NAME[a.group],
      asset_id: `demo-asset-${i + 1}`, asset_type: a.type,
      asset_text: a.type === "TEXT" ? a.text : null,
      asset_url: a.type === "TEXT" ? null : `https://demo.greentech-fictief.example/assets/${i + 1}`,
      performance_label: a.label,
      // Google rapporteert per asset geen kosten of conversies; alleen het label en wat bereik.
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0,
      synced_at: syncedAt,
    }))
  );
}

// ── Placements ─────────────────────────────────────────────────────────────
// Twee bronnen in één tabel, en dat onderscheid is het hele punt. Bij videocampagnes levert Google
// volledige metrics per placement, dus daar mag een kosten- en CPA-oordeel op. Bij PMax levert hij
// UITSLUITEND vertoningen — geen kosten, geen conversies. Die rijen dragen metrics_complete=false,
// zodat de analyse ze niet als "gratis bereik" leest en er geen verspilling op berekent die hij
// niet kan zien.
//
// De verspillers zijn de klassiekers: kinderkanalen en spelletjes-apps, waar een videocampagne op
// automatische plaatsing altijd terechtkomt en waar geen enkele tuinbouwprofessional zit.

interface PlacementDef {
  placement: string; displayName: string; type: string;
  impressions: number; clicks: number; cost: number; conversions: number; views: number;
  source: "video" | "pmax";
}

const PLACEMENTS: PlacementDef[] = [
  // Videocampagne — volledige metrics, dus beoordeelbaar.
  { placement: "UCkids-cartoon-world", displayName: "Kids Cartoon World", type: "YOUTUBE_CHANNEL", impressions: 68000, clicks: 41, cost: 214, conversions: 0, views: 19400, source: "video" },
  { placement: "com.puzzlegames.blast", displayName: "Puzzle Blast (app)", type: "MOBILE_APPLICATION", impressions: 54000, clicks: 96, cost: 168, conversions: 0, views: 12800, source: "video" },
  { placement: "UCgaming-highlights", displayName: "Gaming Highlights", type: "YOUTUBE_CHANNEL", impressions: 31000, clicks: 28, cost: 92, conversions: 0, views: 8600, source: "video" },
  { placement: "UChorticulture-today", displayName: "Horticulture Today", type: "YOUTUBE_CHANNEL", impressions: 24000, clicks: 210, cost: 186, conversions: 9, views: 9800, source: "video" },
  { placement: "UCgreenhouse-tech", displayName: "Greenhouse Tech Review", type: "YOUTUBE_CHANNEL", impressions: 18500, clicks: 164, cost: 142, conversions: 7, views: 7600, source: "video" },
  { placement: "UCagri-machinery", displayName: "Agri Machinery NL", type: "YOUTUBE_CHANNEL", impressions: 12400, clicks: 118, cost: 128, conversions: 2, views: 5100, source: "video" },
  { placement: "nieuws-aggregator.example", displayName: "nieuws-aggregator.example", type: "WEBSITE", impressions: 9800, clicks: 34, cost: 61, conversions: 0, views: 2100, source: "video" },
  // Performance Max — Google levert hier ALLEEN vertoningen.
  { placement: "com.casual.match3", displayName: "Match3 Saga (app)", type: "MOBILE_APPLICATION", impressions: 41000, clicks: 0, cost: 0, conversions: 0, views: 0, source: "pmax" },
  { placement: "UCkids-songs", displayName: "Kids Songs TV", type: "YOUTUBE_CHANNEL", impressions: 22600, clicks: 0, cost: 0, conversions: 0, views: 0, source: "pmax" },
  { placement: "vakblad-tuinbouw.example", displayName: "vakblad-tuinbouw.example", type: "WEBSITE", impressions: 16800, clicks: 0, cost: 0, conversions: 0, views: 0, source: "pmax" },
  { placement: "UCagri-innovatie", displayName: "Agri Innovatie", type: "YOUTUBE_CHANNEL", impressions: 11200, clicks: 0, cost: 0, conversions: 0, views: 0, source: "pmax" },
  { placement: "weerbericht-app.example", displayName: "weerbericht-app.example", type: "WEBSITE", impressions: 4100, clicks: 0, cost: 0, conversions: 0, views: 0, source: "pmax" },
];

const AOV_PMAX = 180;

/** ads_video_placements: video én PMax in één beeld, met de metrics_complete-vlag als scheidslijn. */
export function videoPlacementRows(clientId: string, months: string[], syncedAt: string): Row[] {
  return months.flatMap((month, m) =>
    PLACEMENTS.map((p) => {
      const f = 1 + 0.1 * Math.sin(m * 1.7 + p.placement.length);
      const conversions = Math.round(p.conversions * f);
      return {
        client_id: clientId,
        campaign_id: p.source === "pmax" ? PMAX_CAMPAIGN.id : VIDEO_CAMPAIGN.id,
        campaign_name: p.source === "pmax" ? PMAX_CAMPAIGN.name : VIDEO_CAMPAIGN.name,
        month, placement: p.placement, display_name: p.displayName, placement_type: p.type,
        target_url: p.type === "WEBSITE" ? `https://${p.placement}` : null,
        impressions: Math.round(p.impressions * f),
        clicks: Math.round(p.clicks * f),
        cost: Math.round(p.cost * f),
        conversions,
        conversions_value: conversions * AOV_PMAX,
        video_views: Math.round(p.views * f),
        metrics_complete: p.source === "video",
        source: p.source,
        synced_at: syncedAt,
      };
    })
  );
}

/** ads_pmax_placements: dezelfde PMax-plaatsingen in de oudere, PMax-specifieke tabel. */
export function pmaxPlacementRows(clientId: string, months: string[], syncedAt: string): Row[] {
  return months.flatMap((month, m) =>
    PLACEMENTS.filter((p) => p.source === "pmax").map((p) => ({
      client_id: clientId, month,
      campaign_id: PMAX_CAMPAIGN.id, campaign_name: PMAX_CAMPAIGN.name,
      asset_group_id: null,
      placement: p.placement, placement_type: p.type,
      impressions: Math.round(p.impressions * (1 + 0.1 * Math.sin(m * 1.7 + p.placement.length))),
      // Nul, niet omdat er niets besteed is maar omdat Google het niet per placement publiceert.
      clicks: 0, cost: 0, conversions: 0, conversions_value: 0,
      synced_at: syncedAt,
    }))
  );
}

// ── Zoekcategorieën binnen PMax ────────────────────────────────────────────
// Het enige zicht dat PMax geeft op waar de Search-kant op zoekt. Zonder feed is dit de plek waar
// verdunning zichtbaar wordt: brede thema's die niets met standverkoop te maken hebben.

// De vier onderste zijn consumententhema's: tuinliefhebbers, geen vakpubliek. Ze converteren niet
// en dat is geen toeval — zonder feed en zonder zoekwoorden stuurt PMax op signalen die "tuinbouw"
// en "tuinieren" niet uit elkaar houden. Samen ruim een kwart van de search-spend zonder één
// aanvraag: dat is de verdunning die de expertlaag hoort te melden, en het is met uitsluitingen op
// merk- en themaniveau aan te pakken.
const SEARCH_CATEGORIES: Array<{ label: string; impW: number; clickW: number; convW: number }> = [
  { label: "greentech beurs", impW: 0.19, clickW: 0.24, convW: 0.33 },
  { label: "standhuur vakbeurs", impW: 0.13, clickW: 0.18, convW: 0.30 },
  { label: "tuinbouwtechniek beurs", impW: 0.16, clickW: 0.16, convW: 0.18 },
  { label: "kassenbouw bedrijven", impW: 0.12, clickW: 0.11, convW: 0.13 },
  { label: "landbouwbeurzen agenda", impW: 0.12, clickW: 0.09, convW: 0.06 },
  { label: "tuincentrum aanbieding", impW: 0.09, clickW: 0.07, convW: 0 },
  { label: "plantenbakken kopen", impW: 0.07, clickW: 0.06, convW: 0 },
  { label: "kas kopen particulier", impW: 0.07, clickW: 0.05, convW: 0 },
  { label: "moestuin beginnen", impW: 0.05, clickW: 0.04, convW: 0 },
];

export function pmaxSearchCategoryRows(clientId: string, networkRows: Row[], syncedAt: string): Row[] {
  // Alleen het Search-deel van PMax heeft zoekcategorieën.
  const byMonth = new Map<string, MonthTotals>();
  for (const r of networkRows) {
    if (r.network_type !== "SEARCH") continue;
    const t = totals(r);
    const acc = byMonth.get(t.month) ?? { month: t.month, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
    acc.impressions += t.impressions; acc.clicks += t.clicks; acc.cost += t.cost;
    acc.conversions += t.conversions; acc.conversions_value += t.conversions_value;
    byMonth.set(t.month, acc);
  }
  const rows: Row[] = [];
  for (const [month, t] of byMonth) {
    const imp = splitInt(t.impressions, SEARCH_CATEGORIES.map((c) => c.impW));
    const clk = splitInt(t.clicks, SEARCH_CATEGORIES.map((c) => c.clickW));
    const cost = splitInt(t.cost, SEARCH_CATEGORIES.map((c) => c.clickW));
    const conv = splitInt(t.conversions, SEARCH_CATEGORIES.map((c) => c.convW));
    const val = splitAlong(t.conversions_value, conv, SEARCH_CATEGORIES.map((c) => c.convW));
    SEARCH_CATEGORIES.forEach((c, i) => {
      rows.push({
        client_id: clientId, month, campaign_id: PMAX_CAMPAIGN.id, campaign_name: PMAX_CAMPAIGN.name,
        category_label: c.label, impressions: imp[i], clicks: clk[i], cost: cost[i],
        conversions: conv[i], conversions_value: val[i], synced_at: syncedAt,
      });
    });
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}
