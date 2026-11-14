"use client";

import { useEffect, useMemo, useState } from "react";
import { dbSelect } from "@/lib/data-access/client-read";
import { loadClientSettingsRij } from "@/lib/client-settings";
import { matchGeoCloneByCampaignName } from "@/lib/fair/geo-clone-catalog";
import { resolveChannelConversionConfig, sumSelectedConversions, selectedConversionLabels, type ChannelConversionConfig } from "@/lib/analysis/channel-conversion-config";
import { Laadvlak } from "@/components/ui/laadvlak";
import { today } from "@/lib/reporting-date";
import { eersteDagVanVenster } from "@/lib/period/dag-venster";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { CONFIG, eur, fmt, pctS, type ChannelKind, type DailyRow } from "./channel-performance";
import { usePeriod } from "@/lib/period/period-context";
import { uitMaandPeriode, type DagPeriode } from "@/lib/period/dag-periode";
import { telCampagnes, vergelijkCampagnes, type CampagneRij, type CampagneSom } from "@/lib/campagnes/campagne-periode";
import { useCampagnePeriode } from "@/lib/campagnes/use-campagne-periode";
import { Vensterlabel } from "@/components/ui/vensterlabel";
import { CampagneStatusCel } from "./campagne-verandering";

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

/**
 * Met de schakelaar uit (`nieuw` false) precies de tabel van altijd, over de laatste 28 dagen
 * (ChannelCampaignTableVast, ongewijzigd). In de nieuwe weergave over de gekozen periode per dag, met
 * de verandering per campagne (ChannelCampaignTablePeriode).
 */
export function ChannelCampaignTable({ clientId, channel, geoClone, nieuw = false }: { clientId: string; channel: ChannelKind; geoClone?: string | null; nieuw?: boolean }) {
  return nieuw
    ? <ChannelCampaignTablePeriode clientId={clientId} channel={channel} geoClone={geoClone} />
    : <ChannelCampaignTableVast clientId={clientId} channel={channel} geoClone={geoClone} />;
}

function ChannelCampaignTableVast({ clientId, channel, geoClone }: { clientId: string; channel: ChannelKind; geoClone?: string | null }) {
  const cfg = CONFIG[channel];
  const [campaign, setCampaign] = useState<DailyRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [convConfig, setConvConfig] = useState<ChannelConversionConfig>(() => resolveChannelConversionConfig(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCampaign(null); setError(null);
    // 28 kalenderdagen in Amsterdam, vandaag meegeteld: hetzelfde venster als de kerncijfers
    // erboven (lib/period/dag-venster.ts). Hier stonden 29 UTC-dagen.
    const since = eersteDagVanVenster(today(), 28);
    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.campaignTable, { select: cfg.select, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
      dbSelect<Record<string, unknown>>(cfg.nameTable, { select: `${cfg.nameId}, name`, clientId }),
      loadClientSettingsRij(clientId),
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

// ── De nieuwe weergave: over de gekozen periode, per dag ─────────────────────────────────────────
//
// Dezelfde lezing en dezelfde regels als "Wat er draait" bij Alle kanalen (lib/campagnes/): de
// campagne-dagtabel van dit kanaal over de periode en de vergelijkingsperiode, met de selectie van
// de klant, en een verandering alleen waar hij eerlijk is. De rijen van Alle kanalen en van deze tab
// delen de cache, dus een wissel tussen de twee kost geen verzoek.

function ChannelCampaignTablePeriode({ clientId, channel, geoClone }: { clientId: string; channel: ChannelKind; geoClone?: string | null }) {
  const cfg = CONFIG[channel];
  const periode = usePeriod();
  const p: DagPeriode = periode.dag?.periode ?? uitMaandPeriode(periode.range);
  const c: DagPeriode | null = periode.dag
    ? (periode.dag.keuze.vergelijk === "none" ? null : periode.dag.vergelijking.periode)
    : (periode.compareRange ? uitMaandPeriode(periode.compareRange) : null);
  const vergelijkLabel = periode.dag ? periode.dag.vergelijking.label : "de vergelijkingsperiode";
  const kanalen = useMemo(() => [channel], [channel]);
  const staat = useCampagnePeriode({ clientId, kanalen, periode: p, vergelijking: c, actief: true });

  const uit = useMemo(() => {
    const r = staat.rijen?.[channel];
    if (!r) return null;
    const inScope = (x: CampagneRij) => !geoClone || matchGeoCloneByCampaignName(x.naam)?.abbreviation === geoClone;
    const bron = { kanaal: channel, dagen: r.dagen.filter(inScope), maanden: [], bronStart: r.bronStart };
    const nu = telCampagnes(p, bron);
    const toen = c ? telCampagnes(c, bron) : null;
    return { nu, toen, vergelijking: vergelijkCampagnes(nu, toen) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staat.rijen, channel, geoClone, p.start, p.eind, c?.start, c?.eind]);

  if (staat.fouten.length > 0) return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{staat.fouten.join(" · ")}</div>;
  if (staat.laden || !uit) return <Laadvlak vorm="tabel" regels={6} />;
  const regels = uit.vergelijking.regels;
  if (regels.length === 0) return <p className="py-6 text-center text-body text-muted-foreground">Geen campagne die in deze periode liep.</p>;

  const convLabel = staat.convConfig ? selectedConversionLabels(cfg.channelKey, staat.convConfig).join(" + ") : "Conversies";
  const useLeadsLabel = cfg.channelKey === "linkedin_ads";
  const metVergelijking = uit.toen !== null;
  const ctr = (a: CampagneSom): number | null => (a.impressions > 0 ? a.clicks / a.impressions : null);
  const cpa = (a: CampagneSom): number | null => (a.conversions > 0 ? a.spend / a.conversions : null);
  const grootste = (f: (a: CampagneSom) => number) => Math.max(0, ...regels.map(f));
  const max = { spend: grootste((a) => a.spend), impressions: grootste((a) => a.impressions), clicks: grootste((a) => a.clicks), conv: grootste((a) => a.conversions) };
  const deel = (v: number, m: number) => (m > 0 ? v / m : 0);
  const som = uit.nu.totaal;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 pt-3 flex flex-wrap items-center gap-2">
        <Vensterlabel soort="periode" perDag />
      </div>
      {metVergelijking && uit.vergelijking.reden && <p className="px-5 pt-2 text-meta text-muted-foreground">{uit.vergelijking.reden}</p>}
      <Tabel>
        <Kop>
          <KolomKop breed>Campagne</KolomKop>
          <KolomKop getal bijschrift="aandeel">Spend</KolomKop>
          <KolomKop getal>Vertoningen</KolomKop>
          <KolomKop getal>Klikken</KolomKop>
          <KolomKop getal>CTR</KolomKop>
          <KolomKop getal>{convLabel}</KolomKop>
          <KolomKop getal>{useLeadsLabel ? "CPL" : "CPA"}</KolomKop>
          {metVergelijking && <KolomKop getal bijschrift={`t.o.v. ${vergelijkLabel.toLowerCase()}`}>Verandering</KolomKop>}
        </Kop>
        <Body>
          {regels.map((r) => (
            <Rij key={r.sleutel}>
              <NaamCel>{r.naam}</NaamCel>
              <AandeelCel waarde={eur(r.spend)} aandeel={deel(r.spend, max.spend)} />
              <AandeelCel waarde={fmt(r.impressions)} aandeel={deel(r.impressions, max.impressions)} />
              <AandeelCel waarde={fmt(r.clicks)} aandeel={deel(r.clicks, max.clicks)} />
              <GetalCel>{pctS(ctr(r))}</GetalCel>
              <AandeelCel waarde={fmt(r.conversions, 1)} aandeel={deel(r.conversions, max.conv)} />
              <GetalCel>{eur(cpa(r))}</GetalCel>
              {metVergelijking && <CampagneStatusCel r={r} />}
            </Rij>
          ))}
        </Body>
        <TotaalRij>
          <TotaalCel>Totaal</TotaalCel>
          {/* Met een beurs geen merkteken: dan is dit het totaal van de beurs, niet van het kanaal. */}
          <TotaalCel getal>{geoClone ? eur(som.spend) : <span data-cijfer="campagnes-totaal-kosten" data-kanaal={channel}>{eur(som.spend)}</span>}</TotaalCel>
          <TotaalCel getal>{fmt(som.impressions)}</TotaalCel>
          <TotaalCel getal>{fmt(som.clicks)}</TotaalCel>
          <TotaalCel getal>{pctS(ctr(som))}</TotaalCel>
          <TotaalCel getal>{geoClone ? fmt(som.conversions, 1) : <span data-cijfer="campagnes-totaal-conversies" data-kanaal={channel}>{fmt(som.conversions, 1)}</span>}</TotaalCel>
          <TotaalCel getal>{eur(cpa(som))}</TotaalCel>
          {metVergelijking && <TotaalCel getal><span className="sr-only">geen verandering voor het totaal</span></TotaalCel>}
        </TotaalRij>
      </Tabel>
    </div>
  );
}
