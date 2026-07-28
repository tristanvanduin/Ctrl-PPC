/**
 * Pre-aggregates raw ad group monthly rows into compact summaries
 * for the monthly analysis pipeline step 3.
 *
 * Input:  raw rows from ads_adgroup_monthly (13 months)
 * Output: per-adgroup summary + per-campaign summary
 *
 * De uitvoer gaat als JSON rechtstreeks de analyseprompt in. Wat hier een getal is, leest het
 * model als een gemeten feit — dus staat er `null` waar niets gemeten is. Nul conversies is geen
 * goedkope CPA en geen dure; het is geen CPA. Een advertentiegroep die stilligt is geen
 * underperformer; er is niets van te zeggen. Dat onderscheid was hier weg en dat draaide
 * adviezen om: een groep die 6 euro uitgaf zonder één conversie kwam eruit als de goedkoopste
 * van de campagne.
 */

// ── Types ───────────────────────────────────────────────────────────────────

interface RawAdGroupRow {
  ad_group_id: string;
  ad_group_name: string;
  campaign_name: string;
  month: string;       // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  cpa: number;
  roas: number;
}

export interface AdGroupSummary {
  ad_group_name: string;
  campaign_name: string;
  months_with_data: number;
  /** False als er in de laatste 3 maanden geen enkele rij is: de groep ligt stil. */
  active_last_3m: boolean;
  avg_conversions_last_3m: number | null;
  avg_conversions_prev_3m: number | null;
  conversions_trend_pct: number | null;
  /** null bij 0 conversies — dan bestaat er geen kosten-per-conversie. */
  avg_cpa_last_3m: number | null;
  avg_cpa_prev_3m: number | null;
  cpa_trend_pct: number | null;
  avg_roas_last_3m: number | null;
  avg_roas_prev_3m: number | null;
  roas_trend_pct: number | null;
  avg_cost_last_3m: number | null;
  vs_campaign_avg_conversions_pct: number | null;
  vs_campaign_avg_roas_pct: number | null;
  vs_campaign_avg_cpa_pct: number | null;
  has_breakpoint: boolean;
  breakpoint_month: string | null;
  performance_label: "overperformer" | "underperformer" | "gemiddeld" | "geen_data";
}

export interface CampaignAdGroupSummary {
  campaign_name: string;
  total_ad_groups: number;
  overperformers: number;
  underperformers: number;
  gemiddeld: number;
  /** Advertentiegroepen zonder data in de laatste 3 maanden — niet meegewogen in het oordeel. */
  zonder_data: number;
  best_ad_group: string | null;
  best_ad_group_avg_conv: number | null;
  worst_ad_group: string | null;
  worst_ad_group_avg_conv: number | null;
}

export interface AggregatedAdGroupData {
  campaign_summaries: CampaignAdGroupSummary[];
  ad_group_details: AdGroupSummary[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Gemiddelde, of null als er niets te middelen valt. Een lege reeks is geen nul. */
function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/**
 * Kosten per conversie over een verzameling rijen: totale kosten gedeeld door totale conversies.
 * Zonder conversies is er geen CPA — niet "gelijk aan de kosten", want dan gaat een groep die
 * niets oplevert er goedkoop uitzien zodra hij weinig uitgeeft.
 */
function cpaOf(rows: RawAdGroupRow[]): number | null {
  if (rows.length === 0) return null;
  const conv = sum(rows.map((r) => r.conversions));
  if (conv <= 0) return null;
  return sum(rows.map((r) => r.cost)) / conv;
}

/** ROAS gewogen op kosten: totale waarde gedeeld door totale kosten. */
function roasOf(rows: RawAdGroupRow[]): number | null {
  if (rows.length === 0) return null;
  const cost = sum(rows.map((r) => r.cost));
  if (cost <= 0) return null;
  return sum(rows.map((r) => r.conversions_value)) / cost;
}

/**
 * Procentuele verandering. Ontbreekt een van beide kanten, of was de vorige periode nul, dan is
 * er geen percentage — ook geen +100%. Groei vanaf niets is niet te meten en het getal 100 zou
 * even echt ogen als een gemeten stijging.
 */
function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

function r2(n: number | null): number | null {
  return n === null ? null : parseFloat(n.toFixed(2));
}

function relatief(waarde: number | null, referentie: number | null): number | null {
  if (waarde === null || referentie === null || referentie === 0) return null;
  return ((waarde - referentie) / referentie) * 100;
}

function sortMonths(months: string[]): string[] {
  return [...months].sort();
}

/**
 * Onder deze grens is een maand-op-maand-sprong ruis, geen breekpunt. Bij 1 -> 2 conversies is
 * de relatieve verandering 100%, en met de conversieaantallen die hier langskomen zou vrijwel
 * elke advertentiegroep dan een breekpunt hebben.
 */
const BREAKPOINT_MIN_CONVERSIES = 3;
const BREAKPOINT_MIN_VERANDERING = 0.3;

// ── Main aggregation ────────────────────────────────────────────────────────

export function aggregateAdGroups(
  rawRows: RawAdGroupRow[],
  mentionedCampaigns: string[]
): AggregatedAdGroupData {
  // Filter to mentioned campaigns
  const filtered = mentionedCampaigns.length > 0
    ? rawRows.filter((r) => mentionedCampaigns.includes(r.campaign_name))
    : rawRows;

  if (filtered.length === 0) {
    return { campaign_summaries: [], ad_group_details: [] };
  }

  // Get all months sorted, determine last 3 and prev 3
  const allMonths = sortMonths([...new Set(filtered.map((r) => r.month))]);
  const last3Months = allMonths.slice(-3);
  const prev3Months = allMonths.slice(-6, -3);

  // Group by ad_group_id
  const byAdGroup = new Map<string, RawAdGroupRow[]>();
  for (const row of filtered) {
    const key = `${row.campaign_name}::${row.ad_group_id}`;
    if (!byAdGroup.has(key)) byAdGroup.set(key, []);
    byAdGroup.get(key)!.push(row);
  }

  // Compute campaign averages (last 3 months) for relative comparison
  const byCampaign = new Map<string, RawAdGroupRow[]>();
  for (const row of filtered) {
    if (!byCampaign.has(row.campaign_name)) byCampaign.set(row.campaign_name, []);
    byCampaign.get(row.campaign_name)!.push(row);
  }

  const campaignAvgs = new Map<string, { avgConv: number | null; avgRoas: number | null; avgCpa: number | null }>();
  for (const [campName, rows] of byCampaign) {
    const last3 = rows.filter((r) => last3Months.includes(r.month));
    const adGroupIds = [...new Set(last3.map((r) => r.ad_group_id))];

    // Conversies zijn een telling: het gemiddelde per advertentiegroep is hier zinvol.
    const adGroupConvAvgs: number[] = [];
    for (const agId of adGroupIds) {
      const agRows = last3.filter((r) => r.ad_group_id === agId);
      const a = avgOrNull(agRows.map((r) => r.conversions));
      if (a !== null) adGroupConvAvgs.push(a);
    }

    // CPA en ROAS zijn verhoudingen. Het gemiddelde van verhoudingen is geen verhouding: een
    // advertentiegroep van 3 euro telde net zo zwaar mee als een van 1000, waardoor de
    // campagnenorm wegzakte en de groep die het werk doet er duur uit kwam te zien.
    campaignAvgs.set(campName, {
      avgConv: avgOrNull(adGroupConvAvgs),
      avgRoas: roasOf(last3),
      avgCpa: cpaOf(last3),
    });
  }

  // Build per-adgroup summaries
  const adGroupDetails: AdGroupSummary[] = [];

  for (const [, rows] of byAdGroup) {
    const first = rows[0];
    const campAvg = campaignAvgs.get(first.campaign_name)!;

    const last3 = rows.filter((r) => last3Months.includes(r.month));
    const prev3 = rows.filter((r) => prev3Months.includes(r.month));
    const actiefLast3 = last3.length > 0;

    const avgConvLast = avgOrNull(last3.map((r) => r.conversions));
    const avgConvPrev = avgOrNull(prev3.map((r) => r.conversions));

    const avgCpaLast = cpaOf(last3);
    const avgCpaPrev = cpaOf(prev3);

    const avgRoasLast = roasOf(last3);
    const avgRoasPrev = roasOf(prev3);

    const avgCostLast = avgOrNull(last3.map((r) => r.cost));

    // Breekpunt: de grootste maand-op-maand-sprong die boven de ruisgrens uitkomt.
    const sortedRows = [...rows].sort((a, b) => a.month.localeCompare(b.month));
    let hasBreakpoint = false;
    let breakpointMonth: string | null = null;
    let grootsteVerandering = 0;

    for (let i = 1; i < sortedRows.length; i++) {
      const prevConv = sortedRows[i - 1].conversions;
      const currConv = sortedRows[i].conversions;
      // Zonder voldoende volume aan minstens één kant is de sprong ruis.
      if (Math.max(prevConv, currConv) < BREAKPOINT_MIN_CONVERSIES) continue;

      const change = prevConv > 0
        ? Math.abs((currConv - prevConv) / prevConv)
        : Infinity; // van nul naar iets van betekenis
      if (change > BREAKPOINT_MIN_VERANDERING && change > grootsteVerandering) {
        grootsteVerandering = change;
        hasBreakpoint = true;
        breakpointMonth = sortedRows[i].month;
      }
    }

    // Performance label based on conversions vs campaign average.
    // Ligt de groep stil, dan is er geen oordeel — niet "onder het gemiddelde".
    const vsConvPct = relatief(avgConvLast, campAvg.avgConv);
    const label: AdGroupSummary["performance_label"] =
      !actiefLast3 ? "geen_data" :
      vsConvPct === null ? "gemiddeld" :
      vsConvPct > 15 ? "overperformer" :
      vsConvPct < -15 ? "underperformer" :
      "gemiddeld";

    const vsRoasPct = relatief(avgRoasLast, campAvg.avgRoas);
    const vsCpaPct = relatief(avgCpaLast, campAvg.avgCpa);

    adGroupDetails.push({
      ad_group_name: first.ad_group_name,
      campaign_name: first.campaign_name,
      // Maanden, geen rijen: dubbele rijen voor dezelfde maand mogen dit niet opblazen.
      months_with_data: new Set(rows.map((r) => r.month)).size,
      active_last_3m: actiefLast3,
      avg_conversions_last_3m: r2(avgConvLast),
      avg_conversions_prev_3m: r2(avgConvPrev),
      conversions_trend_pct: pctChange(avgConvLast, avgConvPrev),
      avg_cpa_last_3m: r2(avgCpaLast),
      avg_cpa_prev_3m: r2(avgCpaPrev),
      cpa_trend_pct: pctChange(avgCpaLast, avgCpaPrev),
      avg_roas_last_3m: r2(avgRoasLast),
      avg_roas_prev_3m: r2(avgRoasPrev),
      roas_trend_pct: pctChange(avgRoasLast, avgRoasPrev),
      avg_cost_last_3m: r2(avgCostLast),
      vs_campaign_avg_conversions_pct: r2(vsConvPct),
      vs_campaign_avg_roas_pct: r2(vsRoasPct),
      vs_campaign_avg_cpa_pct: r2(vsCpaPct),
      has_breakpoint: hasBreakpoint,
      breakpoint_month: breakpointMonth,
      performance_label: label,
    });
  }

  // Sort: underperformers first, then overperformers, then gemiddeld, dan wat stilligt.
  const labelOrder = { underperformer: 0, overperformer: 1, gemiddeld: 2, geen_data: 3 };
  adGroupDetails.sort((a, b) => labelOrder[a.performance_label] - labelOrder[b.performance_label]);

  // Build campaign summaries
  const campaignSummaries: CampaignAdGroupSummary[] = [];
  for (const [campName] of byCampaign) {
    const campAgs = adGroupDetails.filter((ag) => ag.campaign_name === campName);
    if (campAgs.length === 0) continue;

    const over = campAgs.filter((a) => a.performance_label === "overperformer").length;
    const under = campAgs.filter((a) => a.performance_label === "underperformer").length;
    const mid = campAgs.filter((a) => a.performance_label === "gemiddeld").length;
    const leeg = campAgs.filter((a) => a.performance_label === "geen_data").length;

    // Beste en slechtste alleen over groepen die daadwerkelijk gedraaid hebben, en alleen als er
    // iets te vergelijken valt: bij één advertentiegroep is dezelfde groep niet de beste én de
    // slechtste.
    const metData = campAgs.filter((a) => a.avg_conversions_last_3m !== null);
    const sorted = [...metData].sort((a, b) => (b.avg_conversions_last_3m ?? 0) - (a.avg_conversions_last_3m ?? 0));
    const best = sorted.length > 0 ? sorted[0] : null;
    const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null;

    campaignSummaries.push({
      campaign_name: campName,
      total_ad_groups: campAgs.length,
      overperformers: over,
      underperformers: under,
      gemiddeld: mid,
      zonder_data: leeg,
      best_ad_group: best?.ad_group_name ?? null,
      best_ad_group_avg_conv: best?.avg_conversions_last_3m ?? null,
      worst_ad_group: worst?.ad_group_name ?? null,
      worst_ad_group_avg_conv: worst?.avg_conversions_last_3m ?? null,
    });
  }

  return { campaign_summaries: campaignSummaries, ad_group_details: adGroupDetails };
}
