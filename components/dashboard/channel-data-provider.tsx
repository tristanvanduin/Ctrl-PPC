"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import { today as vandaag } from "@/lib/reporting-date";
import { buildChannelForecast } from "@/lib/analysis/channel-forecast-data";
import type { TargetRow } from "@/lib/analysis/o2-targets-cost";
import {
  resolveChannelConversionConfig,
  sumSelectedConversions,
  selectedConversionLabels,
  type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import type { ClientForecast } from "@/lib/forecast";
import type { ClientHistoricalData } from "@/lib/types";
import { CONFIG, type ChannelKind, type DailyRow } from "./channel-performance";

// EEN fetch per kanaaltabblad, voor alle kaarten samen.
//
// Waarom dit er is, en het is een reparatie van mijn eigen werk. Toen pacing, het maandverloop en
// de beurs-sectie losse kaarten werden, kreeg elk van die kaarten zijn eigen ophaalcode. Gemeten op
// het Meta-tabblad: 54 data-verzoeken per paginabezoek, waarvan meta_account_daily elf keer en
// client_targets vier keer -- allemaal dezelfde rijen. Zichtbaar gevolg: de beurs-sectie stond na
// twintig seconden nog op zijn skelet, en dat is precies wat de eigenaar in beeld kreeg.
//
// Google lost dit al zo op (ClientDataProvider + ForecastContext); dit is de tegenhanger voor Meta
// en LinkedIn. Eén provider haalt de dagrijen, de conversie-selectie en de doelen op, bouwt de
// forecast één keer, en alle kaarten lezen mee.
//
// Zonder datumfilter: de forecast heeft de volle historie nodig om jaren te kunnen wegen
// (lib/forecast.ts's computeMonthlyExpected). De kaarten die maar een paar maanden nodig hebben
// snijden zelf; dat is goedkoper dan een tweede query.

export interface KanaalData {
  /** Alle dagrijen van dit kanaal; null zolang er geladen wordt. */
  rijen: DailyRow[] | null;
  /** De som van de geselecteerde conversievelden voor dit kanaal. */
  convVan: (r: DailyRow) => number;
  /** Hoe die conversie op het scherm heet ("Aankopen / conversies + Leads"). */
  convLabel: string;
  /** null = laden, "leeg" = geen dagcijfers gesynced, anders forecast + historie. */
  forecast: { data: ClientHistoricalData; forecast: ClientForecast } | null | "leeg";
}

const LEEG: KanaalData = { rijen: null, convVan: () => 0, convLabel: "", forecast: null };
const KanaalDataContext = createContext<KanaalData>(LEEG);

/**
 * Buiten een provider valt dit terug op "nog aan het laden" in plaats van te crashen. Dat is
 * bewust: de kaarten hieronder staan ook los op andere schermen, en een ontbrekende provider hoort
 * daar geen wit scherm te geven maar gewoon niets te tonen.
 */
export function useKanaalData(): KanaalData {
  return useContext(KanaalDataContext);
}

export function ChannelDataProvider({ clientId, channel, children }: {
  clientId: string;
  channel: ChannelKind;
  children: ReactNode;
}) {
  const cfg = CONFIG[channel];
  const [rijen, setRijen] = useState<DailyRow[] | null>(null);
  const [convConfig, setConvConfig] = useState<ChannelConversionConfig>(() => resolveChannelConversionConfig(null));
  const [targets, setTargets] = useState<TargetRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRijen(null);
    setTargets(null);
    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.accountTable, { select: cfg.select, clientId }),
      dbSelect<{ channel: string; metric: string; target_value: number; valid_from: string; valid_to: string | null }>(
        "client_targets", { select: "channel, metric, target_value, valid_from, valid_to", clientId },
      ),
      dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", {
        select: "channel_conversion_config", clientId,
      }),
    ]).then(([accRes, targetRes, settingsRes]) => {
      if (cancelled) return;
      setRijen(((accRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setTargets((targetRes.data ?? []).map((r) => ({
        channel: r.channel, metric: r.metric, targetValue: Number(r.target_value ?? 0),
        validFrom: r.valid_from, validTo: r.valid_to,
      })));
      setConvConfig(resolveChannelConversionConfig(
        (settingsRes.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null,
      ));
    }, () => { if (!cancelled) { setRijen([]); setTargets([]); } });
    return () => { cancelled = true; };
  }, [clientId, cfg]);

  const waarde = useMemo<KanaalData>(() => {
    const convVan = (r: DailyRow) => sumSelectedConversions(r.convFields, cfg.channelKey, convConfig);
    const convLabel = selectedConversionLabels(cfg.channelKey, convConfig).join(" + ");
    if (rijen === null || targets === null) return { rijen: null, convVan, convLabel, forecast: null };

    const gebouwd = buildChannelForecast(
      clientId,
      rijen.map((r) => ({ date: r.date, spend: r.spend, revenue: r.revenue, conv: convVan(r) })),
      targets,
      cfg.channelKey,
      vandaag(),
    );
    return { rijen, convVan, convLabel, forecast: gebouwd ?? "leeg" };
  }, [clientId, cfg.channelKey, convConfig, rijen, targets]);

  return <KanaalDataContext.Provider value={waarde}>{children}</KanaalDataContext.Provider>;
}
