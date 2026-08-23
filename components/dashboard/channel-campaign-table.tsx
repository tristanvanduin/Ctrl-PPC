"use client";

import { useEffect, useMemo, useState } from "react";
import { dbSelect, dbSelectOne } from "@/lib/data-access/client-read";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import { resolveChannelConversionConfig, sumSelectedConversions, selectedConversionLabels, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { CONFIG, eur, fmt, pctS, type ChannelKind, type DailyRow } from "./channel-performance";

// De campagnetabel voor Meta/LinkedIn op de Campagnes-tab -- verhuisd uit channel-performance.tsx
// (22 augustus 2026, "unify de Overzicht-hero... structuur exact hetzelfde"). Google's campagnetabel
// stond al op Campagnes onder "Wat er draait"; Meta/LinkedIn hadden 'm op Overzicht, binnen
// ChannelPerformance. Zelfde soort inhoud hoorde zo op een ander tabblad per kanaal. Eigen, lichte
// databronnen (28 dagen campagnedata) i.p.v. hergebruik van ChannelPerformance's staat: de twee
// tabbladen zijn nooit tegelijk gemount, dus een gedeelde hook zou geen netwerkverzoek besparen,
// alleen code -- en de venstergrootte hier (28 dagen) is toch al smaller dan Overzicht's 200-dagen
// fetch voor de maandtrends.

interface Agg { impressions: number; clicks: number; spend: number; conv: number }
const emptyAgg = (): Agg => ({ impressions: 0, clicks: 0, spend: 0, conv: 0 });

export function ChannelCampaignTable({ clientId, channel, geoClone }: { clientId: string; channel: ChannelKind; geoClone?: string | null }) {
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
  const convLabel = selectedConversionLabels(cfg.channelKey, convConfig).join(" + ");
  const useLeadsLabel = cfg.channelKey === "linkedin_ads";

  const matchedEntities = useMemo(() => {
    if (!geoClone) return null;
    const set = new Set<string>();
    for (const [entity, name] of names) {
      if (matchGeoCloneByCampaignName(name)?.abbreviation === geoClone) set.add(entity);
    }
    return set;
  }, [geoClone, names]);

  const campaigns = useMemo(() => {
    if (!campaign) return null;
    const source = geoClone ? campaign.filter((r) => matchedEntities?.has(r.entity)) : campaign;
    const byCampaign = new Map<string, Agg>();
    for (const r of source) {
      const a = byCampaign.get(r.entity) ?? emptyAgg();
      a.impressions += r.impressions; a.clicks += r.clicks; a.spend += r.spend; a.conv += convOf(r);
      byCampaign.set(r.entity, a);
    }
    return [...byCampaign.entries()].map(([entity, a]) => ({ entity, ...a })).sort((a, b) => b.spend - a.spend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, convConfig, geoClone, matchedEntities]);

  const ctr = (a: Agg): number | null => (a.impressions > 0 ? a.clicks / a.impressions : null);
  const cpa = (a: Agg): number | null => (a.conv > 0 ? a.spend / a.conv : null);

  if (error) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  if (campaigns === null) return <Laadvlak vorm="tabel" regels={6} />;
  if (campaigns.length === 0) return null;

  const som = campaigns.reduce((t, c) => ({
    spend: t.spend + c.spend, impressions: t.impressions + c.impressions,
    clicks: t.clicks + c.clicks, conv: t.conv + c.conv,
  }), { spend: 0, impressions: 0, clicks: 0, conv: 0 });
  const grootste = campaigns.reduce((t, c) => ({
    spend: Math.max(t.spend, c.spend), impressions: Math.max(t.impressions, c.impressions),
    clicks: Math.max(t.clicks, c.clicks), conv: Math.max(t.conv, c.conv),
  }), { spend: 0, impressions: 0, clicks: 0, conv: 0 });
  const deel = (v: number, max: number) => (max > 0 ? v / max : 0);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <Tabel>
        <Kop>
          <KolomKop breed>Campagne</KolomKop>
          <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
          <KolomKop getal>Vertoningen</KolomKop>
          <KolomKop getal>Klikken</KolomKop>
          <KolomKop getal>CTR</KolomKop>
          <KolomKop getal>{convLabel}</KolomKop>
          <KolomKop getal>{useLeadsLabel ? "CPL" : "CPA"}</KolomKop>
        </Kop>
        <Body>
          {campaigns.map((c) => (
            <Rij key={c.entity}>
              <NaamCel>{names.get(c.entity) ?? c.entity}</NaamCel>
              <AandeelCel waarde={eur(c.spend)} aandeel={deel(c.spend, grootste.spend)} />
              <AandeelCel waarde={fmt(c.impressions)} aandeel={deel(c.impressions, grootste.impressions)} />
              <AandeelCel waarde={fmt(c.clicks)} aandeel={deel(c.clicks, grootste.clicks)} />
              <GetalCel>{pctS(ctr(c))}</GetalCel>
              <AandeelCel waarde={fmt(c.conv, 1)} aandeel={deel(c.conv, grootste.conv)} />
              <GetalCel>{eur(cpa(c))}</GetalCel>
            </Rij>
          ))}
        </Body>
        <TotaalRij>
          <TotaalCel>Totaal</TotaalCel>
          <TotaalCel getal>{eur(som.spend)}</TotaalCel>
          <TotaalCel getal>{fmt(som.impressions)}</TotaalCel>
          <TotaalCel getal>{fmt(som.clicks)}</TotaalCel>
          <TotaalCel getal>{pctS(ctr(som))}</TotaalCel>
          <TotaalCel getal>{fmt(som.conv, 1)}</TotaalCel>
          <TotaalCel getal>{eur(cpa(som))}</TotaalCel>
        </TotaalRij>
      </Tabel>
    </div>
  );
}
