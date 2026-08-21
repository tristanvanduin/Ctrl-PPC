// De Google-dimensies die de maand-SOP leest maar die in de demo ontbraken: weekdata, ad-groepen,
// zoektermen, YoY, campagne-metadata, apparaten, netwerken, advertentieschema, zoekwoorden en
// doelgroepen. Zonder deze tabellen viel de helft van de SOP-stappen terug op "geen data" en kon
// een demo-analyse nooit laten zien wat het product werkelijk doet.
//
// TWEE REGELS DIE HIER OVERAL GELDEN
//
// 1. Afleiden, niet verzinnen. Bijna alles wordt uit de bestaande maandreeks (ads_account_monthly /
//    ads_campaign_monthly) gesplitst met splitInt, zodat de som exact terugkomt op het totaal waar
//    hij uit kwam. Een dimensie die niet optelt tot het account is precies het soort tegenstrijdig-
//    heid waar een analist over struikelt — en in een demo is dat dodelijk.
// 2. Elke dimensie draagt één herkenbaar patroon. Niet omdat de detectie erop afgestemd is, maar
//    andersom: een account zónder dure ad-groep, zonder nachtelijke verspilling en zonder zwak
//    zoekpartner-netwerk bestaat niet. Vlakke demo-data zou juist het onrealistische geval zijn.
//
// Puur presentatie: alleen actief in demo-modus, nooit vermengd met echte data.

import { splitAlong, splitInt } from "./split";
import { today } from "../reporting-date";

type Row = Record<string, unknown>;

/** De maandvelden die we uit een account- of campagnerij nodig hebben om te kunnen splitsen. */
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

/** Ratio's altijd uit de totalen van dezelfde rij, nooit uit een gemiddelde van ratio's. */
const derived = (t: Omit<MonthTotals, "month">) => ({
  ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
  avg_cpc: t.clicks > 0 ? t.cost / t.clicks : 0,
  conversion_rate: t.clicks > 0 ? t.conversions / t.clicks : 0,
  cost_per_conversion: t.conversions > 0 ? t.cost / t.conversions : 0,
  roas: t.cost > 0 ? t.conversions_value / t.cost : 0,
});

const daysInMonth = (monthIso: string): number => {
  const [y, m] = monthIso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Maandag van de week waarin deze datum valt (ISO-week, dus maandag-start). */
const mondayOf = (dateIso: string): string => {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

const isWeekend = (dateIso: string): boolean => {
  const wd = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
};

/** Verschuift een maand-ISO ("YYYY-MM-01") met n maanden. */
const shiftMonth = (monthIso: string, n: number): string => {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

const pct = (cur: number, prev: number): number | null =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;

// Deterministische kartel op een gewicht. Zonder dit valt elk gelijk gewogen deel exact hetzelfde
// uit — twee volle weken binnen dezelfde maand worden dan tot op de euro identiek, en dat verraadt
// gegenereerde data onmiddellijk. De uitkomst blijft stabiel omdat er geen random in zit.
const wobble = (i: number, seed: number, amp = 0.12): number => 1 + amp * Math.sin(i * 1.9 + seed);

// ── ads_account_weekly ─────────────────────────────────────────────────────
// De weekreeks wordt niet los verzonnen maar via dagen uit de maandreeks afgeleid: elke maand
// wordt over zijn eigen dagen verdeeld (weekend lichter), en een week is de som van zijn zeven
// dagen. Daarmee klopt een week die over een maandgrens valt vanzelf, en tellen hele maanden nog
// steeds exact op tot ads_account_monthly.

const WEEKEND_DAY_WEIGHT = 0.72;

function dailyFromMonthly(monthly: Row[]): Map<string, MonthTotals> {
  const out = new Map<string, MonthTotals>();
  for (const raw of monthly) {
    const t = totals(raw);
    const n = daysInMonth(t.month);
    const dates = Array.from({ length: n }, (_, i) => `${t.month.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
    const seed = Number(t.month.slice(5, 7));
    const weights = dates.map((d, i) => (isWeekend(d) ? WEEKEND_DAY_WEIGHT : 1) * wobble(i, seed));
    const imp = splitInt(t.impressions, weights);
    const clk = splitInt(t.clicks, weights);
    const cost = splitInt(t.cost, weights);
    const conv = splitInt(t.conversions, weights);
    const val = splitAlong(t.conversions_value, conv, weights);
    dates.forEach((date, i) => {
      out.set(date, {
        month: date, impressions: imp[i], clicks: clk[i], cost: cost[i],
        conversions: conv[i], conversions_value: val[i],
      });
    });
  }
  return out;
}

/** Volle weken (maandag t/m zondag) tot en met de laatst afgeronde week. */
export function accountWeeklyRows(clientId: string, accountMonthly: Row[], weeks: number): Row[] {
  const daily = dailyFromMonthly(accountMonthly);
  const lastComplete = new Date(`${mondayOf(today())}T00:00:00Z`);
  lastComplete.setUTCDate(lastComplete.getUTCDate() - 7); // de lopende week is nog niet af
  const rows: Row[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(lastComplete);
    start.setUTCDate(start.getUTCDate() - w * 7);
    const weekStart = start.toISOString().slice(0, 10);
    const sum = { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + d);
      const hit = daily.get(day.toISOString().slice(0, 10));
      if (!hit) continue;
      sum.impressions += hit.impressions; sum.clicks += hit.clicks; sum.cost += hit.cost;
      sum.conversions += hit.conversions; sum.conversions_value += hit.conversions_value;
    }
    if (sum.impressions === 0) continue; // week valt buiten de maandreeks
    rows.push({ client_id: clientId, week_start: weekStart, ...sum, ...derived(sum) });
  }
  return rows;
}

// ── ads_adgroup_monthly ────────────────────────────────────────────────────
// Ad-groepen splitsen hun campagne exact. Kosten en conversies krijgen bewust eigen gewichten:
// als beide hetzelfde verdeeld zijn, heeft elke ad-groep dezelfde CPA en valt er niets te kiezen.
// "GRT Standhouders" is de dure: een kwart van het budget voor een tiende van de aanmeldingen —
// het patroon waar je bij een beurs op rekent, omdat standverkoop een veel langere cyclus heeft
// dan een bezoekersregistratie.

interface AdGroupDef { name: string; costW: number; convW: number }

const AD_GROUPS: Record<string, AdGroupDef[]> = {
  "GRT | Search | NL": [
    { name: "GRT Generiek", costW: 0.42, convW: 0.46 },
    { name: "GRT Beursbezoek", costW: 0.33, convW: 0.44 },
    { name: "GRT Standhouders", costW: 0.25, convW: 0.10 },
  ],
  "GRA | Search | US": [
    { name: "GRA Search", costW: 0.62, convW: 0.71 },
    { name: "GRA Exhibitors", costW: 0.38, convW: 0.29 },
  ],
  "GRN | Search | Canada": [
    { name: "GRN Generiek", costW: 0.57, convW: 0.63 },
    { name: "GRN Exhibitors", costW: 0.43, convW: 0.37 },
  ],
  "GRN | Display | Canada": [{ name: "GRN Display Prospecting", costW: 1, convW: 1 }],
  "GreenTech | Brand": [
    { name: "Brand", costW: 0.72, convW: 0.78 },
    { name: "Brand Varianten", costW: 0.28, convW: 0.22 },
  ],
  // Videocampagnes hebben wél ad-groepen. Performance Max NIET — die kent alleen asset groups, en
  // die staan in ads_asset_group_performance_monthly. Daarom ontbreekt de PMax-campagne hier
  // bewust: hem toch opnemen zou een tabel vullen die Google voor PMax niet levert.
  "GRT | Video | YouTube awareness": [
    { name: "Video Awareness NL", costW: 0.63, convW: 0.52 },
    { name: "Video Retargeting bezoekers", costW: 0.37, convW: 0.48 },
  ],
};

/** De campagnes die ad-groepen hébben — alles behalve Performance Max. */
export const CAMPAIGNS_WITH_AD_GROUPS = Object.keys(AD_GROUPS);

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function adgroupMonthlyRows(clientId: string, campaignMonthly: Row[], sinceMonth: string): Row[] {
  const rows: Row[] = [];
  for (const raw of campaignMonthly) {
    const campaign = String(raw.campaign_name);
    const defs = AD_GROUPS[campaign];
    if (!defs) continue;
    const t = totals(raw);
    if (t.month < sinceMonth) continue;
    const costW = defs.map((d) => d.costW);
    const convW = defs.map((d) => d.convW);
    const imp = splitInt(t.impressions, costW);
    const clk = splitInt(t.clicks, costW);
    const cost = splitInt(t.cost, costW);
    const conv = splitInt(t.conversions, convW);
    const val = splitAlong(t.conversions_value, conv, convW);
    defs.forEach((d, i) => {
      const part = { impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i] };
      const der = derived(part);
      rows.push({
        client_id: clientId, campaign_name: campaign, ad_group_id: `demo-ag-${slug(d.name)}`,
        ad_group_name: d.name, month: t.month, ...part,
        cpa: der.cost_per_conversion, roas: der.roas,
        ctr: der.ctr, avg_cpc: der.avg_cpc, conversion_rate: der.conversion_rate,
        cost_per_conversion: der.cost_per_conversion,
      });
    });
  }
  return rows;
}

// ── ads_search_terms_wasteful ──────────────────────────────────────────────
// Alleen termen mét klikken en zónder conversie — dat is wat de tabel per definitie draagt. De
// selectie is die van een vakbeurs: beleggers, werkzoekenden, gratis-kaartjeszoekers en de vorige
// editie. Vaste bedragen in plaats van afgeleide: dit is een lijst, geen reeks, en de rangschikking
// op kosten is precies wat de analyse eruit haalt.

interface WasteTermDef { term: string; campaign: string; adGroup: string; imp: number; clicks: number; costPerWeek: number; status?: string }

const WASTE_TERMS: WasteTermDef[] = [
  { term: "greentech aandelen", campaign: "GRT | Search | NL", adGroup: "GRT Generiek", imp: 1840, clicks: 96, costPerWeek: 178 },
  { term: "green tech banen", campaign: "GRT | Search | NL", adGroup: "GRT Generiek", imp: 1420, clicks: 74, costPerWeek: 131 },
  { term: "trade show booth cost", campaign: "GRA | Search | US", adGroup: "GRA Exhibitors", imp: 980, clicks: 61, costPerWeek: 124 },
  { term: "gratis toegangskaart beurs", campaign: "GRT | Search | NL", adGroup: "GRT Beursbezoek", imp: 2260, clicks: 108, costPerWeek: 119 },
  { term: "kassenbouw vacature", campaign: "GRT | Search | NL", adGroup: "GRT Generiek", imp: 760, clicks: 41, costPerWeek: 88 },
  { term: "greenhouse jobs usa", campaign: "GRA | Search | US", adGroup: "GRA Search", imp: 1120, clicks: 52, costPerWeek: 84 },
  { term: "greentech 2024", campaign: "GreenTech | Brand", adGroup: "Brand Varianten", imp: 640, clicks: 47, costPerWeek: 41 },
  { term: "tuinbouwbeurs china", campaign: "GRT | Search | NL", adGroup: "GRT Generiek", imp: 520, clicks: 24, costPerWeek: 39 },
  { term: "horti fair", campaign: "GRT | Search | NL", adGroup: "GRT Beursbezoek", imp: 880, clicks: 33, costPerWeek: 36, status: "EXCLUDED" },
  { term: "greentech americas hotel", campaign: "GRA | Search | US", adGroup: "GRA Search", imp: 410, clicks: 19, costPerWeek: 28 },
];

/** Per week één rij per term; al op kosten gesorteerd, zoals de query ze zou opleveren. */
export function wastefulSearchTermRows(clientId: string, weekStarts: string[]): Row[] {
  return WASTE_TERMS.flatMap((t, rank) =>
    weekStarts.map((week_start, w) => {
      // Lichte, deterministische variatie per week zodat het geen kopieerwerk lijkt.
      const f = 1 + 0.14 * Math.sin(w * 1.3 + rank);
      return {
        client_id: clientId, week_start, search_term: t.term,
        campaign_name: t.campaign, ad_group_name: t.adGroup,
        impressions: Math.round(t.imp * f), clicks: Math.round(t.clicks * f),
        cost: Math.round(t.costPerWeek * f), term_status: t.status ?? "NONE",
      };
    })
  );
}

// ── YoY ────────────────────────────────────────────────────────────────────
// Berekend uit de 25-maandreeks met een echte 12-maands-vertraging, precies zoals de SQL-backfill
// in productie het doet. Verzonnen percentages zouden de reeks ernaast kunnen tegenspreken.

export function accountYoyRows(clientId: string, accountMonthly: Row[]): Row[] {
  const byMonth = new Map(accountMonthly.map((r) => [String(r.month), totals(r)]));
  const rows: Row[] = [];
  for (const [month, cur] of byMonth) {
    const prev = byMonth.get(shiftMonth(month, -12));
    if (!prev) continue;
    const c = derived(cur), p = derived(prev);
    rows.push({
      client_id: clientId, month,
      impressions_yoy_pct: pct(cur.impressions, prev.impressions),
      clicks_yoy_pct: pct(cur.clicks, prev.clicks),
      cost_yoy_pct: pct(cur.cost, prev.cost),
      conversions_yoy_pct: pct(cur.conversions, prev.conversions),
      conversions_value_yoy_pct: pct(cur.conversions_value, prev.conversions_value),
      ctr_yoy_pct: pct(c.ctr, p.ctr),
      avg_cpc_yoy_pct: pct(c.avg_cpc, p.avg_cpc),
      conversion_rate_yoy_pct: pct(c.conversion_rate, p.conversion_rate),
      roas_yoy_pct: pct(c.roas, p.roas),
      cost_per_conversion_yoy_pct: pct(c.cost_per_conversion, p.cost_per_conversion),
    });
  }
  return rows.sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

export function campaignYoyRows(clientId: string, campaignMonthly: Row[]): Row[] {
  const key = (id: string, month: string) => `${id}|${month}`;
  const byKey = new Map(campaignMonthly.map((r) => [key(String(r.campaign_id), String(r.month)), r]));
  const rows: Row[] = [];
  for (const raw of campaignMonthly) {
    const cur = totals(raw);
    const prevRaw = byKey.get(key(String(raw.campaign_id), shiftMonth(cur.month, -12)));
    if (!prevRaw) continue;
    const prev = totals(prevRaw);
    const c = derived(cur), p = derived(prev);
    rows.push({
      client_id: clientId, campaign_id: raw.campaign_id, campaign_name: raw.campaign_name, month: cur.month,
      conversions_yoy_pct: pct(cur.conversions, prev.conversions),
      conversions_value_yoy_pct: pct(cur.conversions_value, prev.conversions_value),
      cost_yoy_pct: pct(cur.cost, prev.cost),
      roas_yoy_pct: pct(c.roas, p.roas),
      cost_per_conversion_yoy_pct: pct(c.cost_per_conversion, p.cost_per_conversion),
    });
  }
  return rows.sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

// ── ads_campaign_metadata ──────────────────────────────────────────────────
// Biedstrategie en budget per campagne. De dagbudgetten komen overeen met
// ads_campaign_impression_share, zodat "verliest impressieaandeel op budget" en het budget zelf
// hetzelfde verhaal vertellen. De Display-campagne staat op Maximaliseer klikken bij een
// conversiedoel — precies de mismatch die een bied-strategie-analyse hoort te zien.

const CAMPAIGN_META: Array<{ id: string; name: string; type: string; strategy: string; target: number | null; budget: number }> = [
  { id: "demo-c-grt", name: "GRT | Search | NL", type: "SEARCH", strategy: "MAXIMIZE_CONVERSIONS", target: null, budget: 140 },
  { id: "demo-c-gra", name: "GRA | Search | US", type: "SEARCH", strategy: "TARGET_CPA", target: 70, budget: 110 },
  { id: "demo-c-grn", name: "GRN | Search | Canada", type: "SEARCH", strategy: "TARGET_CPA", target: 80, budget: 90 },
  { id: "demo-c-grn2", name: "GRN | Display | Canada", type: "DISPLAY", strategy: "MAXIMIZE_CLICKS", target: null, budget: 30 },
  { id: "demo-c-brand", name: "GreenTech | Brand", type: "SEARCH", strategy: "TARGET_IMPRESSION_SHARE", target: 0.95, budget: 20 },
  { id: "demo-c-pmax", name: "GreenTech | PMax | Standhouders", type: "PERFORMANCE_MAX", strategy: "MAXIMIZE_CONVERSIONS", target: null, budget: 105 },
  { id: "demo-c-video", name: "GRT | Video | YouTube awareness", type: "VIDEO", strategy: "TARGET_CPM", target: 8, budget: 60 },
  { id: "demo-c-shop", name: "GreenTech | Shopping | Merchandise", type: "SHOPPING", strategy: "MAXIMIZE_CONVERSION_VALUE", target: null, budget: 15 },
];

export function campaignMetadataRows(clientId: string, updatedAt: string): Row[] {
  return CAMPAIGN_META.map((c) => ({
    client_id: clientId, campaign_id: c.id, campaign_name: c.name, campaign_type: c.type,
    bidding_strategy: c.strategy, bidding_strategy_target: c.target,
    budget_amount: c.budget, budget_type: "DAILY", serving_status: "SERVING", updated_at: updatedAt,
  }));
}

// ── ads_device_performance_monthly ─────────────────────────────────────────
// Mobiel levert het volume, desktop de conversies. Dat is voor een vakbeurs geen toeval: een
// bezoeker oriënteert zich op de telefoon maar registreert zijn team vanaf kantoor. Tablet is
// klein en duur. De aandelen splitsen het accounttotaal, dus de som blijft het account.

const DEVICES: Array<{ device: string; impW: number; clickW: number; costW: number; convW: number }> = [
  { device: "MOBILE", impW: 0.58, clickW: 0.55, costW: 0.52, convW: 0.34 },
  { device: "DESKTOP", impW: 0.34, clickW: 0.39, costW: 0.42, convW: 0.60 },
  { device: "TABLET", impW: 0.08, clickW: 0.06, costW: 0.06, convW: 0.06 },
];

export function devicePerformanceRows(clientId: string, accountMonthly: Row[], months: string[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  for (const raw of accountMonthly) {
    const t = totals(raw);
    if (!months.includes(t.month)) continue;
    const imp = splitInt(t.impressions, DEVICES.map((d) => d.impW));
    const clk = splitInt(t.clicks, DEVICES.map((d) => d.clickW));
    const cost = splitInt(t.cost, DEVICES.map((d) => d.costW));
    const conv = splitInt(t.conversions, DEVICES.map((d) => d.convW));
    const val = splitAlong(t.conversions_value, conv, DEVICES.map((d) => d.convW));
    DEVICES.forEach((d, i) => {
      const part = { impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i] };
      rows.push({
        client_id: clientId, month: t.month, device: d.device, level: "account",
        campaign_id: null, campaign_name: null, ...part, ...derived(part), synced_at: syncedAt,
      });
    });
  }
  return rows;
}

// ── ads_network_performance_monthly ────────────────────────────────────────
// Zoekpartners kosten hier 6% van het budget voor 2% van de conversies. Dat is de klassieke stille
// lekkage: het staat standaard aan, het valt in het campagnetotaal niet op, en het is met één
// vinkje uit te zetten. YouTube en Display dragen samen het leeuwendeel van de vertoningen — met
// een videocampagne en een PMax zonder feed in het account is dat precies wat je verwacht — maar
// een klein deel van de conversies. Dat contrast is de reden dat deze uitsplitsing bestaat.

const NETWORKS: Array<{ type: string; impW: number; clickW: number; costW: number; convW: number }> = [
  { type: "SEARCH", impW: 0.14, clickW: 0.63, costW: 0.62, convW: 0.83 },
  { type: "SEARCH_PARTNERS", impW: 0.04, clickW: 0.08, costW: 0.06, convW: 0.02 },
  { type: "CONTENT", impW: 0.29, clickW: 0.16, costW: 0.16, convW: 0.09 },
  { type: "YOUTUBE_WATCH", impW: 0.53, clickW: 0.13, costW: 0.16, convW: 0.06 },
];

export function networkPerformanceRows(clientId: string, accountMonthly: Row[], months: string[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  for (const raw of accountMonthly) {
    const t = totals(raw);
    if (!months.includes(t.month)) continue;
    const imp = splitInt(t.impressions, NETWORKS.map((n) => n.impW));
    const clk = splitInt(t.clicks, NETWORKS.map((n) => n.clickW));
    const cost = splitInt(t.cost, NETWORKS.map((n) => n.costW));
    const conv = splitInt(t.conversions, NETWORKS.map((n) => n.convW));
    const val = splitAlong(t.conversions_value, conv, NETWORKS.map((n) => n.convW));
    NETWORKS.forEach((n, i) => {
      const part = { impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i] };
      const der = derived(part);
      rows.push({
        client_id: clientId, month: t.month, network_type: n.type, campaign_id: null, campaign_name: null,
        ...part, ctr: der.ctr, conversion_rate: der.conversion_rate, synced_at: syncedAt,
      });
    });
  }
  // Op kosten aflopend, zoals de query ze zou teruggeven.
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}

// ── ads_ad_schedule_performance ────────────────────────────────────────────
// Uur × weekdag over de laatste 30 dagen. De nacht (00–06u) loopt door met budget maar levert
// nauwelijks conversies, en het weekend is voor een zakelijke beurs structureel zwakker. Beide
// zijn met een advertentieschema te repareren, wat het een bruikbare bevinding maakt in plaats
// van een observatie.

const DOW = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DOW_COST_W = [1.08, 1.12, 1.1, 1.06, 0.98, 0.42, 0.38];
const DOW_CONV_W = [1.16, 1.2, 1.15, 1.08, 0.92, 0.3, 0.26];
// Kantooruren dragen de kosten; de nacht is goedkoop per uur maar loopt wél door.
const hourCostW = (h: number): number => (h < 6 ? 0.35 : h < 9 ? 0.8 : h <= 17 ? 1.5 : h <= 21 ? 1.0 : 0.5);
// En de nacht converteert bijna niet — daar zit het gat.
const hourConvW = (h: number): number => (h < 6 ? 0.18 : h < 9 ? 0.7 : h <= 17 ? 1.7 : h <= 21 ? 1.0 : 0.35);

export function adScheduleRows(
  clientId: string, accountMonthly: Row[], periodStart: string, periodEnd: string, syncedAt: string
): Row[] {
  const latest = accountMonthly[accountMonthly.length - 1];
  if (!latest) return [];
  const t = totals(latest); // één maand ≈ de 30-daagse periode van deze tabel
  const cells: Array<{ dow: string; hour: number; costW: number; convW: number }> = [];
  DOW.forEach((dow, di) => {
    for (let h = 0; h < 24; h++) {
      cells.push({
        dow, hour: h,
        costW: DOW_COST_W[di] * hourCostW(h) * wobble(h, di),
        convW: DOW_CONV_W[di] * hourConvW(h) * wobble(h, di + 3),
      });
    }
  });
  const imp = splitInt(t.impressions, cells.map((c) => c.costW));
  const clk = splitInt(t.clicks, cells.map((c) => c.costW));
  const cost = splitInt(t.cost, cells.map((c) => c.costW));
  const conv = splitInt(t.conversions, cells.map((c) => c.convW));
  const val = splitAlong(t.conversions_value, conv, cells.map((c) => c.convW));
  return cells
    .map((c, i) => ({
      client_id: clientId, period_start: periodStart, period_end: periodEnd,
      campaign_id: null, campaign_name: null, day_of_week: c.dow, hour_of_day: c.hour,
      impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i],
      conversions_value: val[i], synced_at: syncedAt,
    }))
    .sort((a, b) => b.cost - a.cost);
}

// ── ads_keyword_performance_monthly ────────────────────────────────────────
// Zoekwoorden splitsen hun ad-groep, zodat ze optellen tot de ad-groep en daarmee tot de campagne.
// De kwaliteitsscores zijn expliciet: "beursstand huren" is duur én slecht scorend (4), het brede
// "tuinbouw innovatie" scoort matig, en de merktermen scoren hoog. Dat is de spreiding waar een
// kosten-gewogen QS-analyse iets mee kan; een account met overal QS 7 heeft geen verhaal.

interface KeywordDef { text: string; adGroup: string; match: string; costW: number; convW: number; qs: number | null }

const KEYWORDS: KeywordDef[] = [
  { text: "greentech beurs", adGroup: "GRT Generiek", match: "PHRASE", costW: 0.34, convW: 0.40, qs: 8 },
  { text: "tuinbouw innovatie", adGroup: "GRT Generiek", match: "BROAD", costW: 0.41, convW: 0.28, qs: 5 },
  { text: "kasbouw beurs amsterdam", adGroup: "GRT Generiek", match: "EXACT", costW: 0.25, convW: 0.32, qs: 9 },
  { text: "greentech tickets", adGroup: "GRT Beursbezoek", match: "EXACT", costW: 0.46, convW: 0.58, qs: 9 },
  { text: "tuinbouwbeurs bezoeken", adGroup: "GRT Beursbezoek", match: "PHRASE", costW: 0.54, convW: 0.42, qs: 7 },
  { text: "beursstand huren", adGroup: "GRT Standhouders", match: "BROAD", costW: 0.63, convW: 0.24, qs: 4 },
  { text: "exposant greentech", adGroup: "GRT Standhouders", match: "EXACT", costW: 0.37, convW: 0.76, qs: 8 },
  { text: "horticulture trade show", adGroup: "GRA Search", match: "PHRASE", costW: 0.58, convW: 0.52, qs: 6 },
  { text: "greentech americas", adGroup: "GRA Search", match: "EXACT", costW: 0.42, convW: 0.48, qs: 9 },
  { text: "exhibit horticulture usa", adGroup: "GRA Exhibitors", match: "BROAD", costW: 1, convW: 1, qs: 5 },
  { text: "greenhouse expo canada", adGroup: "GRN Generiek", match: "PHRASE", costW: 0.61, convW: 0.55, qs: 6 },
  { text: "greentech north america", adGroup: "GRN Generiek", match: "EXACT", costW: 0.39, convW: 0.45, qs: 8 },
  { text: "exhibitor greenhouse canada", adGroup: "GRN Exhibitors", match: "BROAD", costW: 1, convW: 1, qs: 5 },
  { text: "greentech", adGroup: "Brand", match: "EXACT", costW: 0.68, convW: 0.72, qs: 10 },
  { text: "green tech amsterdam", adGroup: "Brand", match: "PHRASE", costW: 0.32, convW: 0.28, qs: 9 },
  // Zonder gerapporteerde QS: Google levert die niet voor elk zoekwoord. Bewust aanwezig, zodat
  // de dekkingscheck in de QS-analyse ook echt iets te dekken heeft.
  { text: "greentech merk varianten", adGroup: "Brand Varianten", match: "BROAD", costW: 1, convW: 1, qs: null },
];

const CAMPAIGN_BY_AD_GROUP: Record<string, string> = Object.fromEntries(
  Object.entries(AD_GROUPS).flatMap(([campaign, defs]) => defs.map((d) => [d.name, campaign] as const))
);
const CAMPAIGN_ID_BY_NAME: Record<string, string> = Object.fromEntries(CAMPAIGN_META.map((c) => [c.name, c.id]));

export function keywordPerformanceRows(clientId: string, adgroupRows: Row[], months: string[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  const byAdGroup = new Map<string, KeywordDef[]>();
  for (const k of KEYWORDS) byAdGroup.set(k.adGroup, [...(byAdGroup.get(k.adGroup) ?? []), k]);

  for (const raw of adgroupRows) {
    const adGroup = String(raw.ad_group_name);
    const defs = byAdGroup.get(adGroup);
    if (!defs) continue; // Display-groepen hebben geen zoekwoorden
    const t = totals(raw);
    if (!months.includes(t.month)) continue;
    const imp = splitInt(t.impressions, defs.map((d) => d.costW));
    const clk = splitInt(t.clicks, defs.map((d) => d.costW));
    const cost = splitInt(t.cost, defs.map((d) => d.costW));
    const conv = splitInt(t.conversions, defs.map((d) => d.convW));
    const val = splitAlong(t.conversions_value, conv, defs.map((d) => d.convW));
    const campaign = CAMPAIGN_BY_AD_GROUP[adGroup] ?? String(raw.campaign_name);
    defs.forEach((d, i) => {
      const part = { impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i] };
      rows.push({
        client_id: clientId, month: t.month,
        campaign_id: CAMPAIGN_ID_BY_NAME[campaign] ?? null,
        campaign_name: campaign,
        ad_group_id: raw.ad_group_id, ad_group_name: adGroup,
        keyword_id: `demo-kw-${slug(d.text)}`, keyword_text: d.text, match_type: d.match,
        ...part, ...derived(part), quality_score: d.qs, synced_at: syncedAt,
      });
    });
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}

// ── ads_geo_performance_monthly ────────────────────────────────────────────
// Land × campagne × maand — de tabel waar de land×kanaal-matrix op draait, want via het
// campagnetype is de campagne de brug naar het kanaal.
//
// Afgeleid uit dezelfde landtotalen als de kaart (lib/demo/geo-demo), zodat de matrix per land
// exact optelt tot wat de kaart toont. Elke markt heeft zijn eigen campagnemix, en die mix is het
// interessante deel: Canada leunt op Display, Frankrijk krijgt alleen bereikverkeer uit Video en
// Display — geen zoekcampagne, geen Franse landingspagina, en dus geen conversies. Dat is precies
// waarom die markt in de analyse als dode markt naar boven komt.

interface CountryCampaignMix { campaignId: string; costW: number; convW: number }

const COUNTRY_CAMPAIGN_MIX: Record<string, CountryCampaignMix[]> = {
  NL: [
    { campaignId: "demo-c-grt", costW: 0.44, convW: 0.52 },
    { campaignId: "demo-c-brand", costW: 0.10, convW: 0.18 },
    { campaignId: "demo-c-pmax", costW: 0.28, convW: 0.22 },
    { campaignId: "demo-c-video", costW: 0.18, convW: 0.08 },
  ],
  US: [
    { campaignId: "demo-c-gra", costW: 0.52, convW: 0.63 },
    { campaignId: "demo-c-pmax", costW: 0.30, convW: 0.28 },
    { campaignId: "demo-c-video", costW: 0.18, convW: 0.09 },
  ],
  CA: [
    { campaignId: "demo-c-grn", costW: 0.46, convW: 0.71 },
    { campaignId: "demo-c-grn2", costW: 0.34, convW: 0.19 },
    { campaignId: "demo-c-pmax", costW: 0.20, convW: 0.10 },
  ],
  // Frankrijk: alleen bereikkanalen, geen zoekcampagne. Verkeer zonder aanbod in de eigen taal.
  FR: [
    { campaignId: "demo-c-video", costW: 0.62, convW: 0.5 },
    { campaignId: "demo-c-grn2", costW: 0.38, convW: 0.5 },
  ],
};

const CAMPAIGN_NAME_BY_ID: Record<string, string> = Object.fromEntries(CAMPAIGN_META.map((c) => [c.id, c.name]));

export function geoCampaignRows(
  clientId: string,
  countryMonthly: Array<{ code: string; month: string; impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }>,
  syncedAt: string
): Row[] {
  const rows: Row[] = [];
  for (const g of countryMonthly) {
    const mix = COUNTRY_CAMPAIGN_MIX[g.code];
    if (!mix) continue;
    const costW = mix.map((m) => m.costW);
    const convW = mix.map((m) => m.convW);
    const imp = splitInt(g.impressions, costW);
    const clk = splitInt(g.clicks, costW);
    const cost = splitInt(g.cost, costW);
    const conv = splitInt(g.conversions, convW);
    const val = splitAlong(g.conversionsValue, conv, convW);
    mix.forEach((m, i) => {
      const part = { impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i] };
      const der = derived(part);
      rows.push({
        client_id: clientId, month: g.month,
        campaign_id: m.campaignId, campaign_name: CAMPAIGN_NAME_BY_ID[m.campaignId] ?? m.campaignId,
        country_code: g.code, region_name: null, city_name: null,
        geo_target_id: `demo-geo-${g.code}`,
        ...part, ctr: der.ctr, conversion_rate: der.conversion_rate, synced_at: syncedAt,
      });
    });
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}

// ── ads_audience_performance_monthly ───────────────────────────────────────
// Observatie-doelgroepen overlappen elkaar: iemand kan tegelijk in-market én remarketing zijn.
// Ze tellen daarom BEWUST niet op tot het accounttotaal — het zijn aandelen van hetzelfde verkeer,
// geen partities ervan. Remarketing op de bezoekers van de vorige editie is de sterkste, de brede
// affiniteitsdoelgroep de zwakste; dat is de keuze die de analyse hoort te maken.

const AUDIENCES: Array<{ id: string; name: string; type: string; campaign: string; costShare: number; convShare: number }> = [
  { id: "demo-aud-remarketing", name: "Remarketing: bezoekers editie 2025", type: "REMARKETING", campaign: "GRT | Search | NL", costShare: 0.14, convShare: 0.29 },
  { id: "demo-aud-inmarket", name: "In-market: landbouwmachines", type: "IN_MARKET", campaign: "GRT | Search | NL", costShare: 0.22, convShare: 0.24 },
  { id: "demo-aud-custom", name: "Custom: bezoekers concurrerende beurzen", type: "CUSTOM", campaign: "GRA | Search | US", costShare: 0.11, convShare: 0.12 },
  { id: "demo-aud-similar", name: "Vergelijkbaar: standhouders 2025", type: "SIMILAR", campaign: "GRT | Search | NL", costShare: 0.09, convShare: 0.08 },
  { id: "demo-aud-affinity", name: "Affiniteit: groene technologie", type: "AFFINITY", campaign: "GRN | Display | Canada", costShare: 0.19, convShare: 0.05 },
  // Twee extra Display-segmenten (naast affiniteit hierboven), zodat de Doelgroep-mix-factor van
  // de Display-scorecard iets te vergelijken heeft -- één sterk (in-market), één zwak
  // (remarketing, weinig conversie op relatief veel kosten), in plaats van één segment dat nooit
  // "naar verhouding meer kost dan oplevert" kán zijn omdat het zijn eigen enige referentiepunt is.
  { id: "demo-aud-inmarket-display", name: "In-market: tuinbouwapparatuur", type: "IN_MARKET", campaign: "GRN | Display | Canada", costShare: 0.04, convShare: 0.05 },
  { id: "demo-aud-remarketing-display", name: "Remarketing: sitebezoekers zonder aanvraag", type: "REMARKETING", campaign: "GRN | Display | Canada", costShare: 0.05, convShare: 0.005 },
];

export function audiencePerformanceRows(clientId: string, accountMonthly: Row[], months: string[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  for (const raw of accountMonthly) {
    const t = totals(raw);
    if (!months.includes(t.month)) continue;
    for (const a of AUDIENCES) {
      const part = {
        impressions: Math.round(t.impressions * a.costShare),
        clicks: Math.round(t.clicks * a.costShare),
        cost: Math.round(t.cost * a.costShare),
        conversions: Math.round(t.conversions * a.convShare),
        conversions_value: Math.round(t.conversions_value * a.convShare),
      };
      const der = derived(part);
      rows.push({
        client_id: clientId, month: t.month, campaign_id: null, campaign_name: a.campaign,
        ad_group_id: null, ad_group_name: null, audience_id: a.id, audience_name: a.name,
        audience_type: a.type, ...part, ctr: der.ctr, conversion_rate: der.conversion_rate,
        synced_at: syncedAt,
      });
    }
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}

// ── ads_product_performance_monthly (Shopping) ──────────────────────────────
// Voedt de Shopping-scorecard (lib/shopping-scorecard.ts). GreenTech verkoopt zelf niets via een
// productfeed (zie de kop bij CAMPAIGNS in demo-rows.ts) -- maar een beursorganisator die ook
// exposant-merchandise via een webshop verkoopt, is een aparte, kleine en op zichzelf plausibele
// nevenstroom, niet een omkering van de kernnarratief. Vier producten, gesplitst uit de Shopping-
// campagnetotalen (afleiden, niet verzinnen): drie gezonde, één duidelijk zwak (hoge kosten,
// nauwelijks conversie) zodat de Product-efficiëntie-factor iets te vinden heeft.
const PRODUCTS: Array<{ title: string; costShare: number; clickShare: number; convShare: number }> = [
  { title: "GreenTech T-shirt Editie 2026", costShare: 0.30, clickShare: 0.34, convShare: 0.46 },
  { title: "Exposant-badge lanyard", costShare: 0.20, clickShare: 0.22, convShare: 0.32 },
  { title: "Duurzame drinkfles", costShare: 0.18, clickShare: 0.16, convShare: 0.20 },
  { title: "Beursposter (gelimiteerd)", costShare: 0.32, clickShare: 0.28, convShare: 0.02 },
];

export function productPerformanceRows(clientId: string, shoppingCampaignMonthly: Row[], syncedAt: string): Row[] {
  const rows: Row[] = [];
  for (const raw of shoppingCampaignMonthly) {
    const t = totals(raw);
    const imp = splitInt(t.impressions, PRODUCTS.map((p) => p.clickShare));
    const clk = splitInt(t.clicks, PRODUCTS.map((p) => p.clickShare));
    const cost = splitInt(t.cost, PRODUCTS.map((p) => p.costShare));
    const conv = splitInt(t.conversions, PRODUCTS.map((p) => p.convShare));
    const val = splitAlong(t.conversions_value, conv, PRODUCTS.map((p) => p.convShare));
    PRODUCTS.forEach((p, i) => {
      const part = { impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i] };
      const der = derived(part);
      rows.push({
        client_id: clientId, month: t.month, campaign_name: "GreenTech | Shopping | Merchandise",
        campaign_type: "SHOPPING", product_title: p.title, product_id: null,
        ...part, ctr: der.ctr, roas: der.roas, cost_per_conversion: der.cost_per_conversion, synced_at: syncedAt,
      });
    });
  }
  return rows.sort((a, b) => Number(b.cost) - Number(a.cost));
}
