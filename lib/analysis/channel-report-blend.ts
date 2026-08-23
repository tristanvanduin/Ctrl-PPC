// Pure rekenkern achter de multi-kanaal client-reports (23 augustus 2026). Uitgetrokken uit
// app/api/client-reports/route.ts zodat de aggregatie- en optellogica los van de route (LLM-calls,
// Supabase-fetches, voortgangsjob) getest kan worden -- zie __channel_report_blend_test.ts.
//
// Doel: dag-cijfers van Meta/LinkedIn (meta_account_daily/linkedin_account_daily) omzetten naar
// maandrijen in dezelfde vorm als ads_account_monthly (Google), en die vervolgens optellen tot een
// blended maandserie. findMonth()/g()/buildChartData() in de route werken zo ongewijzigd door, of
// de rij nou van Google, Meta, LinkedIn komt of samengeteld is -- ratio's (ctr/avg_cpc/
// conversion_rate) worden herberekend uit de opgetelde tellers, nooit gemiddeld over ratio's.

import { sumSelectedConversions, type ChannelConversionChannel, type ChannelConversionConfig } from "./channel-conversion-config";

export interface MonthlyChannelRow {
  month: string; // "YYYY-MM-01"
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  avg_cpc: number;
  conversion_rate: number;
  // Zelfde vorm als de losse-veld-records die de rest van de route (findMonth/g/buildChartData)
  // overal gebruikt -- de indexsignatuur maakt dit type assignable aan Record<string, unknown>
  // zonder dat elke aanroepplek in de route hoeft te casten.
  [key: string]: unknown;
}

interface Agg { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }
const emptyAgg = (): Agg => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 });

function finalizeMonth(month: string, a: Agg): MonthlyChannelRow {
  return {
    month: `${month}-01`,
    impressions: a.impressions, clicks: a.clicks, cost: a.cost,
    conversions: a.conversions, conversions_value: a.conversions_value,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    avg_cpc: a.clicks > 0 ? a.cost / a.clicks : 0,
    conversion_rate: a.clicks > 0 ? a.conversions / a.clicks : 0,
  };
}

/**
 * Meta/LinkedIn dagrijen → maandrijen. `convFields` haalt de ruwe conversievelden uit een dagrij
 * (per kanaal andere kolomnamen); welke daarvan meetellen bepaalt `sumSelectedConversions` via de
 * conversieselectie van de klant (channel-conversion-config.ts), zelfde bron als de rest van het
 * dashboard.
 */
export function monthlyFromDaily(
  rows: Array<Record<string, unknown>>,
  opts: {
    dateField: string;
    clicksField: string;
    convFields: (r: Record<string, unknown>) => Record<string, number>;
    channelKey: ChannelConversionChannel;
    convConfig: ChannelConversionConfig;
  },
): MonthlyChannelRow[] {
  const byMonth = new Map<string, Agg>();
  for (const r of rows) {
    const month = String(r[opts.dateField] ?? "").slice(0, 7);
    if (!month) continue;
    const a = byMonth.get(month) ?? emptyAgg();
    a.impressions += Number(r.impressions ?? 0);
    a.clicks += Number(r[opts.clicksField] ?? 0);
    a.cost += Number(r.spend ?? 0);
    a.conversions += sumSelectedConversions(opts.convFields(r), opts.channelKey, opts.convConfig);
    a.conversions_value += Number(r.conversion_value ?? 0);
    byMonth.set(month, a);
  }
  return [...byMonth.entries()].map(([month, a]) => finalizeMonth(month, a));
}

/**
 * Meerdere maandseries (Google/Meta/LinkedIn) samentellen tot één blended serie. Bij één bron is
 * dit een pure doorgave met herberekende ratio's -- identiek aan de bron zelf, dus geen
 * gedragswijziging voor een Google-only klant.
 */
export function blendMonthly(sources: Array<Array<Record<string, unknown>>>): MonthlyChannelRow[] {
  const byMonth = new Map<string, Agg>();
  for (const source of sources) {
    for (const r of source) {
      const month = String(r.month ?? "").slice(0, 7);
      if (!month) continue;
      const a = byMonth.get(month) ?? emptyAgg();
      a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0);
      a.cost += Number(r.cost ?? 0);
      a.conversions += Number(r.conversions ?? 0);
      a.conversions_value += Number(r.conversions_value ?? 0);
      byMonth.set(month, a);
    }
  }
  return [...byMonth.entries()].map(([month, a]) => finalizeMonth(month, a));
}
