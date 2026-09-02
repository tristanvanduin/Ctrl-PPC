"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dbSelectOne } from "@/lib/data-access/client-read";
import { forecastChannelMetric, type ChannelMetricForecast, type MonthValue } from "./channel-forecast";
import {
  resolveChannelConversionConfig, sumSelectedConversions, conversionSourcesFor,
  type ChannelConversionConfig, type ChannelConversionChannel,
} from "./channel-conversion-config";
import { today as vandaag } from "@/lib/reporting-date";

// Gedeelde databron + model achter de run-rate-prognose voor Meta/LinkedIn (masterplan: Prognose-
// pariteit met Google). Was eerder alleen lokaal in ChannelForecast (components/dashboard/
// channel-forecast.tsx) gebouwd; nu een eigen hook zodat het budgetscenario-equivalent
// (ChannelBudgetScenario) dezelfde spend/conversie-projectie hergebruikt in plaats van een tweede,
// licht andere kopie te bouwen -- exact de fout die lib/analysis/trend.ts elders al repareerde
// voor CPA-trends.

export type ChannelKind = "meta" | "linkedin" | "microsoft" | "blended";

interface Source { table: string; channelKey: ChannelConversionChannel }
export interface ChannelRunRateCfg { sources: Source[]; convLabel: string; label: string }

export const CHANNEL_RUN_RATE_CFG: Record<ChannelKind, ChannelRunRateCfg> = {
  meta: { sources: [{ table: "meta_account_daily", channelKey: "meta_ads" }], convLabel: "Conversies", label: "Meta" },
  linkedin: { sources: [{ table: "linkedin_account_daily", channelKey: "linkedin_ads" }], convLabel: "Leads", label: "LinkedIn" },
  microsoft: { sources: [{ table: "microsoft_account_daily", channelKey: "microsoft_ads" }], convLabel: "Conversies", label: "Microsoft" },
  blended: {
    sources: [
      { table: "meta_account_daily", channelKey: "meta_ads" },
      { table: "linkedin_account_daily", channelKey: "linkedin_ads" },
      { table: "microsoft_account_daily", channelKey: "microsoft_ads" },
    ],
    convLabel: "Acties (conv. + leads)", label: "Meta + LinkedIn + Microsoft",
  },
};

const convFieldsFor = (ck: ChannelConversionChannel): string[] => conversionSourcesFor(ck).map((s) => s.field);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface ChannelRunRateModel {
  spendF: ChannelMetricForecast;
  convF: ChannelMetricForecast;
  dayOfMonth: number;
  daysInMonth: number;
  curMtd: { spend: number; conv: number };
  monthsCount: number;
}

export function useChannelRunRateModel(clientId: string, channel: ChannelKind): {
  cfg: ChannelRunRateCfg;
  error: string | null;
  loading: boolean;
  model: ChannelRunRateModel | null;
} {
  const cfg = CHANNEL_RUN_RATE_CFG[channel];
  const [rows, setRows] = useState<{ date: string; spend: number; conv: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setRows(null); setError(null);
    const since = new Date(Date.now() - 220 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      ...cfg.sources.map((s) =>
        sb.from(s.table).select(`date, spend, ${convFieldsFor(s.channelKey).join(", ")}`).eq("client_id", clientId).gte("date", since)
      ),
      dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId }),
    ]).then((results) => {
      if (cancelled) return;
      const sourceResults = results.slice(0, cfg.sources.length);
      const settingsRes = results[results.length - 1];
      const firstError = sourceResults.find((r) => r.error)?.error;
      if (firstError) { setError(firstError.message); setRows([]); return; }
      const config = resolveChannelConversionConfig((settingsRes.data as { channel_conversion_config?: unknown } | null)?.channel_conversion_config as Partial<ChannelConversionConfig> | null);
      const merged = sourceResults.flatMap((res, i) => {
        const ck = cfg.sources[i].channelKey;
        return ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ date: String(r.date), spend: num(r.spend), conv: sumSelectedConversions(r, ck, config) }));
      });
      setRows(merged);
    });
    return () => { cancelled = true; };
  }, [clientId, channel, cfg]);

  const model = useMemo<ChannelRunRateModel | null>(() => {
    if (!rows || rows.length === 0) return null;
    const today = vandaag();
    const curMonth = today.slice(0, 7);
    const dayOfMonth = Number(today.slice(8, 10));
    const daysInMonth = new Date(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)), 0).getDate();

    const byMonth = new Map<string, { spend: number; conv: number }>();
    for (const r of rows) {
      const m = r.date.slice(0, 7);
      const a = byMonth.get(m) ?? { spend: 0, conv: 0 };
      a.spend += r.spend; a.conv += r.conv;
      byMonth.set(m, a);
    }
    // De 220-dagengrens snijdt de oudste maand vrijwel altijd halverwege af; die deelmaand
    // als "volle maand" laten meetellen gaf een kunstmatig lage eerste waarde en dus een
    // opwaartse helling in de trend (sloop-audit 1 sep 2026). De maand waarin de grens
    // valt doet daarom niet mee, tenzij de grens precies op de 1e lag.
    const grens = new Date(Date.now() - 220 * 86_400_000).toISOString().slice(0, 10);
    const eersteVolleMaand = grens.endsWith("-01") ? grens.slice(0, 7) : null;
    const isVol = (m: string) => m < curMonth && (eersteVolleMaand !== null ? m >= eersteVolleMaand : m > grens.slice(0, 7));
    const fullSpend: MonthValue[] = [...byMonth.entries()].filter(([m]) => isVol(m)).sort().map(([month, a]) => ({ month, value: a.spend }));
    const fullConv: MonthValue[] = [...byMonth.entries()].filter(([m]) => isVol(m)).sort().map(([month, a]) => ({ month, value: a.conv }));
    const cur = byMonth.get(curMonth) ?? { spend: 0, conv: 0 };

    const spendF = forecastChannelMetric({ fullMonths: fullSpend, mtd: cur.spend, dayOfMonth, daysInMonth });
    const convF = forecastChannelMetric({ fullMonths: fullConv, mtd: cur.conv, dayOfMonth, daysInMonth });
    return { spendF, convF, dayOfMonth, daysInMonth, curMtd: cur, monthsCount: fullSpend.length };
  }, [rows]);

  return { cfg, error, loading: rows === null && !error, model };
}
