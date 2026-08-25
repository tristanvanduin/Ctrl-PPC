// Microsoft Ads prepared facts: de deterministische feitenlaag per pijler. Elke pijler van de
// maandanalyse krijgt zijn getallen HIER voorgerekend; het model rekent niet zelf (zelfde
// contract als lib/meta/prepared-facts.ts en lib/linkedin/prepared-facts.ts).
//
// Het available:false-contract: alleen een TOP-level { available: false, note } laat de route de
// pijler hard overslaan met een nette fallback (isChannelStepFactsUnavailable in de monthly-route
// leest uitsluitend top-level). Genest available:false betekent "dit sub-domein ontbreekt" en de
// pijler draait door met wat er wel is. Hier geldt dat:
//   pijler 3 top-level onbeschikbaar is zonder keyword-data -- een keyword-pijler zonder keywords
//     kan niets dan verzinnen;
//   pijler 4 top-level onbeschikbaar is als profiel EN breakdowns allebei ontbreken (het
//     combineer-patroon van Meta's pijler 4);
//   pijler 5 nooit hard skipt: niveau C (schedule) kan altijd uit de accountdagen.
//
// Volumediscipline is hier een BEREKEND feit, geen promptwens: elk segment draagt zijn conversie-
// volume en een boven/onder-de-grens-vlag, zodat de prompt "niet stellig onder de grens" kan
// handhaven op aangeleverde cijfers in plaats van op een gok.

import {
  aggregateMonthly, computeMoMChain, computeVsAverage, deriveFromRows, groupBy, safeDiv,
  trendDirection, type DerivedMetrics, type MicrosoftComputeRow, type MonthlyMetrics,
} from "./prepared-compute";

// Onder dit aantal conversies is een segment-uitspraak indicatief, niet stellig. De vuistregel
// uit MICROSOFT_BENCHMARKS ("stellige uitspraken vanaf ~10 conversies per segment").
export const VOLUME_GRENS_CONVERSIES = 10;

export interface MicrosoftCampaignMeta {
  campaign_id: string;
  name: string;
  campaign_type?: string | null;
  daily_budget?: number | null;
  bid_strategy?: string | null;
  import_source?: string | null;
  serving_status?: string | null;
}

export interface MicrosoftKeywordRow {
  keyword_text: string;
  match_type?: string | null;
  campaign_name?: string | null;
  ad_group_name?: string | null;
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  quality_score?: number | null;
}

export interface MicrosoftSearchTermRow {
  search_term: string;
  campaign_name?: string | null;
  ad_group_name?: string | null;
  month: string;
  clicks: number;
  cost: number;
  conversions: number;
}

export interface MicrosoftImpressionShareRow {
  campaign_name: string;
  month: string;
  impression_share: number | null;
  budget_lost_is: number | null;
  rank_lost_is: number | null;
}

export interface MicrosoftBreakdownRow {
  date: string | null;
  breakdown_type: string; // "network" | "device"
  breakdown_value: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}

export interface MicrosoftProfileRow {
  month: string;
  pivot_type: string; // "industry" | "company" | "job_function"
  pivot_value: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}

export interface MicrosoftPreparedInputs {
  account: MicrosoftComputeRow[];
  campaigns: MicrosoftComputeRow[];
  adgroups: MicrosoftComputeRow[];
  campaignMeta?: MicrosoftCampaignMeta[];
  keywords?: MicrosoftKeywordRow[];
  searchTerms?: MicrosoftSearchTermRow[];
  impressionShare?: MicrosoftImpressionShareRow[];
  breakdowns?: MicrosoftBreakdownRow[];
  profile?: MicrosoftProfileRow[];
  targets?: { roasTarget?: number | null; cpaTarget?: number | null };
}

export type MicrosoftStepFacts = Record<number, unknown>;

function round(v: number | null, dp = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}
function pctVal(ratio: number | null): number | null {
  return ratio == null ? null : round(ratio * 100);
}
function latestMonthOf(rows: { month: string }[]): string | null {
  const maanden = [...new Set(rows.map((r) => r.month.slice(0, 7)))].sort();
  return maanden.at(-1) ?? null;
}

// ── Pijler 1: Account Performance ───────────────────────────────────────────
function buildAccountFacts(account: MicrosoftComputeRow[], targets?: MicrosoftPreparedInputs["targets"]) {
  const monthly = aggregateMonthly(account);
  const mom = computeMoMChain(monthly);
  const latest = monthly.at(-1) ?? null;

  const trends = (["roas", "cpa", "conversions", "ctr_pct"] as (keyof DerivedMetrics)[]).map((key) => ({
    metric: key,
    trend_2m: trendDirection(monthly, key, 2),
    trend_13m: trendDirection(monthly, key, 13),
  }));

  let target: unknown = null;
  const roasTarget = targets?.roasTarget ?? null;
  const cpaTarget = targets?.cpaTarget ?? null;
  if (latest && roasTarget != null && roasTarget > 0 && latest.roas != null) {
    const gap = ((latest.roas - roasTarget) / roasTarget) * 100;
    target = { metric: "ROAS", target: roasTarget, actual: latest.roas, gap_pct: round(gap), status: gap >= 0 ? "OP SCHEMA" : gap > -20 ? "NIET OP SCHEMA" : "KRITIEK" };
  } else if (latest && cpaTarget != null && cpaTarget > 0 && latest.cpa != null) {
    const gap = ((cpaTarget - latest.cpa) / cpaTarget) * 100; // positief = beter dan target
    target = { metric: "CPA", target: cpaTarget, actual: latest.cpa, gap_pct: round(gap), status: gap >= 0 ? "OP SCHEMA" : gap > -20 ? "NIET OP SCHEMA" : "KRITIEK" };
  }

  return {
    months_available: monthly.length,
    latest_month: mom.latest_month,
    previous_month: mom.previous_month,
    mom_chain: mom.chain,
    trends,
    target,
    // De volumediscipline als aangeleverd feit: het absolute conversievolume van de laatste
    // maand, met de grens ernaast. "+40%" zonder dit getal is op dit kanaal niets waard.
    volume: latest ? {
      latest_month_conversions: latest.conversions,
      volumegrens: VOLUME_GRENS_CONVERSIES,
      boven_grens: latest.conversions >= VOLUME_GRENS_CONVERSIES,
    } : null,
  };
}

// ── Entiteit-versus-account (pijler 2, campagnes en ad groups) ──────────────
const ENTITY_KPIS: Array<{ metric: string; key: keyof DerivedMetrics }> = [
  { metric: "CTR", key: "ctr_pct" },
  { metric: "CPA", key: "cpa" },
  { metric: "ROAS", key: "roas" },
  { metric: "CVR", key: "cvr_pct" },
];

function buildEntityVsAccountFacts(rows: MicrosoftComputeRow[], accountBenchmark: DerivedMetrics, latestMonth: string | null) {
  const perEntity = groupBy(rows, (r) => r.entityId ?? "");
  const entities = [...perEntity.entries()]
    .filter(([id]) => id !== "")
    .map(([id, entityRows]) => {
      const inMonth = latestMonth ? entityRows.filter((r) => String(r.date || "").startsWith(latestMonth)) : entityRows;
      const derived = deriveFromRows(inMonth);
      return {
        entity_id: id,
        entity_name: entityRows.find((r) => r.entityName)?.entityName ?? id,
        ...derived,
        vs_average: ENTITY_KPIS.map(({ metric, key }) => computeVsAverage(metric, derived[key] as number | null, accountBenchmark[key] as number | null)),
        boven_volumegrens: derived.conversions >= VOLUME_GRENS_CONVERSIES,
      };
    })
    .filter((e) => e.spend > 0 || e.impressions > 0)
    .sort((a, b) => b.spend - a.spend);
  return { account_benchmark: accountBenchmark, latest_month: latestMonth, entities };
}

// ── Pijler 2, niveau B: import-pariteit ─────────────────────────────────────
//
// Vergelijkt geimporteerde campagnes (import_source gezet) met native campagnes op CPA in de
// laatste maand. De vergelijking is alleen stellig als beide groepen de volumegrens halen; anders
// gaat hij als indicatief mee. Geen campaignMeta of geen imports: genest available:false met een
// note -- de pijler draait door op niveau A.
function buildImportParityFacts(
  campaigns: MicrosoftComputeRow[],
  campaignMeta: MicrosoftCampaignMeta[] | undefined,
  latestMonth: string | null
) {
  if (!campaignMeta || campaignMeta.length === 0) {
    return { available: false as const, note: "Geen campagne-metadata beschikbaar; import-pariteit niet te beoordelen." };
  }
  const imports = campaignMeta.filter((c) => (c.import_source ?? "").trim() !== "");
  if (imports.length === 0) {
    return { available: false as const, note: "Geen geimporteerde campagnes in dit account." };
  }
  const importIds = new Set(imports.map((c) => c.campaign_id));
  const inMonth = (rows: MicrosoftComputeRow[]) =>
    latestMonth ? rows.filter((r) => String(r.date || "").startsWith(latestMonth)) : rows;
  const geimporteerd = deriveFromRows(inMonth(campaigns.filter((r) => importIds.has(r.entityId ?? ""))));
  const native = deriveFromRows(inMonth(campaigns.filter((r) => !importIds.has(r.entityId ?? ""))));
  const deltaCpa = geimporteerd.cpa != null && native.cpa != null && native.cpa > 0
    ? round(((geimporteerd.cpa - native.cpa) / native.cpa) * 100)
    : null;
  return {
    imported_campaigns: imports.map((c) => ({
      campaign_id: c.campaign_id, name: c.name, import_source: c.import_source,
      bid_strategy: c.bid_strategy ?? null, daily_budget: c.daily_budget ?? null,
    })),
    import_benchmark: geimporteerd,
    native_benchmark: native,
    cpa_delta_pct_import_vs_native: deltaCpa,
    stellig: geimporteerd.conversions >= VOLUME_GRENS_CONVERSIES && native.conversions >= VOLUME_GRENS_CONVERSIES,
  };
}

// ── Pijler 3: keywords en zoektermen ────────────────────────────────────────
function buildKeywordFacts(keywords: MicrosoftKeywordRow[], accountBenchmark: DerivedMetrics) {
  const laatste = latestMonthOf(keywords);
  const recent = laatste ? keywords.filter((k) => k.month.startsWith(laatste)) : keywords;
  const accountCpa = accountBenchmark.cpa;

  const perKeyword = recent.map((k) => ({
    keyword: k.keyword_text,
    match_type: k.match_type ?? null,
    campaign_name: k.campaign_name ?? null,
    quality_score: k.quality_score ?? null,
    clicks: k.clicks,
    cost: round(k.cost) ?? 0,
    conversions: k.conversions,
    cpa: round(safeDiv(k.cost, k.conversions)),
    vs_account_cpa: accountCpa != null && k.conversions > 0
      ? computeVsAverage("CPA", safeDiv(k.cost, k.conversions), accountCpa)
      : null,
  }));

  const bleeders = perKeyword.filter((k) => accountCpa != null && k.conversions === 0 && k.cost > 2 * accountCpa)
    .sort((a, b) => b.cost - a.cost);
  const winnaars = perKeyword.filter((k) => k.conversions >= 2 && k.cpa != null && accountCpa != null && k.cpa < accountCpa)
    .sort((a, b) => (a.cpa ?? 0) - (b.cpa ?? 0)).slice(0, 10);

  const matchMix = [...groupBy(recent, (k) => (k.match_type ?? "onbekend").toLowerCase()).entries()]
    .map(([type, rows]) => ({
      match_type: type,
      cost: round(rows.reduce((s, r) => s + r.cost, 0)) ?? 0,
      conversions: rows.reduce((s, r) => s + r.conversions, 0),
    }))
    .sort((a, b) => b.cost - a.cost);

  const lageQs = perKeyword.filter((k) => k.quality_score != null && k.quality_score < 5)
    .sort((a, b) => b.cost - a.cost).slice(0, 10);

  return { latest_month: laatste, account_cpa: accountCpa, winnaars, bleeders, match_type_mix: matchMix, lage_quality_score: lageQs, keywords_totaal: recent.length };
}

function buildSearchTermFacts(searchTerms: MicrosoftSearchTermRow[] | undefined) {
  if (!searchTerms || searchTerms.length === 0) {
    return { available: false as const, note: "Geen zoektermdata in deze periode." };
  }
  const laatste = latestMonthOf(searchTerms);
  const recent = laatste ? searchTerms.filter((t) => t.month.startsWith(laatste)) : searchTerms;
  const vervuilers = recent.filter((t) => t.conversions === 0 && t.cost > 0)
    .sort((a, b) => b.cost - a.cost).slice(0, 20)
    .map((t) => ({ search_term: t.search_term, campaign_name: t.campaign_name ?? null, clicks: t.clicks, cost: round(t.cost) ?? 0 }));
  const totalWaste = round(recent.filter((t) => t.conversions === 0).reduce((s, t) => s + t.cost, 0)) ?? 0;
  const goed = recent.filter((t) => t.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 10)
    .map((t) => ({ search_term: t.search_term, conversions: t.conversions, cost: round(t.cost) ?? 0 }));
  return { latest_month: laatste, vervuilers, totale_verspilling: totalWaste, best_converterend: goed, termen_totaal: recent.length };
}

// ── Pijler 4: profiel en device ─────────────────────────────────────────────
function buildProfileFacts(profile: MicrosoftProfileRow[] | undefined, accountBenchmark: DerivedMetrics) {
  if (!profile || profile.length === 0) {
    return { available: false as const, note: "Geen LinkedIn-profieldata (industry/company/function) in deze periode." };
  }
  const laatste = latestMonthOf(profile);
  const recent = laatste ? profile.filter((p) => p.month.startsWith(laatste)) : profile;
  const accountCpa = accountBenchmark.cpa;

  const perPivot: Record<string, unknown[]> = {};
  for (const [pivot, rows] of groupBy(recent, (p) => p.pivot_type)) {
    perPivot[pivot] = [...groupBy(rows, (p) => p.pivot_value).entries()].map(([waarde, segRows]) => {
      const spend = segRows.reduce((s, r) => s + r.spend, 0);
      const conversions = segRows.reduce((s, r) => s + r.conversions, 0);
      const cpa = safeDiv(spend, conversions);
      return {
        segment: waarde,
        spend: round(spend) ?? 0,
        conversions,
        cpa: round(cpa),
        vs_account_cpa: accountCpa != null ? computeVsAverage("CPA", cpa, accountCpa) : null,
        boven_volumegrens: conversions >= VOLUME_GRENS_CONVERSIES,
      };
    }).sort((a, b) => (b.spend as number) - (a.spend as number));
  }
  return { latest_month: laatste, volumegrens: VOLUME_GRENS_CONVERSIES, pivots: perPivot };
}

function buildBreakdownFacts(breakdowns: MicrosoftBreakdownRow[] | undefined, type: string, accountBenchmark: DerivedMetrics) {
  const rows = (breakdowns ?? []).filter((b) => b.breakdown_type === type);
  if (rows.length === 0) {
    return { available: false as const, note: `Geen ${type}-breakdown in deze periode.`, segments: [] };
  }
  const totaalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totaalConv = rows.reduce((s, r) => s + r.conversions, 0);
  const segments = [...groupBy(rows, (b) => b.breakdown_value).entries()].map(([waarde, segRows]) => {
    const spend = segRows.reduce((s, r) => s + r.spend, 0);
    const conversions = segRows.reduce((s, r) => s + r.conversions, 0);
    const cpa = safeDiv(spend, conversions);
    return {
      segment: waarde,
      spend: round(spend) ?? 0,
      conversions: round(conversions) ?? 0,
      spend_share_pct: pctVal(safeDiv(spend, totaalSpend)),
      conversion_share_pct: pctVal(safeDiv(conversions, totaalConv)),
      cpa: round(cpa),
      vs_account_cpa: accountBenchmark.cpa != null ? computeVsAverage("CPA", cpa, accountBenchmark.cpa) : null,
      boven_volumegrens: conversions >= VOLUME_GRENS_CONVERSIES,
    };
  }).sort((a, b) => (b.spend as number) - (a.spend as number));
  return { segments };
}

// ── Pijler 5: netwerk, impressieaandeel, schedule ───────────────────────────
function buildNetworkFacts(breakdowns: MicrosoftBreakdownRow[] | undefined, accountBenchmark: DerivedMetrics) {
  const feiten = buildBreakdownFacts(breakdowns, "network", accountBenchmark);
  if ("available" in feiten && feiten.available === false) return feiten;
  const segments = feiten.segments as Array<Record<string, unknown>>;
  const search = segments.find((s) => String(s.segment).toLowerCase() === "search");
  const searchCpa = (search?.cpa as number | null) ?? null;
  return {
    segments: segments.map((s) => ({
      ...s,
      // Het lek-criterium uit de adapter: meer dan 10% van spend bij een CPA boven 2x search.
      cpa_vs_search: searchCpa != null && s.cpa != null ? round(((s.cpa as number) / searchCpa)) : null,
      lek: searchCpa != null && s.cpa != null && (s.spend_share_pct as number | null) != null
        ? (s.cpa as number) > 2 * searchCpa && (s.spend_share_pct as number) > 10
        : false,
    })),
    search_cpa: searchCpa,
  };
}

function buildImpressionShareFacts(impressionShare: MicrosoftImpressionShareRow[] | undefined) {
  if (!impressionShare || impressionShare.length === 0) {
    return { available: false as const, note: "Geen impressieaandeel-data in deze periode." };
  }
  const campagnes = [...groupBy(impressionShare, (r) => r.campaign_name).entries()].map(([naam, rows]) => {
    const maanden = rows.sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({
      month: r.month.slice(0, 7),
      impression_share: r.impression_share,
      budget_lost: r.budget_lost_is,
      rank_lost: r.rank_lost_is,
    }));
    const eerste = maanden[0];
    const laatste = maanden.at(-1);
    return {
      campaign_name: naam,
      maanden,
      budget_lost_trend: eerste && laatste && eerste.budget_lost != null && laatste.budget_lost != null
        ? round(laatste.budget_lost - eerste.budget_lost)
        : null,
    };
  });
  return { campagnes, maanden_beschikbaar: [...new Set(impressionShare.map((r) => r.month.slice(0, 7)))].sort().length };
}

function buildScheduleFacts(account: MicrosoftComputeRow[]) {
  const metDatum = account.filter((r) => r.date);
  if (metDatum.length === 0) return { available: false as const, note: "Geen dagdata voor schedule-analyse." };
  const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
  const perDag = groupBy(metDatum, (r) => WEEKDAGEN[new Date(String(r.date) + "T00:00:00Z").getUTCDay()]);
  const totaal = deriveFromRows(metDatum);
  const dagen = [...perDag.entries()].map(([dag, rows]) => {
    const d = deriveFromRows(rows);
    return { weekdag: dag, conversions: d.conversions, cpa: d.cpa, vs_account_cpa: totaal.cpa != null ? computeVsAverage("CPA", d.cpa, totaal.cpa) : null };
  });
  const volgorde = new Map(WEEKDAGEN.map((d, i) => [d, i]));
  dagen.sort((a, b) => (volgorde.get(a.weekdag) ?? 0) - (volgorde.get(b.weekdag) ?? 0));
  return { weekdagen: dagen };
}

// ── De zes pijlers samen ────────────────────────────────────────────────────
export function buildMicrosoftStepFacts(inputs: MicrosoftPreparedInputs): MicrosoftStepFacts {
  const accountMonthly = aggregateMonthly(inputs.account);
  const latestMonth = accountMonthly.at(-1)?.month ?? null;
  const accountBenchmark = deriveFromRows(
    latestMonth ? inputs.account.filter((r) => String(r.date || "").startsWith(latestMonth)) : inputs.account
  );

  // Pijler 3: zonder keyword-data valt de hele pijler hard uit -- een keyword-analyse zonder
  // keywords kan alleen verzinnen, en de nette fallback-zin is dan eerlijker dan een LLM-call.
  const pijler3 = inputs.keywords && inputs.keywords.length > 0
    ? { keywords: buildKeywordFacts(inputs.keywords, accountBenchmark), zoektermen: buildSearchTermFacts(inputs.searchTerms) }
    : { available: false as const, note: "Geen keyword-data in deze periode; keywords en zoektermen niet te beoordelen." };

  // Pijler 4: het combineer-patroon van Meta -- alleen top-level onbeschikbaar als beide
  // sub-domeinen ontbreken.
  const profiel = buildProfileFacts(inputs.profile, accountBenchmark);
  const device = buildBreakdownFacts(inputs.breakdowns, "device", accountBenchmark);
  const profielOntbreekt = "available" in profiel && profiel.available === false;
  const deviceOntbreekt = "available" in device && device.available === false;
  const pijler4 = profielOntbreekt && deviceOntbreekt
    ? { available: false as const, note: "Geen profiel- en geen device-data in deze periode.", profiel, demografie_device: device }
    : { profiel, demografie_device: device };

  return {
    1: buildAccountFacts(inputs.account, inputs.targets),
    2: {
      campagnes: buildEntityVsAccountFacts(inputs.campaigns, accountBenchmark, latestMonth),
      ad_groups: buildEntityVsAccountFacts(inputs.adgroups, accountBenchmark, latestMonth),
      budget_en_bieden: (inputs.campaignMeta ?? []).map((c) => ({
        campaign_id: c.campaign_id, name: c.name, daily_budget: c.daily_budget ?? null,
        bid_strategy: c.bid_strategy ?? null, campaign_type: c.campaign_type ?? null,
        import_source: c.import_source ?? null,
      })),
      import_pariteit: buildImportParityFacts(inputs.campaigns, inputs.campaignMeta, latestMonth),
    },
    3: pijler3,
    4: pijler4,
    5: {
      netwerk: buildNetworkFacts(inputs.breakdowns, accountBenchmark),
      impressieaandeel: buildImpressionShareFacts(inputs.impressionShare),
      schedule: buildScheduleFacts(inputs.account),
    },
    6: { note: "Synthese uit voorgaande pijlers; geen eigen pre-compute.", account_months: accountMonthly.length },
  };
}
