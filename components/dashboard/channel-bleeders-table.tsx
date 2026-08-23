"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import { resolveChannelConversionConfig, sumSelectedConversions, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { CONFIG, fmt, type ChannelKind, type DailyRow } from "./channel-performance";

// Meta/LinkedIn-equivalent van Google's "Waar het weglekt" (search-terms-table.tsx). Google kan
// tot op zoekterm- en ad group-niveau zien wat geld kost zonder conversie, omdat het een
// zoekplatform is; Meta en LinkedIn zijn dat niet en syncen geen zoektermrapport. Wat wél
// hetzelfde risico laat zien op het niveau dat deze twee kanalen wél hebben: campagnes met spend
// in de laatste 28 dagen en nul conversies. Zelfde databron als channel-campaign-table.tsx
// ("Wat er draait"), hier gefilterd en in het rood van search-terms-table's VERSPIL_KLEUR --
// dezelfde vraag, op de granulariteit die het platform toestaat.

const VERSPIL_KLEUR = "#ef4444";

function eurRood(v: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

interface Bleeder { entity: string; impressions: number; clicks: number; spend: number }

export function ChannelBleedersTable({ clientId, channel, geoClone }: { clientId: string; channel: ChannelKind; geoClone?: string | null }) {
  const cfg = CONFIG[channel];
  const [campaign, setCampaign] = useState<DailyRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [convConfig, setConvConfig] = useState<ChannelConversionConfig>(() => resolveChannelConversionConfig(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCampaign(null); setError(null);
    const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.campaignTable, { select: cfg.select, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
      dbSelect<Record<string, unknown>>(cfg.nameTable, { select: `${cfg.nameId}, name`, clientId }),
      dbSelectOne<{ channel_conversion_config: unknown }>("client_settings", { select: "channel_conversion_config", clientId }),
    ]).then(([campRes, nameRes, settingsRes]) => {
      if (cancelled) return;
      if (campRes.error) { setError(campRes.error.message); setCampaign([]); return; }
      setCampaign(((campRes.data ?? []) as unknown as Record<string, unknown>[]).map(cfg.map));
      setNames(new Map(((nameRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[cfg.nameId]), String(r.name ?? r[cfg.nameId])])));
      setConvConfig(resolveChannelConversionConfig((settingsRes.data?.channel_conversion_config ?? null) as Partial<ChannelConversionConfig> | null));
    });
    return () => { cancelled = true; };
  }, [clientId, cfg]);

  const convOf = (r: DailyRow) => sumSelectedConversions(r.convFields, cfg.channelKey, convConfig);

  const matchedEntities = useMemo(() => {
    if (!geoClone) return null;
    const set = new Set<string>();
    for (const [entity, name] of names) {
      if (matchGeoCloneByCampaignName(name)?.abbreviation === geoClone) set.add(entity);
    }
    return set;
  }, [geoClone, names]);

  const bleeders = useMemo(() => {
    if (!campaign) return null;
    const source = geoClone ? campaign.filter((r) => matchedEntities?.has(r.entity)) : campaign;
    const byCampaign = new Map<string, Bleeder & { conv: number }>();
    for (const r of source) {
      const a = byCampaign.get(r.entity) ?? { entity: r.entity, impressions: 0, clicks: 0, spend: 0, conv: 0 };
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r);
      byCampaign.set(r.entity, a);
    }
    return [...byCampaign.values()]
      .filter((c) => c.spend > 0 && c.conv === 0)
      .sort((a, b) => b.spend - a.spend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, convConfig, geoClone, matchedEntities]);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  if (bleeders === null) return <Laadvlak vorm="tabel" regels={4} />;
  if (bleeders.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground bg-card rounded-xl border border-border shadow-sm">
        Geen campagnes met spend en nul conversies in de laatste 28 dagen. Goed bezig!
      </div>
    );
  }

  const totalWaste = bleeders.reduce((s, b) => s + b.spend, 0);
  const totalClicks = bleeders.reduce((s, b) => s + b.clicks, 0);
  const totalImpressions = bleeders.reduce((s, b) => s + b.impressions, 0);
  const duurste = Math.max(0, ...bleeders.map((b) => b.spend));

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <span className="text-xs text-muted-foreground">
          {eurRood(totalWaste)} verspild aan campagnes met 0 conversies (28d)
        </span>
      </div>
      <Tabel>
        <Kop>
          <KolomKop breed>Campagne</KolomKop>
          <KolomKop getal>Impressies</KolomKop>
          <KolomKop getal>Klikken</KolomKop>
          <KolomKop getal bijschrift="aandeel">Kosten</KolomKop>
          <KolomKop getal>Conv.</KolomKop>
        </Kop>
        <Body>
          {bleeders.map((b) => (
            <Rij key={b.entity}>
              <NaamCel>
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span className="truncate">{names.get(b.entity) ?? b.entity}</span>
                </span>
              </NaamCel>
              <GetalCel zacht>{fmt(b.impressions)}</GetalCel>
              <GetalCel>{fmt(b.clicks)}</GetalCel>
              <AandeelCel
                waarde={<span className="text-red-500">{eurRood(b.spend)}</span>}
                aandeel={duurste > 0 ? b.spend / duurste : 0}
                kleur={VERSPIL_KLEUR}
              />
              <GetalCel className="text-red-500 font-semibold">0</GetalCel>
            </Rij>
          ))}
        </Body>
        <TotaalRij>
          <TotaalCel>Totaal verspild ({bleeders.length})</TotaalCel>
          <TotaalCel getal>{fmt(totalImpressions)}</TotaalCel>
          <TotaalCel getal>{fmt(totalClicks)}</TotaalCel>
          <TotaalCel getal><span className="text-red-600">{eurRood(totalWaste)}</span></TotaalCel>
          <TotaalCel getal>0</TotaalCel>
        </TotaalRij>
      </Tabel>
    </div>
  );
}
