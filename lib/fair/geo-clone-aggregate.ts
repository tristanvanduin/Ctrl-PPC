// Fase 1c: her-aggregatie van account-cijfers PER geo-clone uit de campagne-maanddata
// (ads_campaign_monthly draagt campaign_name, de account-tabel niet). Puur en los getest.
// Sommeert per maand de campagnes die bij de gekozen geo-clone horen (via de catalogus) en
// leidt de ratio's UIT TOTALEN af (nooit uit gemiddelde deelwaarden — dezelfde regel als
// period-evaluation/weekly-metrics).

import { matchGeoCloneByCampaignName, visibleGeoClones, type GeoCloneVariant, FAIR_GEO_CLONES } from "./geo-clone-catalog";

export interface CampaignMonthlyRow {
  campaign_name: string;
  month: string; // "YYYY-MM-01"
  impressions?: number | null;
  clicks?: number | null;
  cost?: number | null;
  conversions?: number | null;
  conversions_value?: number | null;
}

export interface GeoCloneMonthlyPoint {
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  cpa: number | null;   // cost / conversions
  roas: number | null;  // conversionsValue / cost
  ctr: number | null;   // clicks / impressions
}

export interface GeoCloneSummary {
  months: GeoCloneMonthlyPoint[];
  totals: Omit<GeoCloneMonthlyPoint, "month">;
  campaignCount: number;
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 10000) / 10000 : null);

function derive(agg: { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }) {
  return {
    ...agg,
    cpa: ratio(agg.cost, agg.conversions),
    roas: ratio(agg.conversionsValue, agg.cost),
    ctr: ratio(agg.clicks, agg.impressions),
  };
}

/** Sommeert per maand de campagnes die bij de geo-clone horen; ratio's uit de maandtotalen. */
export function aggregateCampaignMonthlyByGeoClone(rows: CampaignMonthlyRow[], geoClone: string): GeoCloneSummary {
  const matched = rows.filter((r) => matchGeoCloneByCampaignName(r.campaign_name)?.abbreviation === geoClone);
  const byMonth = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }>();
  const campaigns = new Set<string>();

  for (const r of matched) {
    campaigns.add(r.campaign_name);
    const m = byMonth.get(r.month) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
    m.impressions += n(r.impressions);
    m.clicks += n(r.clicks);
    m.cost += n(r.cost);
    m.conversions += n(r.conversions);
    m.conversionsValue += n(r.conversions_value);
    byMonth.set(r.month, m);
  }

  const months: GeoCloneMonthlyPoint[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, agg]) => ({ month, ...derive(agg) }));

  const totalAgg = months.reduce(
    (acc, m) => ({
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
      cost: acc.cost + m.cost,
      conversions: acc.conversions + m.conversions,
      conversionsValue: acc.conversionsValue + m.conversionsValue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 }
  );

  return { months, totals: derive(totalAgg), campaignCount: campaigns.size };
}

/** Zelfde her-aggregatie als hierboven, maar zonder geo-clone-filter — elke aangeleverde rij telt
 *  mee, ongeacht campagnenaam. Dit is het "totaal"-cijfer voor het hele account. */
function aggregateAllRows(rows: CampaignMonthlyRow[]): GeoCloneSummary {
  const byMonth = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number }>();
  const campaigns = new Set<string>();
  for (const r of rows) {
    campaigns.add(r.campaign_name);
    const m = byMonth.get(r.month) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };
    m.impressions += n(r.impressions);
    m.clicks += n(r.clicks);
    m.cost += n(r.cost);
    m.conversions += n(r.conversions);
    m.conversionsValue += n(r.conversions_value);
    byMonth.set(r.month, m);
  }
  const months: GeoCloneMonthlyPoint[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, agg]) => ({ month, ...derive(agg) }));
  const totalAgg = months.reduce(
    (acc, m) => ({
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
      cost: acc.cost + m.cost,
      conversions: acc.conversions + m.conversions,
      conversionsValue: acc.conversionsValue + m.conversionsValue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 }
  );
  return { months, totals: derive(totalAgg), campaignCount: campaigns.size };
}

export interface GeoCloneBreakdownEntry {
  geoClone: string;
  brand: string;
  location: string;
  summary: GeoCloneSummary;
}

export interface GeoCloneBreakdown {
  /** Eén entry per geo-clone die daadwerkelijk in de campagnenamen voorkomt (visibleGeoClones) —
   *  een niet-voorkomende variant uit de catalogus wordt niet getoond, zelfde regel als de
   *  catalogus zelf al hanteert. */
  perGeoClone: GeoCloneBreakdownEntry[];
  /** Campagnes die geen enkele geo-clone-afkorting matchen. Nooit stilzwijgend bij een variant
   *  opgeteld (geo-clone-catalog.ts's eigen regel) — expliciet apart, null als er geen zijn. */
  unmatched: GeoCloneSummary | null;
  /** Het HELE account, ongeacht geo-clone — wat de eigenaar "het totaal overzicht van greentech
   *  zelf" noemde: de som van alle sub-accounts samen, naast (niet in plaats van) de aparte
   *  eenheden hierboven. */
  total: GeoCloneSummary;
}

/**
 * Splitst campagnedata van een account met geo-clones (bijv. GreenTech Amsterdam/Americas/North
 * America) in aparte, uniek behandelde eenheden per geo-clone, plus een combinatie-totaal over het
 * hele account. Eigenaar, 17 augustus 2026: de sub-accounts moeten in de analyse als 3 losse
 * eenheden gezien worden (geen blending), maar wel bij elkaar terugkomen in het totaaloverzicht van
 * het account zelf — dit is de functie die beide tegelijk levert, in plaats van een keuze te
 * moeten maken tussen de twee.
 *
 * Geeft `perGeoClone: []` als geen enkele campagnenaam een geo-clone-afkorting bevat (het normale
 * geval voor vrijwel elke klant) — de aanroeper degradeert dan naar "geen geo-clones", geen
 * verzonnen segmentatie.
 */
export function aggregateAllGeoClones(rows: CampaignMonthlyRow[], catalog: readonly GeoCloneVariant[] = FAIR_GEO_CLONES): GeoCloneBreakdown {
  const campaignNames = [...new Set(rows.map((r) => r.campaign_name))];
  const zichtbaar = visibleGeoClones(campaignNames, catalog as GeoCloneVariant[]);

  const perGeoClone: GeoCloneBreakdownEntry[] = zichtbaar.map((v) => ({
    geoClone: v.abbreviation,
    brand: v.brand,
    location: v.location,
    summary: aggregateCampaignMonthlyByGeoClone(rows, v.abbreviation),
  }));

  const unmatchedRows = rows.filter((r) => !matchGeoCloneByCampaignName(r.campaign_name, catalog as GeoCloneVariant[]));
  const unmatched = zichtbaar.length > 0 && unmatchedRows.length > 0 ? aggregateAllRows(unmatchedRows) : null;

  return { perGeoClone, unmatched, total: aggregateAllRows(rows) };
}
