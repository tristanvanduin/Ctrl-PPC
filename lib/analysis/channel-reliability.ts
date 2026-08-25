// F5 fase1.1: reliability-gating voor Meta en LinkedIn. computeDataReliability() (data-reliability.ts)
// is functioneel kanaalonafhankelijk, maar verwacht Google's kolomnamen (cost/conversions/
// conversions_value) en maandelijks-geaggregeerde rijen. Meta/LinkedIn hebben alleen dag-tabellen
// met eigen kolomnamen (spend/link_clicks resp. spend/leads) -- deze module aggregeert dag naar
// maand en normaliseert de kolomnamen, zonder computeDataReliability zelf aan te raken.

import { computeDataReliability, type DataReliabilityAssessment } from "./data-reliability";

interface DailyAggregateResult {
  month: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

/** Sommeert dagrijen per maand voor de gevraagde velden. Nooit ratio's middelen. */
function aggregateDailyToMonthly(
  rows: Array<Record<string, unknown>>,
  fieldMap: { impressions: string; clicks: string; cost: string; conversions: string; conversionsValue: string }
): DailyAggregateResult[] {
  const byMonth = new Map<string, DailyAggregateResult>();
  for (const row of rows) {
    const rawDate = row.date;
    if (typeof rawDate !== "string" || rawDate.length < 7) continue;
    const month = rawDate.slice(0, 7);
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const bucket = byMonth.get(month) ?? { month, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
    bucket.impressions += num(row[fieldMap.impressions]);
    bucket.clicks += num(row[fieldMap.clicks]);
    bucket.cost += num(row[fieldMap.cost]);
    bucket.conversions += num(row[fieldMap.conversions]);
    bucket.conversions_value += num(row[fieldMap.conversionsValue]);
    byMonth.set(month, bucket);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

const META_FIELD_MAP = { impressions: "impressions", clicks: "link_clicks", cost: "spend", conversions: "conversions", conversionsValue: "conversion_value" };
// LinkedIn heeft geen "conversions"-kolom: one_click_leads (formulier-leads) is de primaire KPI
// die de rest van de pipeline ook als noemer gebruikt (CPL = spend/leads), external_website_
// conversions is een los, secundair signaal. Voor de betrouwbaarheidscheck -- die draait op
// tracking-anomalieën en regime-shifts van HET primaire conversiesignaal -- is leads de juiste
// keuze, niet de som van beide (die zou twee ongelijksoortige dingen bij elkaar optellen).
const LINKEDIN_FIELD_MAP = { impressions: "impressions", clicks: "clicks", cost: "spend", conversions: "one_click_leads", conversionsValue: "conversion_value" };

export interface ChannelReliabilityInput {
  accountDaily: Array<Record<string, unknown>>;
  campaignDaily: Array<Record<string, unknown>>;
  conversionLagDays: number;
  lastCompleteMonth: number;
  hasKpiTargets: boolean;
}

function computeChannelReliability(input: ChannelReliabilityInput, fieldMap: typeof META_FIELD_MAP): DataReliabilityAssessment {
  const accountMonthly = aggregateDailyToMonthly(input.accountDaily, fieldMap);
  // CampaignRow in data-reliability.ts wil campaign_name als groepeersleutel, maar de
  // reconciliation-check somt gewoon ALLE campagnerijen op -- een leesbare naam is niet nodig
  // voor de berekening zelf, dus we hergebruiken de maand als sleutel plus een vaste placeholder.
  const campaignMonthly = aggregateDailyToMonthly(input.campaignDaily, fieldMap).map((row) => ({
    campaign_name: "alle campagnes",
    month: row.month,
    cost: row.cost,
    conversions: row.conversions,
    conversions_value: row.conversions_value,
  }));
  return computeDataReliability({
    accountMonthly,
    campaignMonthly,
    conversionLagDays: input.conversionLagDays,
    lastCompleteMonth: input.lastCompleteMonth,
    hasKpiTargets: input.hasKpiTargets,
  });
}

export function computeMetaReliability(input: ChannelReliabilityInput): DataReliabilityAssessment {
  return computeChannelReliability(input, META_FIELD_MAP);
}

export function computeLinkedinReliability(input: ChannelReliabilityInput): DataReliabilityAssessment {
  return computeChannelReliability(input, LINKEDIN_FIELD_MAP);
}

// Microsoft is search: clicks zijn gewoon clicks (geen link_clicks-onderscheid zoals Meta) en
// conversions het primaire signaal. De kolomnamen komen uit microsoft_*_daily (migratie 106).
const MICROSOFT_FIELD_MAP = { impressions: "impressions", clicks: "clicks", cost: "spend", conversions: "conversions", conversionsValue: "conversion_value" };

export function computeMicrosoftReliability(input: ChannelReliabilityInput): DataReliabilityAssessment {
  return computeChannelReliability(input, MICROSOFT_FIELD_MAP);
}
