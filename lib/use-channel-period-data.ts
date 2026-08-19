"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dbSelectOne } from "@/lib/data-access/client-read";
import {
  resolveChannelConversionConfig, sumSelectedConversions,
  type ChannelConversionConfig, type ChannelConversionChannel,
} from "@/lib/analysis/channel-conversion-config";
import type { ClientHistoricalData, MonthlyRecord } from "@/lib/types";

// De KPI-rij (PeriodSummary) toonde altijd Google-cijfers, ook op de Meta/LinkedIn/Alle
// kanalen-tabs -- niet "blend die niet meebeweegt" maar letterlijk het verkeerde kanaal op drie
// van de vier tabs. Deze hook berekent hetzelfde ClientHistoricalData-schema (dat comparePeriods()
// in lib/period/apply-period.ts al kent) voor Meta en LinkedIn, en telt Google+Meta+LinkedIn
// samen op voor "blended" (de standaardweergave, "Alle kanalen") -- zodat client-dashboard.tsx aan
// PeriodSummary precies dezelfde vorm data kan geven, welk kanaal er ook actief is.
//
// Bewust dezelfde bron als ChannelPerformance (rechtstreekse supabase.from(), demo-bewust via
// lib/supabase.ts) en dezelfde conversieselectie (resolveChannelConversionConfig/
// sumSelectedConversions uit lib/analysis/channel-conversion-config.ts) -- zodat de KPI-rij en de
// kanaal-eigen ChannelPerformance-kaart nooit een ander getal voor dezelfde conversie tonen.
//
// `weeks` blijft overal een lege array: comparePeriods()/slicePeriod() (lib/period/apply-period.ts)
// gebruiken alleen month/conversions/revenue/adSpend uit een MonthlyRecord, nooit .weeks -- die is
// er puur omdat het type dat vereist.

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

type MetaLinkedIn = "meta" | "linkedin";

interface RowConfig {
  accountTable: string;
  channelKey: ChannelConversionChannel;
  select: string;
  spend: (r: Record<string, unknown>) => number;
  revenue: (r: Record<string, unknown>) => number;
}

const CONFIG: Record<MetaLinkedIn, RowConfig> = {
  meta: {
    accountTable: "meta_account_daily",
    channelKey: "meta_ads",
    select: "date, spend, conversions, leads, conversion_value",
    spend: (r) => num(r.spend),
    revenue: (r) => num(r.conversion_value),
  },
  linkedin: {
    accountTable: "linkedin_account_daily",
    channelKey: "linkedin_ads",
    select: "date, spend, one_click_leads, external_website_conversions, post_click_conversions, conversion_value",
    spend: (r) => num(r.spend),
    revenue: (r) => num(r.conversion_value),
  },
};

interface MaandTotaal { year: number; month: number; conversions: number; revenue: number; adSpend: number }

async function fetchChannelMonths(clientId: string, channel: MetaLinkedIn, convConfig: ChannelConversionConfig): Promise<MaandTotaal[]> {
  const sb = supabase;
  if (!sb) return [];
  const cfg = CONFIG[channel];
  // Twee jaar: genoeg venster voor "vorig jaar"-vergelijkingen waar de data dat toelaat. Minder
  // diep dan dat levert eerlijk "ontbrekende maanden" op via slicePeriod() -- geen aanname, geen
  // stille kortere reeks.
  const since = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await sb.from(cfg.accountTable).select(cfg.select).eq("client_id", clientId).gte("date", since);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const byMonth = new Map<string, MaandTotaal>();
  for (const r of rows) {
    const date = String(r.date ?? "");
    if (date.length < 7) continue;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const k = `${year}-${month}`;
    const a = byMonth.get(k) ?? { year, month, conversions: 0, revenue: 0, adSpend: 0 };
    a.conversions += sumSelectedConversions(r, cfg.channelKey, convConfig);
    a.revenue += cfg.revenue(r);
    a.adSpend += cfg.spend(r);
    byMonth.set(k, a);
  }
  return [...byMonth.values()];
}

function bouwHistorischeData(clientId: string, maanden: MaandTotaal[]): ClientHistoricalData {
  const currentYear = new Date().getFullYear();
  const historicalYears: Record<number, MonthlyRecord[]> = {};
  const currentYearData: (MonthlyRecord | null)[] = Array(12).fill(null);

  for (const m of maanden) {
    const record: MonthlyRecord = { month: m.month, conversions: m.conversions, revenue: m.revenue, adSpend: m.adSpend, weeks: [] };
    if (m.year === currentYear) {
      currentYearData[m.month - 1] = record;
    } else {
      (historicalYears[m.year] ??= []).push(record);
    }
  }

  return {
    clientId,
    // Ongebruikt door comparePeriods()/PeriodSummary -- die lezen alleen currentYearData en
    // historicalYears. Nul in plaats van weglaten omdat het type het veld verplicht stelt.
    targetCurrentYear: { conversions: 0, revenue: 0, adSpend: 0 },
    historicalYears,
    currentYearData,
    currentYear,
  };
}

/** Google+Meta+LinkedIn bij elkaar optellen, maand voor maand, voor de "Alle kanalen"-weergave. */
function samenvoegen(clientId: string, sets: ClientHistoricalData[]): ClientHistoricalData {
  const totalen = new Map<string, MaandTotaal>();
  const optellen = (year: number, m: MonthlyRecord | null) => {
    if (!m) return;
    const k = `${year}-${m.month}`;
    const a = totalen.get(k) ?? { year, month: m.month, conversions: 0, revenue: 0, adSpend: 0 };
    a.conversions += m.conversions || 0;
    a.revenue += m.revenue || 0;
    a.adSpend += m.adSpend || 0;
    totalen.set(k, a);
  };
  let currentYear = new Date().getFullYear();
  for (const d of sets) {
    currentYear = d.currentYear || currentYear;
    for (const [jaarStr, maanden] of Object.entries(d.historicalYears ?? {})) {
      const jaar = Number(jaarStr);
      for (const m of maanden ?? []) optellen(jaar, m);
    }
    for (const m of d.currentYearData ?? []) optellen(d.currentYear, m);
  }
  return bouwHistorischeData(clientId, [...totalen.values()]);
}

export interface ChannelPeriodDataArgs {
  clientId: string;
  /** De actieve kanaaltab. "blended" = Alle kanalen (de standaardweergave). */
  channel: "google" | "meta" | "linkedin" | "blended";
  /** Google's al opgehaalde data -- deze hook haalt alleen Meta/LinkedIn zelf op. */
  googleData: ClientHistoricalData | null;
}

/** De juiste ClientHistoricalData voor de KPI-rij, gegeven het actieve kanaal. */
export function useChannelPeriodData({ clientId, channel, googleData }: ChannelPeriodDataArgs): ClientHistoricalData | null {
  const [convConfig, setConvConfig] = useState<ChannelConversionConfig>(() => resolveChannelConversionConfig(null));
  const [metaData, setMetaData] = useState<ClientHistoricalData | null>(null);
  const [linkedinData, setLinkedinData] = useState<ClientHistoricalData | null>(null);

  useEffect(() => {
    let cancelled = false;
    dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId })
      .then(({ data }) => {
        if (!cancelled) setConvConfig(resolveChannelConversionConfig((data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null));
      });
    return () => { cancelled = true; };
  }, [clientId]);

  // Altijd allebei ophalen, ongeacht welk kanaal actief is: "blended" heeft ze beide nodig, en
  // tussen tabs wisselen zonder herhaald fetchen is prettiger dan per tab opnieuw laden.
  useEffect(() => {
    let cancelled = false;
    fetchChannelMonths(clientId, "meta", convConfig).then((maanden) => {
      if (!cancelled) setMetaData(bouwHistorischeData(clientId, maanden));
    });
    return () => { cancelled = true; };
  }, [clientId, convConfig]);

  useEffect(() => {
    let cancelled = false;
    fetchChannelMonths(clientId, "linkedin", convConfig).then((maanden) => {
      if (!cancelled) setLinkedinData(bouwHistorischeData(clientId, maanden));
    });
    return () => { cancelled = true; };
  }, [clientId, convConfig]);

  if (channel === "google") return googleData;
  if (channel === "meta") return metaData;
  if (channel === "linkedin") return linkedinData;
  // blended: pas tonen zodra alle drie binnen zijn -- anders telt een half-geladen kanaal als nul
  // mee, en dat leest als "dit kanaal presteert niet" in plaats van "nog aan het laden".
  if (!googleData || !metaData || !linkedinData) return null;
  return samenvoegen(clientId, [googleData, metaData, linkedinData]);
}
