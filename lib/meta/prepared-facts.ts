// M2 data-laag (fact-assemblage): zet de Meta-rijen om in de compacte voorgerekende feiten
// per SOP-stap, op de rekenkern uit prepared-compute. De route levert de rijen (uit de
// M1-tabellen) en serialiseert facts[stepNumber] in de prepared context van die stap, zodat
// het model rekent met aangeleverde getallen. Pure functies, op fixtures te testen.

import {
  aggregateMonthly,
  computeMoMChain,
  computeVsAverage,
  deriveFromRows,
  detectAdFatigue,
  groupBy,
  safeDiv,
  trendDirection,
  type DerivedMetrics,
  type MetaComputeRow,
} from "./prepared-compute";

// Breakdown-rijen (long-format uit meta_breakdown_daily) voor stap 6 en 7.
export interface MetaBreakdownComputeRow {
  date: string;
  breakdown_type: string; // publisher_platform, platform_position, impression_device, age_gender, country, region
  breakdown_value: string;
  impressions: number;
  spend: number;
  link_clicks: number;
  conversions: number;
  conversion_value: number;
}

// F5 fase2.4: geaggregeerde creative-patronen uit M3 (meta_creative_patterns), gevuld door de
// aparte meta-creatives analyze+aggregate-pipeline (vision-analyse plus statistische aggregatie).
// Al genormaliseerd op DB-niveau naar een attribuut/waarde/metric-rij; hier alleen selecteren en
// sorteren, geen herberekening.
export interface MetaCreativePatternRow {
  period_start: string;
  period_end: string;
  attribute: string;
  value: string;
  metric: "link_ctr" | "hook_rate" | "hold_rate" | "cvr" | "cpa" | "roas";
  n_ads: number;
  impressions: number;
  conversions: number | null;
  pattern_value: number;
  account_avg: number;
  lift_pct: number;
  evidence_level: "deterministic" | "inferred";
}

export interface MetaPreparedInputs {
  account: MetaComputeRow[]; // meta_account_daily, 13 maanden
  campaigns: MetaComputeRow[]; // meta_campaign_daily (entity_id = campagne)
  adsets: MetaComputeRow[]; // meta_adset_daily
  ads: MetaComputeRow[]; // meta_ad_daily
  breakdowns?: MetaBreakdownComputeRow[];
  // F5 fase2.4: patronen van de nieuwste beschikbare periode (t/m periodEnd); de route selecteert
  // die periode al voor het aanroepen van buildMetaStepFacts.
  creativePatterns?: MetaCreativePatternRow[];
  targets?: { roasTarget?: number | null; cpaTarget?: number | null };
}

export type MetaStepFacts = Record<number, unknown>;

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
function pct(value: number | null): number | null {
  return value === null ? null : round(value * 100);
}
function sumField<T>(rows: T[], key: keyof T): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}
function avgFrequency(rows: MetaComputeRow[]): number | null {
  const vals = rows.map((r) => r.frequency).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length > 0) return round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return safeDiv(sumField(rows, "impressions"), sumField(rows, "reach"));
}
function latestMonthOf(rows: MetaComputeRow[]): string | null {
  const months = aggregateMonthly(rows).map((m) => m.month);
  return months.length ? months[months.length - 1] : null;
}
function rowsInMonth(rows: MetaComputeRow[], month: string | null): MetaComputeRow[] {
  if (!month) return [];
  return rows.filter((r) => String(r.date || "").slice(0, 7) === month);
}

// Stap 1: account-performance. MoM-keten, trends, en target-gap met status.
function buildAccountFacts(account: MetaComputeRow[], targets?: MetaPreparedInputs["targets"]) {
  const monthly = aggregateMonthly(account);
  const momRes = computeMoMChain(monthly);
  const latest = monthly[monthly.length - 1];
  const trends = (["roas", "cpa", "conversions", "link_ctr_pct"] as const).map((key) => ({
    metric: key,
    trend_2m: trendDirection(monthly, key, 2),
    trend_13m: trendDirection(monthly, key, 13),
  }));

  const roasTarget = Number(targets?.roasTarget || 0);
  const cpaTarget = Number(targets?.cpaTarget || 0);
  const roasActual = latest?.roas ?? null;
  const cpaActual = latest?.cpa ?? null;
  let target: Record<string, unknown> | null = null;
  if (roasTarget > 0 && roasActual !== null) {
    const gap = round(((roasActual - roasTarget) / roasTarget) * 100);
    const status = roasActual >= roasTarget ? "OP SCHEMA" : roasActual >= roasTarget * 0.9 ? "NIET OP SCHEMA" : "KRITIEK";
    target = { type: "ROAS", target: roasTarget, actual: roasActual, gap_pct: gap, status };
  } else if (cpaTarget > 0 && cpaActual !== null) {
    const gap = round(((cpaActual - cpaTarget) / cpaTarget) * 100);
    const status = cpaActual <= cpaTarget ? "OP SCHEMA" : cpaActual <= cpaTarget * 1.1 ? "NIET OP SCHEMA" : "KRITIEK";
    target = { type: "CPA", target: cpaTarget, actual: cpaActual, gap_pct: gap, status };
  }

  return { months_available: monthly.length, latest_month: momRes.latest_month, previous_month: momRes.previous_month, mom_chain: momRes.chain, trends, target };
}

const ENTITY_KPIS: Array<{ metric: string; key: keyof DerivedMetrics }> = [
  { metric: "Link CTR", key: "link_ctr_pct" },
  { metric: "CPA", key: "cpa" },
  { metric: "ROAS", key: "roas" },
  { metric: "CVR", key: "cvr_pct" },
];

// Onder dit aantal conversies is een segment-/entiteit-uitspraak indicatief, niet stellig.
// Overgenomen uit de Microsoft-laag (pariteitsronde, 26 augustus 2026): volume als BEREKEND feit
// naast elke vergelijking, zodat de prompt "niet stellig onder de grens" op aangeleverde cijfers
// kan handhaven in plaats van op een gok.
export const VOLUME_GRENS_CONVERSIES = 10;

// Stap 2/3: entiteiten (campagnes of adsets) versus het accountgemiddelde van de laatste maand.
function buildEntityVsAccountFacts(entityRows: MetaComputeRow[], accountBenchmark: DerivedMetrics, latestMonth: string | null) {
  const byEntity = groupBy(entityRows, (r) => r.entity_id);
  const entities = [...byEntity.entries()].map(([entity_id, rows]) => {
    const latestRows = rowsInMonth(rows, latestMonth);
    const d = deriveFromRows(latestRows);
    const vs_average = ENTITY_KPIS.map(({ metric, key }) => computeVsAverage(metric, d[key] as number | null, accountBenchmark[key] as number | null));
    const mom = computeMoMChain(aggregateMonthly(rows));
    return {
      entity_id,
      entity_name: rows.find((r) => r.entity_name)?.entity_name ?? entity_id,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      cvr_pct: d.cvr_pct,
      spend: d.spend,
      conversions: d.conversions,
      frequency: avgFrequency(latestRows),
      vs_average,
      mom_link_ctr: mom.chain.find((c) => c.metric === "Link CTR")?.delta_pct ?? null,
      boven_volumegrens: d.conversions >= VOLUME_GRENS_CONVERSIES,
    };
  });
  // Sorteer op grootste afwijking van het gemiddelde (Link CTR) zodat de route makkelijk kan trimmen.
  entities.sort((a, b) => Math.abs((b.vs_average[0]?.delta_pct ?? 0)) - Math.abs((a.vs_average[0]?.delta_pct ?? 0)));
  return { account_benchmark: accountBenchmark, latest_month: latestMonth, volumegrens: VOLUME_GRENS_CONVERSIES, entities };
}

// Stap 4: creative-performance kwantitatief. Fatigue plus winnaar/bleeder versus accountgemiddelde.
function classifyAd(d: DerivedMetrics, bench: DerivedMetrics, fatigue: boolean): "winnaar" | "bleeder" | "neutraal" {
  if (d.roas !== null && bench.roas !== null && bench.roas > 0) {
    if (d.roas >= bench.roas * 1.1) return "winnaar";
    if (d.roas <= bench.roas * 0.9 || fatigue) return "bleeder";
  } else if (d.cpa !== null && bench.cpa !== null && bench.cpa > 0) {
    if (d.cpa <= bench.cpa * 0.9) return "winnaar";
    if (d.cpa >= bench.cpa * 1.1 || fatigue) return "bleeder";
  }
  return fatigue ? "bleeder" : "neutraal";
}

function buildAdFacts(ads: MetaComputeRow[], accountBenchmark: DerivedMetrics, latestMonth: string | null) {
  const fatigueByAd = new Map(detectAdFatigue(ads).map((f) => [f.entity_id, f]));
  const byAd = groupBy(ads, (r) => r.entity_id);
  const adFacts = [...byAd.entries()].map(([entity_id, rows]) => {
    const latestRows = rowsInMonth(rows, latestMonth);
    // De terugval op het volle venster is bewust: een ad die vóór de analysemaand is stopgezet
    // blijft zo zichtbaar (met zijn historie), in plaats van als rij vol nullen. Maar die
    // vol-venster-cijfers mogen nooit de stelligheidsvlag voeden -- 12 conversies verspreid over
    // een jaar zijn geen 10-in-een-maand. actief_in_maand maakt het onderscheid expliciet voor
    // het model, en de volumegrens-vlag staat voor zo'n ad altijd uit.
    const actiefInMaand = latestRows.length > 0;
    const d = deriveFromRows(actiefInMaand ? latestRows : rows);
    const fatigue = fatigueByAd.get(entity_id);
    const vs_average = ENTITY_KPIS.map(({ metric, key }) => computeVsAverage(metric, d[key] as number | null, accountBenchmark[key] as number | null));
    return {
      entity_id,
      entity_name: rows.find((r) => r.entity_name)?.entity_name ?? entity_id,
      hook_rate_pct: d.hook_rate_pct,
      hold_rate_pct: d.hold_rate_pct,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      vs_average,
      fatigue: fatigue ? { flag: fatigue.fatigue, baseline_link_ctr_pct: fatigue.baseline_link_ctr_pct, recent_link_ctr_pct: fatigue.recent_link_ctr_pct, ctr_change_pct: fatigue.ctr_change_pct, recent_frequency: fatigue.recent_frequency, days_live: fatigue.days_live } : null,
      classification: classifyAd(d, accountBenchmark, Boolean(fatigue?.fatigue)),
      conversions: d.conversions,
      actief_in_maand: actiefInMaand,
      boven_volumegrens: actiefInMaand && d.conversions >= VOLUME_GRENS_CONVERSIES,
    };
  });
  adFacts.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  return { account_benchmark: accountBenchmark, latest_month: latestMonth, volumegrens: VOLUME_GRENS_CONVERSIES, ads: adFacts };
}

// F5 fase2.4: stap 5 (Creative Visual Deep-dive) leest de vision-patronen uit M3 in plaats van
// altijd te degraderen naar de fallback. Voorkeur voor deterministic evidence boven inferred;
// gesorteerd op absolute lift, zodat de sterkste afwijkingen (in beide richtingen) bovenaan staan.
function buildCreativePatternFacts(rows: MetaCreativePatternRow[] | undefined) {
  if (!rows || rows.length === 0) {
    return { available: false, note: "Geen creative-patronen voor deze periode; draai eerst de meta-creatives analyse (analyze plus aggregate) zodat stap 5 met vision-data kan werken." };
  }
  const deterministic = rows.filter((r) => r.evidence_level === "deterministic");
  const pool = deterministic.length > 0 ? deterministic : rows;
  const top = [...pool]
    .sort((a, b) => Math.abs(b.lift_pct) - Math.abs(a.lift_pct))
    .slice(0, 10)
    .map((r) => ({
      attribute: r.attribute,
      value: r.value,
      metric: r.metric,
      n_ads: r.n_ads,
      impressions: r.impressions,
      pattern_value: r.pattern_value,
      account_avg: r.account_avg,
      lift_pct: r.lift_pct,
      evidence_level: r.evidence_level,
      direction: r.lift_pct >= 0 ? "boven" : "onder",
    }));
  return {
    available: true,
    period_start: rows[0].period_start,
    period_end: rows[0].period_end,
    patterns_total: rows.length,
    deterministic_count: deterministic.length,
    top_patterns: top,
  };
}

// Stap 6/7: breakdown-segmenten versus het accountgemiddelde, met waste- en volume-vlaggen.
//
// Op de laatste maand geankerd (pariteitsronde, 26 augustus 2026): elke andere builder in dit
// bestand filtert al op latestMonth, en de accountBenchmark waarmee vs_average vergelijkt is dat
// ook. Zonder dit anker vergeleek elk segment een 13-maands gemiddelde met een 1-maands account
// -- elke accountdrift las dan als segmentafwijking -- en telde de volume-vlag conversies over
// het hele venster tegen een grens die per maand bedoeld is.
function buildBreakdownFacts(rows: MetaBreakdownComputeRow[] | undefined, types: string[], accountBenchmark: DerivedMetrics, minConversions: number, latestMonth: string | null) {
  if (!rows || rows.length === 0) return { available: false, segments: [] as unknown[] };
  const filtered = rows.filter((r) =>
    types.includes(r.breakdown_type) && (!latestMonth || String(r.date || "").startsWith(latestMonth)));
  if (filtered.length === 0) return { available: false, segments: [] as unknown[] };
  const byValue = groupBy(filtered, (r) => `${r.breakdown_type}~~${r.breakdown_value}`);
  const segments = [...byValue.values()].map((segRows) => {
    const asCompute: MetaComputeRow[] = segRows.map((r) => ({ date: r.date, entity_id: r.breakdown_value, impressions: r.impressions, spend: r.spend, link_clicks: r.link_clicks, conversions: r.conversions, conversion_value: r.conversion_value }));
    const d = deriveFromRows(asCompute);
    return {
      breakdown_type: segRows[0].breakdown_type,
      breakdown_value: segRows[0].breakdown_value,
      spend: d.spend,
      conversions: d.conversions,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      vs_average: [computeVsAverage("Link CTR", d.link_ctr_pct, accountBenchmark.link_ctr_pct), computeVsAverage("CPA", d.cpa, accountBenchmark.cpa), computeVsAverage("ROAS", d.roas, accountBenchmark.roas)],
      waste: d.spend > 0 && d.conversions === 0,
      volume_ok: d.conversions >= minConversions,
    };
  });
  segments.sort((a, b) => b.spend - a.spend);
  return { available: true, latest_month: latestMonth, segments };
}

// F5 fase2.3: placement-waste op Audience Network. Vlagt wanneer AN een onevenredig deel van de
// publisher_platform-spend opslokt (>15%) zonder een evenredig deel van de conversies te leveren
// -- een sterker signaal dan de generieke "spend zonder conversies"-waste in buildBreakdownFacts
// hierboven, die AN met een klein maar disproportioneel conversievolume niet zou vangen.
const AN_SPEND_SHARE_FLAG_PCT = 15;

function buildAudienceNetworkWaste(rows: MetaBreakdownComputeRow[] | undefined, latestMonth: string | null) {
  if (!rows || rows.length === 0) return null;
  // Zelfde maand-anker als buildBreakdownFacts hierboven: het AN-aandeel is een uitspraak over
  // de analysemaand, niet over dertien maanden geschiedenis.
  const platformRows = rows.filter((r) =>
    r.breakdown_type === "publisher_platform" && (!latestMonth || String(r.date || "").startsWith(latestMonth)));
  if (platformRows.length === 0) return null;
  const anRows = platformRows.filter((r) => r.breakdown_value === "audience_network");
  if (anRows.length === 0) return null;
  const totalSpend = sumField(platformRows, "spend");
  const totalConversions = sumField(platformRows, "conversions");
  const anSpend = sumField(anRows, "spend");
  const anConversions = sumField(anRows, "conversions");
  const spendSharePct = pct(safeDiv(anSpend, totalSpend));
  const conversionSharePct = pct(safeDiv(anConversions, totalConversions));
  // Onevenredig: AN's aandeel in de spend ligt boven de drempel, en het aandeel in de conversies
  // haalt dat spend-aandeel niet (of er zijn helemaal geen conversies om aan toe te schrijven).
  const flagged = spendSharePct !== null && spendSharePct > AN_SPEND_SHARE_FLAG_PCT && (conversionSharePct === null || conversionSharePct < spendSharePct);
  return { spend: round(anSpend), spend_share_pct: spendSharePct, conversions: anConversions, conversion_share_pct: conversionSharePct, flagged };
}

// Stap 8: funnel-drop-offs per fase, laatste maand versus de 3-maands lijn.
const FUNNEL_STAGES: Array<{ from: string; to: string; label: string }> = [
  { from: "impressions", to: "landing_page_views", label: "Impressions naar Landing page views" },
  { from: "landing_page_views", to: "add_to_cart", label: "Landing page views naar Add to cart" },
  { from: "add_to_cart", to: "initiate_checkout", label: "Add to cart naar Initiate checkout" },
  { from: "initiate_checkout", to: "conversions", label: "Initiate checkout naar Conversies" },
];

function funnelSumsByMonth(account: MetaComputeRow[]): Map<string, Record<string, number>> {
  const byMonth = groupBy(account, (r) => String(r.date || "").slice(0, 7));
  const out = new Map<string, Record<string, number>>();
  for (const [month, rows] of byMonth) {
    out.set(month, {
      impressions: sumField(rows, "impressions"),
      landing_page_views: sumField(rows, "landing_page_views"),
      add_to_cart: sumField(rows, "add_to_cart"),
      initiate_checkout: sumField(rows, "initiate_checkout"),
      conversions: sumField(rows, "conversions"),
    });
  }
  return out;
}

function buildFunnelFacts(account: MetaComputeRow[]) {
  const byMonth = funnelSumsByMonth(account);
  const months = [...byMonth.keys()].filter(Boolean).sort();
  if (months.length === 0) return { available: false, stages: [] as unknown[] };
  const hasFunnel = months.some((m) => (byMonth.get(m)?.landing_page_views || 0) > 0 || (byMonth.get(m)?.add_to_cart || 0) > 0);
  if (!hasFunnel) return { available: false, stages: [] as unknown[] };
  const latest = byMonth.get(months[months.length - 1])!;
  const prior3 = months.slice(-4, -1).map((m) => byMonth.get(m)!).filter(Boolean);
  const dropoff = (s: Record<string, number>, from: string, to: string): number | null => {
    const f = s[from] || 0;
    const t = s[to] || 0;
    return f > 0 ? round((1 - t / f) * 100) : null;
  };
  const stages = FUNNEL_STAGES.map(({ from, to, label }) => {
    const latestDrop = dropoff(latest, from, to);
    const priorDrops = prior3.map((s) => dropoff(s, from, to)).filter((v): v is number => v !== null);
    const priorAvg = priorDrops.length ? round(priorDrops.reduce((a, b) => a + b, 0) / priorDrops.length) : null;
    return { stage: label, latest_dropoff_pct: latestDrop, prior3_dropoff_pct: priorAvg, flag_high: latestDrop !== null && latestDrop > 50 };
  });
  return { available: true, latest_month: months[months.length - 1], stages };
}

// F5 fase2.2: First-Time Impression Ratio. FTIR = delta reach / delta impressions tussen de
// laatste twee maanden. Een lage ratio betekent dat de impressiegroei vooral naar mensen gaat
// die al eerder bereikt zijn (audience/Advantage+ verzadiging); een hoge ratio betekent dat de
// meeste nieuwe impressies bij nieuw bereik terechtkomen, dus is een dalende CTR/hold rate dan
// eerder creative fatigue dan verzadiging. Vaste drempels uit de stakeholder-brief.
const FTIR_SATURATION_MAX = 0.25;
const FTIR_FATIGUE_MIN = 0.4;

interface FtirPeriod {
  ftir: number | null;
  latest_month: string | null;
  previous_month: string | null;
  delta_reach: number | null;
  delta_impressions: number | null;
}

function computeFtir(monthly: ReturnType<typeof aggregateMonthly>): FtirPeriod {
  if (monthly.length < 2) {
    return { ftir: null, latest_month: monthly[0]?.month ?? null, previous_month: null, delta_reach: null, delta_impressions: null };
  }
  const latest = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const deltaReach = latest.reach - previous.reach;
  const deltaImpressions = latest.impressions - previous.impressions;
  // Alleen zinvol bij groeiende impressies; bij vlakke/dalende impressies zegt de ratio niets
  // over verzadiging (de vraag is dan al beantwoord: er is geen nieuwe frequentie-druk).
  const ftir = deltaImpressions > 0 ? round(deltaReach / deltaImpressions, 4) : null;
  return { ftir, latest_month: latest.month, previous_month: previous.month, delta_reach: deltaReach, delta_impressions: deltaImpressions };
}

type FtirSignal = "audience_verzadiging" | "creative_fatigue" | "geen_duidelijk_signaal";

function classifyFtir(ftir: number | null, cpaRising: boolean, freqRising: boolean, ctrFalling: boolean, holdRateFalling: boolean): FtirSignal {
  if (ftir === null) return "geen_duidelijk_signaal";
  if (ftir < FTIR_SATURATION_MAX && (cpaRising || freqRising)) return "audience_verzadiging";
  if (ftir > FTIR_FATIGUE_MIN && (ctrFalling || holdRateFalling)) return "creative_fatigue";
  return "geen_duidelijk_signaal";
}

// Stap 9: frequency-trend versus CTR-trend op accountniveau, plus FTIR-gebaseerde detectie die
// audience-verzadiging onderscheidt van creative fatigue.
function buildFrequencyFacts(account: MetaComputeRow[]) {
  const monthly = aggregateMonthly(account);
  const freqByMonth = groupBy(account, (r) => String(r.date || "").slice(0, 7));
  const freqSeries = [...freqByMonth.keys()].filter(Boolean).sort().map((m) => avgFrequency(freqByMonth.get(m) ?? []));
  const firstFreq = freqSeries.find((v) => v !== null) ?? null;
  const lastFreq = [...freqSeries].reverse().find((v) => v !== null) ?? null;

  const ftirRes = computeFtir(monthly);
  const latestMonthly = monthly.length ? monthly[monthly.length - 1] : null;
  const previousMonthly = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const latestFreq = freqSeries.length ? freqSeries[freqSeries.length - 1] : null;
  const previousFreq = freqSeries.length >= 2 ? freqSeries[freqSeries.length - 2] : null;

  const cpaRising = latestMonthly?.cpa != null && previousMonthly?.cpa != null && latestMonthly.cpa > previousMonthly.cpa;
  const freqRising = latestFreq !== null && previousFreq !== null && latestFreq > previousFreq;
  const ctrFalling = latestMonthly?.link_ctr_pct != null && previousMonthly?.link_ctr_pct != null && latestMonthly.link_ctr_pct < previousMonthly.link_ctr_pct;
  const holdRateFalling = latestMonthly?.hold_rate_pct != null && previousMonthly?.hold_rate_pct != null && latestMonthly.hold_rate_pct < previousMonthly.hold_rate_pct;
  const ftir_signal = classifyFtir(ftirRes.ftir, cpaRising, freqRising, ctrFalling, holdRateFalling);

  return {
    frequency_first: firstFreq,
    frequency_latest: lastFreq,
    frequency_trend: trendDirection(monthly.map((m, i) => ({ ...m, link_ctr_pct: freqSeries[i] ?? null })), "link_ctr_pct", monthly.length),
    link_ctr_trend: trendDirection(monthly, "link_ctr_pct", monthly.length),
    ftir: ftirRes.ftir,
    ftir_period: { latest_month: ftirRes.latest_month, previous_month: ftirRes.previous_month, delta_reach: ftirRes.delta_reach, delta_impressions: ftirRes.delta_impressions },
    ftir_inputs: { cpa_rising: cpaRising, frequency_rising: freqRising, link_ctr_falling: ctrFalling, hold_rate_falling: holdRateFalling },
    ftir_signal,
    saturation_signal: ftir_signal === "audience_verzadiging",
  };
}

const WEEKDAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

// Stap 10: weekdagpatroon versus het overall gemiddelde.
function buildScheduleFacts(account: MetaComputeRow[]) {
  const byWeekday = groupBy(account.filter((r) => r.date), (r) => String(new Date(r.date + "T00:00:00Z").getUTCDay()));
  const overall = deriveFromRows(account);
  const days = [...byWeekday.entries()].map(([wd, rows]) => {
    const d = deriveFromRows(rows);
    return {
      weekday: WEEKDAYS[Number(wd)] ?? wd,
      link_ctr_pct: d.link_ctr_pct,
      cpa: d.cpa,
      roas: d.roas,
      vs_average: [computeVsAverage("Link CTR", d.link_ctr_pct, overall.link_ctr_pct), computeVsAverage("CPA", d.cpa, overall.cpa)],
    };
  });
  const material = days.some((day) => day.vs_average.some((v) => v.delta_pct !== null && Math.abs(v.delta_pct) > 15));
  return { material_signal: material, days };
}

// F5 fase3: pijler 4 bundelt twee breakdown-subdomeinen die elk individueel `available: false`
// kunnen zijn (buildBreakdownFacts) wanneer meta_breakdown_daily niet gesynct is voor dat
// breakdown_type. De hard-skip-laag (F5 fase1.4, isChannelStepFactsUnavailable in de route) kijkt
// naar een top-level `available`-veld; die zet deze functie alleen op false wanneer ECHT beide
// subdomeinen niets hebben, zodat een LLM-call niet wordt overgeslagen zolang er nog iets te
// duiden valt in het andere subdomein.
function combinePlacementAndDemographics(
  placement: Record<string, unknown>,
  demografieGeo: Record<string, unknown>
): Record<string, unknown> {
  const placementAvailable = placement.available !== false;
  const demografieAvailable = demografieGeo.available !== false;
  if (!placementAvailable && !demografieAvailable) {
    return { available: false, note: "Geen breakdown-data (placement, platform, demografie of geo) beschikbaar voor deze periode.", placement, demografie_geo: demografieGeo };
  }
  return { placement, demografie_geo: demografieGeo };
}

// F5 fase3: de volledige assemblage, hergegroepeerd naar 6 pijlers (was 11 losse stappen). Dit
// is uitsluitend re-plumbing van het return-object: elke buildXFacts-functie hierboven blijft
// ongewijzigd en wordt nog precies één keer aangeroepen; alleen de sleutel waaronder de uitkomst
// wordt aangeboden verandert. Zie lib/analysis/adapters/meta-ads.ts voor de pijlerindeling.
export function buildMetaStepFacts(inputs: MetaPreparedInputs): MetaStepFacts {
  const accountMonthly = aggregateMonthly(inputs.account);
  const latestMonth = latestMonthOf(inputs.account);
  const accountBenchmark = deriveFromRows(rowsInMonth(inputs.account, latestMonth));

  return {
    1: buildAccountFacts(inputs.account, inputs.targets),
    // Pijler 2: Structuur & Budget (was stap 2 campagnes + stap 3 ad sets).
    2: {
      campagnes: buildEntityVsAccountFacts(inputs.campaigns, accountBenchmark, latestMonth),
      ad_sets: buildEntityVsAccountFacts(inputs.adsets, accountBenchmark, latestMonth),
    },
    // Pijler 3: Creative & Visual (was stap 4 kwantitatief + stap 5 visueel).
    3: {
      creative_performance: buildAdFacts(inputs.ads, accountBenchmark, latestMonth),
      visual_patterns: buildCreativePatternFacts(inputs.creativePatterns),
    },
    // Pijler 4: Placement & Doelgroep-segmenten (was stap 6 placement + stap 7 demografie/geo).
    // Placement kreeg minConversions 0 (volume_ok altijd waar); sinds de pariteitsronde geldt
    // dezelfde grens als demografie en als de andere kanalen -- een placement-oordeel op 3
    // conversies is net zo wankel als een leeftijds-oordeel op 3.
    4: combinePlacementAndDemographics(
      { ...buildBreakdownFacts(inputs.breakdowns, ["publisher_platform", "platform_position", "impression_device"], accountBenchmark, VOLUME_GRENS_CONVERSIES, latestMonth), audience_network_waste: buildAudienceNetworkWaste(inputs.breakdowns, latestMonth) },
      buildBreakdownFacts(inputs.breakdowns, ["age_gender", "country", "region", "dma"], accountBenchmark, VOLUME_GRENS_CONVERSIES, latestMonth)
    ),
    // Pijler 5: Funnel, Verzadiging & Schedule (was stap 8 funnel + stap 9 frequency + stap 10 schedule).
    5: {
      funnel: buildFunnelFacts(inputs.account),
      frequency_verzadiging: buildFrequencyFacts(inputs.account),
      schedule: buildScheduleFacts(inputs.account),
    },
    6: { note: "Synthese uit stap 1 tot en met 5 en de canonical claim-set; geen nieuwe pre-compute.", account_months: accountMonthly.length },
  };
}
