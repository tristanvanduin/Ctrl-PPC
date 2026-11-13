// Vormt de dag-rijen (en voor Meta-frequentie de periode-rijen) van Meta en LinkedIn om naar de invoer van de signaal-detectors
// (lib/signals/meta-creative en linkedin-signals): per entiteit gesommeerd over een recent
// venster en een prior venster van gelijke lengte, met ratio's UIT DE VENSTERTOTALEN (dezelfde
// regel als overal). Puur en los getest; de routes leveren alleen de rijen en de namen.

import type { MetaAdSignalInput, MetaLevelSignalInput } from "@/lib/signals/meta-creative";
import type { LinkedInEntitySignalInput } from "@/lib/signals/linkedin-signals";

export const WINDOW_DAYS = 28;

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export interface MetaDailyRow {
  entity_id: string;
  date: string;
  impressions?: number | null;
  link_clicks?: number | null;
  spend?: number | null;
  conversions?: number | null;
  conversion_value?: number | null;
  frequency?: number | null;
  hook_rate?: number | null;
  hold_rate?: number | null;
  quality_ranking?: string | null;
  engagement_rate_ranking?: string | null;
  conversion_rate_ranking?: string | null;
}

export interface LinkedInDailyRow {
  entity_urn: string;
  date: string;
  impressions?: number | null;
  clicks?: number | null;
  spend?: number | null;
  one_click_leads?: number | null;
  one_click_lead_form_opens?: number | null;
  video_completions?: number | null;
  video_starts?: number | null;
}

// Een PERIODE-lezing van Meta: vertoningen en bereik over een heel venster in een aanroep, dus
// met het bereik over die periode ontdubbeld. Dat is de enige grondslag voor een frequentie die
// tegen een periodedrempel mag: het bereik van losse dagen optellen telt dezelfde persoon elke
// dag opnieuw. Bron: meta_period_reach (migratie 110), gevuld door syncMetaPeriodReach.
export interface MetaPeriodRow {
  entity_id: string;
  period_start: string;
  period_end: string;
  impressions?: number | null;
  reach?: number | null;
}

// Een periode-rij hoort bij het recente venster als hij (bijna) hetzelfde venster beslaat.
// De speling vangt sync-lag: de dagrijen lopen soms een paar dagen voor of achter op de
// periodelezing, en een venster van 26 dagen is nog steeds een eerlijke maat voor 28.
const PERIODE_SPELING_DAGEN = 3;

function periodeFrequentie(period: MetaPeriodRow[] | undefined, anchor: string | null, windowDays = WINDOW_DAYS): Map<string, number> {
  const out = new Map<string, number>();
  if (!period || !anchor) return out;
  const dag = 86_400_000;
  const anker = new Date(anchor).getTime();
  const best = new Map<string, MetaPeriodRow>();
  for (const p of period) {
    const start = new Date(p.period_start).getTime();
    const eind = new Date(p.period_end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(eind)) continue;
    const lengte = Math.round((eind - start) / dag) + 1;
    if (Math.abs(lengte - windowDays) > PERIODE_SPELING_DAGEN) continue;
    if (Math.abs(Math.round((anker - eind) / dag)) > PERIODE_SPELING_DAGEN) continue;
    const huidig = best.get(p.entity_id);
    if (!huidig || p.period_end > huidig.period_end) best.set(p.entity_id, p);
  }
  for (const [id, p] of best) {
    const imp = n(p.impressions);
    const reach = n(p.reach);
    if (imp > 0 && reach > 0) out.set(id, imp / reach);
  }
  return out;
}

interface Window<R> { recent: R[]; prior: R[] }

// Splitst dag-rijen in een recent en een prior venster van WINDOW_DAYS, gerekend vanaf de
// laatste datum in de data (niet vandaag: sync-lag mag het venster niet leeg maken).
export function splitWindows<R extends { date: string }>(rows: R[], windowDays = WINDOW_DAYS): Window<R> & { anchor: string | null } {
  if (rows.length === 0) return { recent: [], prior: [], anchor: null };
  const anchor = rows.map((r) => r.date).sort().at(-1)!;
  const anchorMs = new Date(anchor).getTime();
  const dayMs = 86_400_000;
  const recentStart = anchorMs - (windowDays - 1) * dayMs;
  const priorStart = recentStart - windowDays * dayMs;
  const recent: R[] = [];
  const prior: R[] = [];
  for (const r of rows) {
    const t = new Date(r.date).getTime();
    if (t >= recentStart) recent.push(r);
    else if (t >= priorStart) prior.push(r);
  }
  return { recent, prior, anchor };
}

interface MetaAgg {
  impressions: number; linkClicks: number; spend: number; conversions: number; conversionValue: number;
  freqWeighted: number; freqWeight: number;
  hookWeighted: number; holdWeighted: number; rateWeight: number;
  lastRankings: { quality: string | null; engagement: string | null; conversion: string | null; date: string };
}

function aggMeta(rows: MetaDailyRow[]): Map<string, MetaAgg> {
  const out = new Map<string, MetaAgg>();
  for (const r of rows) {
    const a = out.get(r.entity_id) ?? {
      impressions: 0, linkClicks: 0, spend: 0, conversions: 0, conversionValue: 0,
      freqWeighted: 0, freqWeight: 0, hookWeighted: 0, holdWeighted: 0, rateWeight: 0,
      lastRankings: { quality: null, engagement: null, conversion: null, date: "" },
    };
    const imp = n(r.impressions);
    a.impressions += imp; a.linkClicks += n(r.link_clicks); a.spend += n(r.spend);
    a.conversions += n(r.conversions); a.conversionValue += n(r.conversion_value);
    if (r.frequency != null && imp > 0) { a.freqWeighted += r.frequency * imp; a.freqWeight += imp; }
    if (imp > 0) {
      if (r.hook_rate != null) a.hookWeighted += r.hook_rate * imp;
      if (r.hold_rate != null) a.holdWeighted += r.hold_rate * imp;
      a.rateWeight += imp;
    }
    // Rankings: de meest recente niet-lege waarneming wint (kwalitatief, niet optelbaar).
    if (r.date >= a.lastRankings.date && (r.quality_ranking || r.engagement_rate_ranking || r.conversion_rate_ranking)) {
      a.lastRankings = {
        quality: r.quality_ranking ?? a.lastRankings.quality,
        engagement: r.engagement_rate_ranking ?? a.lastRankings.engagement,
        conversion: r.conversion_rate_ranking ?? a.lastRankings.conversion,
        date: r.date,
      };
    }
    out.set(r.entity_id, a);
  }
  return out;
}

/**
 * Meta-ad-dagrijen -> MetaAdSignalInput[] (recent venster, met prior-CTR/CPA voor de trend).
 *
 * `frequency` komt UITSLUITEND uit een periode-rij. Zonder periode-rij is hij null en meldt de
 * detector dat frequentie niet te beoordelen is; het gemiddelde van de dagwaarden gaat mee als
 * `dailyFrequency`, alleen om in die melding te noemen.
 */
export function shapeMetaAdInputs(rows: MetaDailyRow[], names: Map<string, { adName: string; campaignName?: string | null }>, period?: MetaPeriodRow[]): MetaAdSignalInput[] {
  const { recent, prior, anchor } = splitWindows(rows);
  const rec = aggMeta(recent);
  const pri = aggMeta(prior);
  const freq = periodeFrequentie(period, anchor);
  return [...rec.entries()].map(([entityId, a]) => {
    const p = pri.get(entityId);
    const nm = names.get(entityId);
    return {
      entityId,
      adName: nm?.adName ?? entityId,
      campaignName: nm?.campaignName ?? null,
      impressions: a.impressions,
      frequency: freq.get(entityId) ?? null,
      dailyFrequency: a.freqWeight > 0 ? a.freqWeighted / a.freqWeight : null,
      conversions: a.conversions,
      prevConversions: p ? p.conversions : 0,
      hookRate: a.rateWeight > 0 ? a.hookWeighted / a.rateWeight : null,
      holdRate: a.rateWeight > 0 ? a.holdWeighted / a.rateWeight : null,
      linkCtr: ratio(a.linkClicks, a.impressions),
      cpa: a.conversions > 0 ? a.spend / a.conversions : null,
      roas: a.spend > 0 ? a.conversionValue / a.spend : null,
      qualityRanking: a.lastRankings.quality,
      engagementRanking: a.lastRankings.engagement,
      conversionRanking: a.lastRankings.conversion,
      prevLinkCtr: p ? ratio(p.linkClicks, p.impressions) : null,
      prevCpa: p && p.conversions > 0 ? p.spend / p.conversions : null,
    };
  });
}

/** Campagne-dagrijen -> frequency-niveaus (recent venster) voor de saturatie-detector. */
export function shapeMetaLevelInputs(campaignRows: MetaDailyRow[], names: Map<string, { adName: string }>, period?: MetaPeriodRow[]): MetaLevelSignalInput[] {
  const { recent, anchor } = splitWindows(campaignRows);
  const agg = aggMeta(recent);
  const freq = periodeFrequentie(period, anchor);
  return [...agg.entries()].map(([entityId, a]) => ({
    scope: names.get(entityId)?.adName ?? entityId,
    frequency: freq.get(entityId) ?? null,
    dailyFrequency: a.freqWeight > 0 ? a.freqWeighted / a.freqWeight : null,
    impressions: a.impressions,
  }));
}

interface LiAgg { impressions: number; clicks: number; spend: number; leads: number; results: number; formOpens: number; videoStarts: number; videoCompletions: number }

export interface LinkedInShapeOptions {
  /** Campagnedoel per urn (linkedin_campaigns.objective_type), voor vergelijking binnen hetzelfde doel. */
  objectives?: Map<string, string | null>;
  /**
   * Wat als resultaat telt voor de kosten per resultaat: de ingestelde conversieselectie van de
   * klant. Zonder deze functie tellen alleen lead-formulieren, en krijgt een campagne die op
   * websiteconversies stuurt nooit een CPL-signaal, ook niet als de kosten verdubbelen.
   */
  results?: (row: LinkedInDailyRow) => number;
  resultLabel?: string;
}

function aggLi(rows: LinkedInDailyRow[], results?: (row: LinkedInDailyRow) => number): Map<string, LiAgg> {
  const out = new Map<string, LiAgg>();
  for (const r of rows) {
    const a = out.get(r.entity_urn) ?? { impressions: 0, clicks: 0, spend: 0, leads: 0, results: 0, formOpens: 0, videoStarts: 0, videoCompletions: 0 };
    a.impressions += n(r.impressions); a.clicks += n(r.clicks); a.spend += n(r.spend);
    a.leads += n(r.one_click_leads); a.formOpens += n(r.one_click_lead_form_opens);
    a.results += results ? n(results(r)) : n(r.one_click_leads);
    a.videoStarts += n(r.video_starts); a.videoCompletions += n(r.video_completions);
    out.set(r.entity_urn, a);
  }
  return out;
}

/**
 * LinkedIn-campagne-dagrijen -> LinkedInEntitySignalInput[] (ratio's uit venstertotalen).
 *
 * De kosten per resultaat (cpl) volgen `options.results`; de formulier-voltooiing blijft op
 * lead-formulieren, want alleen die hebben een formulier om af te maken.
 */
export function shapeLinkedInInputs(rows: LinkedInDailyRow[], names: Map<string, string>, options: LinkedInShapeOptions = {}): LinkedInEntitySignalInput[] {
  const { recent, prior } = splitWindows(rows);
  const rec = aggLi(recent, options.results);
  const pri = aggLi(prior, options.results);
  return [...rec.entries()].map(([urn, a]) => {
    const p = pri.get(urn);
    return {
      entityUrn: urn,
      name: names.get(urn) ?? urn,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr: ratio(a.clicks, a.impressions),
      objective: options.objectives?.get(urn) ?? null,
      results: a.results,
      prevResults: p ? p.results : 0,
      resultLabel: options.resultLabel ?? null,
      cpl: a.results > 0 ? a.spend / a.results : null,
      formOpens: a.formOpens,
      formCompletionRate: a.formOpens > 0 ? a.leads / a.formOpens : null,
      videoCompletionRate: a.videoStarts > 0 ? a.videoCompletions / a.videoStarts : null,
      prevCtr: p ? ratio(p.clicks, p.impressions) : null,
      prevCpl: p && p.results > 0 ? p.spend / p.results : null,
    };
  });
}
