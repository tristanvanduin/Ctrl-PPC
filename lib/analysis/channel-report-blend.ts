// Pure rekenkern achter de multi-kanaal client-reports (23 augustus 2026). Uitgetrokken uit
// app/api/client-reports/route.ts zodat de aggregatie- en optellogica los van de route (LLM-calls,
// Supabase-fetches, voortgangsjob) getest kan worden -- zie __channel_report_blend_test.ts.
//
// Doel: dag-cijfers van Meta/LinkedIn (meta_account_daily/linkedin_account_daily) omzetten naar
// maandrijen in dezelfde vorm als ads_account_monthly (Google), en die vervolgens optellen tot een
// blended maandserie. findMonth()/g()/buildChartData() in de route werken zo ongewijzigd door, of
// de rij nou van Google, Meta, LinkedIn komt of samengeteld is -- ratio's (ctr/avg_cpc/
// conversion_rate) worden herberekend uit de opgetelde tellers, nooit gemiddeld over ratio's.
//
// Sinds 1 november 2026 ook de ene plek waar dagrijen van Meta, LinkedIn en Microsoft maandrijen
// worden (kanaalMaandenUitDagen, onderaan), voor elke lezer: de KPI-band in de browser, het
// Jaaroverzicht en de Pacing op de server, en deze rapportage. Daarom puur en client-veilig.

import { conversionSourcesFor, sumSelectedConversions, type ChannelConversionChannel, type ChannelConversionConfig } from "./channel-conversion-config";

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

// ── De dagbron per kanaal, en dag -> maand met de selectie van de klant ─────────
//
// Er waren vier handgeschreven dag->maand-lussen voor Meta, LinkedIn en Microsoft (de KPI-band in
// de browser, deze rapportage, de cross-channel-analyse, en het Jaaroverzicht dat het via
// fact_core deed), elk met een eigen select-lijst en een eigen idee van welke kolom de klikken
// zijn. Het Jaaroverzicht las bovendien fact_core, waar de SQL-projectie de STANDAARDselectie
// inbakt (migratie 054/078): zodra een klant in Instellingen iets anders koos, telden de KPI-band
// en het Jaaroverzicht een andere conversie. Hier staat het één keer, en elke lezer van een
// dagtabel hoort via kanaalMaandenUitDagen te gaan.

/** De dagtabel, de klikkolom en de entiteitkolom per niet-Google-kanaal. Meta's klikken heten
 *  link_clicks (clicks_all telt ook likes en profielklikken); LinkedIn en Microsoft heten gewoon
 *  clicks. `entityField` is het advertentieaccount van de rij: de tweede sorteersleutel bij
 *  gepagineerd lezen. Op datum alleen ligt de volgorde bij twee accounts op één kanaal niet vast,
 *  en dan kan een rij op de paginagrens dubbel of helemaal niet meekomen (alleRijen in
 *  db-veilig.ts). Kolomnamen uit scripts/schema-snapshot.json. */
export const KANAAL_DAGBRON: Record<ChannelConversionChannel, { table: string; clicksField: string; entityField: string }> = {
  meta_ads: { table: "meta_account_daily", clicksField: "link_clicks", entityField: "entity_id" },
  linkedin_ads: { table: "linkedin_account_daily", clicksField: "clicks", entityField: "entity_urn" },
  microsoft_ads: { table: "microsoft_account_daily", clicksField: "clicks", entityField: "entity_id" },
};

/**
 * De select-lijst voor die dagtabel: de vaste tellers plus ALLE selecteerbare conversievelden.
 * De selectie van de klant bepaalt wat meetelt, niet de query: een lijst met alleen de
 * standaardvelden telt een opgeslagen keuze voor post-click-conversies stil als nul.
 *
 * Let op: scripts/check-datagrond.mjs kan een select uit een functie niet lezen. Dat de kolommen
 * bestaan, bewaakt __channel_report_blend_test.ts tegen scripts/schema-snapshot.json.
 */
export function dagbronSelect(channel: ChannelConversionChannel): string {
  const velden = ["date", "impressions", KANAAL_DAGBRON[channel].clicksField, "spend", "conversion_value",
    ...conversionSourcesFor(channel).map((s) => s.field)];
  return [...new Set(velden)].join(", ");
}

/** Dagrijen van één kanaal (gelezen met dagbronSelect) -> maandrijen, met de conversieselectie
 *  van de klant. Niet voor Google: die komt per maand uit de sync, met de conversieacties al
 *  toegepast. */
export function kanaalMaandenUitDagen(
  rows: Array<Record<string, unknown>>,
  channel: ChannelConversionChannel,
  convConfig: ChannelConversionConfig,
): MonthlyChannelRow[] {
  const velden = conversionSourcesFor(channel).map((s) => s.field);
  return monthlyFromDaily(rows, {
    dateField: "date",
    clicksField: KANAAL_DAGBRON[channel].clicksField,
    convFields: (r) => Object.fromEntries(velden.map((f) => [f, Number(r[f] ?? 0)])),
    channelKey: channel,
    convConfig,
  });
}
