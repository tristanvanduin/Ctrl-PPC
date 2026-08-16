// L2 facts-assemblage: combineert de rekenkern (prepared-compute) en de ICP-fit tot de
// voorgerekende feiten per stap. Het model krijgt per stap een compact feitenblok en rekent
// niet zelf. Gespiegeld op de M2 prepared-facts, met de 9 LinkedIn-stappen. Puur, geen I/O.

import {
  aggregateMonthly, deriveFromRows, computeMoMChain, trendDirection, computeVsAverage, groupBy, safeDiv,
  type LinkedInComputeRow, type DerivedMetrics,
} from "./prepared-compute";
import { computeIcpFit, isIcpEmpty, type LinkedInIcp } from "./icp-fit";
import type { LinkedInDemographicRow } from "./types";

export interface LinkedInCampaignMeta {
  entityUrn: string;
  name?: string | null;
  objective?: string | null;
  cost_type?: string | null;
  bid_strategy?: string | null;
  audience_count?: number | null;
}

export interface LinkedInCreativeMeta {
  entityUrn: string;
  format?: string | null;
}

export interface LinkedInPreparedInputs {
  account: LinkedInComputeRow[]; // linkedin_account_daily, 13 maanden
  campaigns: LinkedInComputeRow[]; // linkedin_campaign_daily (entityUrn = campagne)
  creatives: LinkedInComputeRow[]; // linkedin_creative_daily (entityUrn = creative)
  demographics?: LinkedInDemographicRow[]; // linkedin_demographic_daily
  campaignMeta?: LinkedInCampaignMeta[];
  creativeMeta?: LinkedInCreativeMeta[];
  icp?: LinkedInIcp | null;
  targets?: { cplTarget?: number | null; conversionTarget?: number | null };
}

export type LinkedInStepFacts = Record<number, unknown>;

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
function pct(value: number | null): number | null {
  return value === null ? null : round(value * 100);
}
function sumField(rows: LinkedInComputeRow[], key: keyof LinkedInComputeRow): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}
function rowsInMonth(rows: LinkedInComputeRow[], month: string | null): LinkedInComputeRow[] {
  if (!month) return rows;
  return rows.filter((r) => String(r.date || "").slice(0, 7) === month);
}
function latestMonthOf(rows: LinkedInComputeRow[]): string | null {
  const months = aggregateMonthly(rows).map((m) => m.month);
  return months.length ? months[months.length - 1] : null;
}

// Stap 1: account-MoM-keten, trends over 2 en 13 maanden, en de CPL-target-gap (lager is beter).
function buildAccountFacts(account: LinkedInComputeRow[], targets?: LinkedInPreparedInputs["targets"]): unknown {
  const monthly = aggregateMonthly(account);
  const mom = computeMoMChain(monthly);
  const latest = monthly[monthly.length - 1];
  const cpl = latest?.cpl ?? null;
  const cplTarget = targets?.cplTarget ?? null;
  const targetGap =
    cpl != null && cplTarget != null
      ? { cpl, target: cplTarget, status: cpl <= cplTarget ? "OP SCHEMA" : cpl <= cplTarget * 1.2 ? "NIET OP SCHEMA" : "KRITIEK" }
      : null;
  return {
    latest_month: mom.latest_month,
    previous_month: mom.previous_month,
    mom_chain: mom.chain,
    trend_2m: { leads: trendDirection(monthly, "leads", 2), cpl: trendDirection(monthly, "cpl", 2), ctr: trendDirection(monthly, "ctr_pct", 2) },
    trend_13m: { leads: trendDirection(monthly, "leads", 13), cpl: trendDirection(monthly, "cpl", 13) },
    target_gap: targetGap,
    months_available: monthly.length,
  };
}

// Stap 2/3: entiteiten (campagnes) versus het accountgemiddelde in de laatste maand.
function buildEntityVsAccountFacts(
  entities: LinkedInComputeRow[],
  accountBenchmark: DerivedMetrics,
  latestMonth: string | null,
  meta?: LinkedInCampaignMeta[]
): unknown {
  const byEntity = groupBy(rowsInMonth(entities, latestMonth), (r) => r.entityUrn ?? "unknown");
  const metaByUrn = new Map((meta ?? []).map((m) => [m.entityUrn, m]));
  const facts = [...byEntity.entries()].map(([urn, rows]) => {
    const d = deriveFromRows(rows);
    const m = metaByUrn.get(urn);
    return {
      entity: urn,
      name: rows[0]?.entityName ?? m?.name ?? null,
      objective: m?.objective ?? null,
      cost_type: m?.cost_type ?? null,
      leads: d.leads,
      spend: d.spend,
      cpl: computeVsAverage("CPL", d.cpl, accountBenchmark.cpl),
      ctr: computeVsAverage("CTR", d.ctr_pct, accountBenchmark.ctr_pct),
    };
  });
  return { latest_month: latestMonth, entities: facts };
}

// CTR-verval per creative als slijtage-proxy: eerste actieve dagen versus recente actieve dagen.
function ctrDecay(rows: LinkedInComputeRow[]): unknown {
  const active = rows.filter((r) => (r.impressions ?? 0) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (active.length < 6) return null;
  const window = Math.min(7, Math.floor(active.length / 2));
  const first = active.slice(0, window);
  const last = active.slice(-window);
  const firstCtr = safeDiv(sumField(first, "clicks"), sumField(first, "impressions"));
  const lastCtr = safeDiv(sumField(last, "clicks"), sumField(last, "impressions"));
  if (firstCtr === null || lastCtr === null) return null;
  return {
    first_ctr_pct: pct(firstCtr),
    last_ctr_pct: pct(lastCtr),
    decline_pct: firstCtr === 0 ? null : round(((lastCtr - firstCtr) / firstCtr) * 100),
    days_live: active.length,
  };
}

// Stap 4: creatives per format versus format- en accountgemiddelde, winnaars/bleeders, CTR-verval.
function buildCreativeFacts(
  creatives: LinkedInComputeRow[],
  accountBenchmark: DerivedMetrics,
  latestMonth: string | null,
  creativeMeta?: LinkedInCreativeMeta[]
): unknown {
  const formatByUrn = new Map((creativeMeta ?? []).map((m) => [m.entityUrn, m.format ?? "onbekend"]));
  const monthRows = rowsInMonth(creatives, latestMonth);
  const byCreative = groupBy(monthRows, (r) => r.entityUrn ?? "unknown");

  // Formatgemiddelden over de laatste maand.
  const byFormat = groupBy(monthRows, (r) => formatByUrn.get(r.entityUrn ?? "") ?? "onbekend");
  const formatAverages: Record<string, DerivedMetrics> = {};
  for (const [format, rows] of byFormat) formatAverages[format] = deriveFromRows(rows);

  const creativesFacts = [...byCreative.entries()].map(([urn, rows]) => {
    const d = deriveFromRows(rows);
    const format = formatByUrn.get(urn) ?? "onbekend";
    const fmtAvg = formatAverages[format];
    const vsAccountCtr = computeVsAverage("CTR", d.ctr_pct, accountBenchmark.ctr_pct);
    const winner = vsAccountCtr.position === "boven" && (d.cpl == null || accountBenchmark.cpl == null || d.cpl <= accountBenchmark.cpl);
    const bleeder = vsAccountCtr.position === "onder";
    return {
      creative: urn,
      format,
      label: winner ? "winnaar" : bleeder ? "bleeder" : "gemiddeld",
      ctr_vs_account: vsAccountCtr,
      ctr_vs_format: computeVsAverage("CTR", d.ctr_pct, fmtAvg?.ctr_pct ?? null),
      cpl: d.cpl,
      leads: d.leads,
      ctr_decay: ctrDecay(rows),
    };
  });
  return { latest_month: latestMonth, creatives: creativesFacts, format_averages: formatAverages, note: "Tijdsverval is de slijtage-proxy; LinkedIn geeft geen frequency per creative." };
}

// Stap 5 (kernstap): de ICP-fit per pivot, met de lege-ICP-degradatie.
function buildIcpFacts(demographics?: LinkedInDemographicRow[], icp?: LinkedInIcp | null): unknown {
  if (!demographics || demographics.length === 0) {
    return { available: false, note: "Geen demografie-data beschikbaar voor deze periode." };
  }
  const empty = isIcpEmpty(icp);
  return {
    available: true,
    icp_defined: !empty,
    degraded: empty,
    note: empty ? "Geen ICP-definitie: beschrijvend, geen fit-score." : undefined,
    pivots: computeIcpFit(demographics, icp),
  };
}

// Stap 6: de lead-gen funnel op accountniveau (open rate, completion rate, CPL).
function buildFunnelFacts(account: LinkedInComputeRow[]): unknown {
  const monthly = aggregateMonthly(account);
  const latest = monthly[monthly.length - 1];
  if (!latest) return { available: false };
  return {
    latest_month: latest.month,
    open_rate_pct: latest.open_rate_pct,
    completion_rate_pct: latest.form_completion_rate_pct,
    cpl: latest.cpl,
    form_opens: latest.form_opens,
    leads: latest.leads,
    has_leadgen: latest.form_opens > 0,
    note: latest.form_opens > 0 ? undefined : "Geen leadgen-campagnes in deze periode.",
  };
}

// F5 fase2.6: verzadigingsproxy via CPM-stijging + klikstagnatie over de laatste 30 dagen t.o.v.
// de 30 dagen daarvoor. campaignMeta.audience_count (de enige audience-omvang die de API biedt)
// is in de praktijk zo goed als altijd afwezig, dus de bestaande audience_sizes-lijst hieronder
// is meestal leeg. Deze proxy geeft ook zonder die metadata een deterministisch verzadigingssignaal.
const DAY_MS = 24 * 60 * 60 * 1000;
const SATURATION_CPM_RISE_MIN_PCT = 20; // drempel voor een "sterke" CPM-stijging
const SATURATION_CLICK_GROWTH_MAX_PCT = 5; // "stagnerend": klikgroei blijft hierbinnen (of is negatief)

function toDayMs(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}
function rowsInWindow(rows: LinkedInComputeRow[], startMs: number, endMsExclusive: number): LinkedInComputeRow[] {
  return rows.filter((r) => {
    if (!r.date) return false;
    const t = toDayMs(r.date);
    return t >= startMs && t < endMsExclusive;
  });
}
function windowDeltaPct(latest: number | null, previous: number | null): number | null {
  if (latest === null || previous === null || previous === 0) return null;
  return round(((latest - previous) / Math.abs(previous)) * 100);
}

function computeSaturationProxy30d(account: LinkedInComputeRow[]): Record<string, unknown> {
  const dates = account.map((r) => r.date).filter((d): d is string => Boolean(d)).sort();
  if (dates.length === 0) {
    return { available: false, note: "Geen accountdata om de 30-dagen verzadigingsproxy te berekenen." };
  }
  // Anker op de laatste dag mét data (niet de kalenderdatum van vandaag), zodat de proxy
  // deterministisch en op fixtures te testen is -- net als de rest van deze laag.
  const anchorMs = toDayMs(dates[dates.length - 1]);
  const recentStart = anchorMs - 29 * DAY_MS;
  const recentEndExclusive = anchorMs + DAY_MS;
  const priorStart = anchorMs - 59 * DAY_MS;
  const priorEndExclusive = recentStart;

  const recentRows = rowsInWindow(account, recentStart, recentEndExclusive);
  const priorRows = rowsInWindow(account, priorStart, priorEndExclusive);
  if (priorRows.length === 0) {
    return { available: false, note: "Onvoldoende historie (voorgaande 30 dagen) voor de verzadigingsproxy." };
  }

  const recent = deriveFromRows(recentRows);
  const prior = deriveFromRows(priorRows);
  const cpmDeltaPct = windowDeltaPct(recent.cpm, prior.cpm);
  const clickDeltaPct = windowDeltaPct(recent.clicks, prior.clicks);
  const strongCpmRise = cpmDeltaPct !== null && cpmDeltaPct > SATURATION_CPM_RISE_MIN_PCT;
  const clickStagnation = clickDeltaPct !== null && clickDeltaPct <= SATURATION_CLICK_GROWTH_MAX_PCT;

  return {
    available: true,
    recent_window: { days: recentRows.length, cpm: recent.cpm, clicks: recent.clicks },
    prior_window: { days: priorRows.length, cpm: prior.cpm, clicks: prior.clicks },
    cpm_delta_pct: cpmDeltaPct,
    click_delta_pct: clickDeltaPct,
    strong_cpm_rise: strongCpmRise,
    click_stagnation: clickStagnation,
    saturation_signal_30d: strongCpmRise && clickStagnation,
  };
}

// Stap 7: audience-omvang en verzadiging. Twee onafhankelijke signalen: de bestaande 3-maands
// CPM/CTR-trend, en de nieuwe 30-dagen CPM+klik-proxy (F5 fase2.6) die ook zonder audience_count-
// metadata werkt. Beide tellen mee: verzadiging is verzadiging, ongeacht welk signaal het ziet.
function buildAudienceFacts(account: LinkedInComputeRow[], meta?: LinkedInCampaignMeta[]): unknown {
  const monthly = aggregateMonthly(account);
  const cpmTrend = trendDirection(monthly, "cpm", 3);
  const ctrTrend = trendDirection(monthly, "ctr_pct", 3);
  const last3 = monthly.slice(-3);
  const audienceSizes = (meta ?? [])
    .filter((m) => m.audience_count != null)
    .map((m) => ({ campaign: m.entityUrn, audience_count: m.audience_count }));
  const proxy30d = computeSaturationProxy30d(account);
  const trendSignal = cpmTrend === "stijgt" && ctrTrend === "daalt";
  return {
    cpm_trend_3m: cpmTrend,
    ctr_trend_3m: ctrTrend,
    saturation_signal: trendSignal || proxy30d.saturation_signal_30d === true,
    cpm_series: last3.map((m) => ({ month: m.month, cpm: m.cpm })),
    ctr_series: last3.map((m) => ({ month: m.month, ctr: m.ctr_pct })),
    audience_sizes: audienceSizes,
    saturation_proxy_30d: proxy30d,
  };
}

// Stap 8: bidding en pacing per campagne (uit metadata; degradeert netjes zonder).
function buildBiddingFacts(meta?: LinkedInCampaignMeta[]): unknown {
  if (!meta || meta.length === 0) {
    return { available: false, note: "Bidding en pacing vereisen campagne-metadata (cost_type, bid_strategy)." };
  }
  return {
    available: true,
    campaigns: meta.map((m) => ({ campaign: m.entityUrn, name: m.name ?? null, cost_type: m.cost_type ?? null, bid_strategy: m.bid_strategy ?? null })),
  };
}

// F5 fase3: de volledige assemblage, hergegroepeerd naar 6 pijlers (was 9 losse stappen). Dit is
// uitsluitend re-plumbing van het return-object: elke buildXFacts-functie hierboven blijft
// ongewijzigd. De oude stap 2 en 3 riepen toevallig al dezelfde buildEntityVsAccountFacts-functie
// op dezelfde campagnedata aan (LinkedIn heeft geen apart campaign-group-niveau in de compute-
// laag; objective/cost_type zitten al per campagne in die ene aanroep) -- de merge roept hem dus
// nog maar één keer aan in plaats van twee keer identiek. Zie lib/analysis/adapters/linkedin-ads.ts
// voor de pijlerindeling.
export function buildLinkedinStepFacts(inputs: LinkedInPreparedInputs): LinkedInStepFacts {
  const latestMonth = latestMonthOf(inputs.account);
  const accountBenchmark = deriveFromRows(rowsInMonth(inputs.account, latestMonth));

  return {
    1: buildAccountFacts(inputs.account, inputs.targets),
    // Pijler 2: Structuur, Budget & Bidding (was stap 2 campaign groups + stap 3 campagne-
    // performance + stap 8 bidding). campagnes dekt zowel NIVEAU A als NIVEAU B.
    2: {
      campagnes: buildEntityVsAccountFacts(inputs.campaigns, accountBenchmark, latestMonth, inputs.campaignMeta),
      bidding: buildBiddingFacts(inputs.campaignMeta),
    },
    3: buildCreativeFacts(inputs.creatives, accountBenchmark, latestMonth, inputs.creativeMeta),
    // Pijler 4: Doelgroep: ICP-fit & Verzadiging (was stap 5 ICP-fit + stap 7 audience/verzadiging).
    4: {
      icp_fit: buildIcpFacts(inputs.demographics, inputs.icp),
      audience_verzadiging: buildAudienceFacts(inputs.account, inputs.campaignMeta),
    },
    5: buildFunnelFacts(inputs.account),
    6: { note: "Synthese uit stap 1 tot en met 5 en de canonical claim-set; geen nieuwe pre-compute.", account_months: aggregateMonthly(inputs.account).length },
  };
}
