"use client";

import { useEffect, useMemo, useState } from "react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import {
  resolveChannelConversionConfig,
  sumSelectedConversions,
  selectedConversionLabels,
  type ChannelConversionConfig,
} from "@/lib/analysis/channel-conversion-config";
import { CONFIG, type ChannelKind, type DailyRow } from "@/components/dashboard/channel-performance";

// De dagrijen van een kanaal plus de conversie-selectie, in één hook.
//
// Waarom dit bestaat. Er hangen inmiddels drie losse kaarten aan dezelfde twee queries: de
// pacing-kaart in de hero, de maandverloop-grafiek, en (met een eigen bredere fetch) de
// prestatieview. Elk van die drie had anders zijn eigen kopie van "haal de dagtabel op, haal
// client_settings op, los de conversie-selectie op" -- drie plekken waar iemand ooit een ander
// veld of een ander venster kiest, en dan tellen twee kaarten op hetzelfde scherm iets anders
// als "een conversie".
//
// `dagen` is een parameter en geen constante: de pacing-kaart heeft aan de huidige plus de vorige
// maand genoeg (70), de maandgrafiek kijkt zes volle maanden terug (200). Een gedeelde hook met
// het grootste venster zou de pacing-kaart drie keer zoveel rijen laten ophalen als hij gebruikt.

export interface KanaalDagen {
  /** null zolang er geladen wordt; [] als er niets is. */
  rijen: DailyRow[] | null;
  /** De som van de geselecteerde conversievelden voor dit kanaal. */
  convVan: (r: DailyRow) => number;
  /** Hoe die conversie heet op het scherm ("Aankopen / conversies + Leads"). */
  convLabel: string;
}

export function useKanaalDagen(clientId: string, channel: ChannelKind, dagen: number): KanaalDagen {
  const cfg = CONFIG[channel];
  const [rijen, setRijen] = useState<DailyRow[] | null>(null);
  const [convConfig, setConvConfig] = useState<ChannelConversionConfig>(() => resolveChannelConversionConfig(null));

  useEffect(() => {
    let cancelled = false;
    setRijen(null);
    const since = new Date(Date.now() - dagen * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.accountTable, {
        select: cfg.select, clientId, filters: [{ op: "gte", column: "date", value: since }],
      }),
      dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", {
        select: "channel_conversion_config", clientId,
      }),
    ]).then(([accRes, settingsRes]) => {
      if (cancelled) return;
      setRijen(((accRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setConvConfig(resolveChannelConversionConfig(
        (settingsRes.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null,
      ));
    }, () => { if (!cancelled) setRijen([]); });
    return () => { cancelled = true; };
  }, [clientId, cfg, dagen]);

  const convVan = useMemo(
    () => (r: DailyRow) => sumSelectedConversions(r.convFields, cfg.channelKey, convConfig),
    [cfg.channelKey, convConfig],
  );
  const convLabel = useMemo(
    () => selectedConversionLabels(cfg.channelKey, convConfig).join(" + "),
    [cfg.channelKey, convConfig],
  );

  return { rijen, convVan, convLabel };
}
