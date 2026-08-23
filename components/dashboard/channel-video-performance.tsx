"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayCircle } from "lucide-react";
import { dbSelect } from "@/lib/data-access/client-read";
import { CollapsiblePanel } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import { Laadvlak } from "@/components/ui/laadvlak";
import { CONFIG, type ChannelKind } from "./channel-performance";

// Meta/LinkedIn-equivalent van Google's "Waar het budget landt" (23 augustus 2026) -- alleen het
// campagne-niveau videodeel (VideoPerformance), niet Google's placement-uitsluitingsadvies
// (VideoPlacements): dat leest ads_video_placements, een YouTube-specifiek placementrapport
// zonder Meta/LinkedIn-equivalent. Wat hier wél staat is echt: Meta syncet al hook_rate/hold_rate/
// video_thruplay per campagne, LinkedIn al video_starts/views/completion_rate -- beide ongebruikt
// buiten de objective-analyse tot nu.

interface MetaVideoRow { entity: string; impressions: number; spend: number; thruplay: number; hookRate: number; holdRate: number; n: number }
interface LinkedInVideoRow { entity: string; impressions: number; spend: number; views: number; completions: number; completionRate: number; n: number }

const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));
const eur2 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v));
const eurCpv = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v));

function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }

export function ChannelVideoPerformance({ clientId, channel }: { clientId: string; channel: ChannelKind }) {
  const cfg = CONFIG[channel];
  const [rows, setRows] = useState<(MetaVideoRow | LinkedInVideoRow)[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

    const select = channel === "meta"
      ? "entity_id, impressions, spend, video_thruplay, hook_rate, hold_rate"
      : "entity_urn, impressions, spend, video_views, video_completions, video_completion_rate";
    const entityField = channel === "meta" ? "entity_id" : "entity_urn";

    Promise.all([
      dbSelect<Record<string, unknown>>(cfg.campaignTable, { select, clientId, filters: [{ op: "gte", column: "date", value: since }] }),
      dbSelect<Record<string, unknown>>(cfg.nameTable, { select: `${cfg.nameId}, name`, clientId }),
    ]).then(([dailyRes, nameRes]) => {
      if (cancelled) return;
      setNames(new Map(((nameRes.data ?? []) as Record<string, unknown>[]).map((r) => [String(r[cfg.nameId]), String(r.name ?? r[cfg.nameId])])));

      const byEntity = new Map<string, MetaVideoRow | LinkedInVideoRow>();
      for (const r of (dailyRes.data ?? []) as Record<string, unknown>[]) {
        const entity = String(r[entityField] ?? "");
        if (!entity) continue;
        if (channel === "meta") {
          const a = (byEntity.get(entity) as MetaVideoRow | undefined) ?? { entity, impressions: 0, spend: 0, thruplay: 0, hookRate: 0, holdRate: 0, n: 0 };
          a.impressions += num(r.impressions); a.spend += num(r.spend); a.thruplay += num(r.video_thruplay);
          a.hookRate += num(r.hook_rate); a.holdRate += num(r.hold_rate); a.n += 1;
          byEntity.set(entity, a);
        } else {
          const a = (byEntity.get(entity) as LinkedInVideoRow | undefined) ?? { entity, impressions: 0, spend: 0, views: 0, completions: 0, completionRate: 0, n: 0 };
          a.impressions += num(r.impressions); a.spend += num(r.spend); a.views += num(r.video_views);
          a.completions += num(r.video_completions); a.completionRate += num(r.video_completion_rate); a.n += 1;
          byEntity.set(entity, a);
        }
      }
      setRows([...byEntity.values()]);
    }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId, channel, cfg]);

  // Alleen campagnes met echt videosignaal: een lege videokaart onder een account zonder
  // videocreatives is ruis, zelfde afvang als Google's VideoPerformance.
  const aggs = useMemo(() => {
    if (!rows) return [];
    if (channel === "meta") {
      return (rows as MetaVideoRow[]).filter((r) => r.thruplay > 0).sort((a, b) => b.spend - a.spend);
    }
    return (rows as LinkedInVideoRow[]).filter((r) => r.views > 0).sort((a, b) => b.spend - a.spend);
  }, [rows, channel]);

  if (rows === null) return <Laadvlak vorm="tabel" regels={2} titel="Video" />;
  if (aggs.length === 0) return null;

  const grootsteBereik = Math.max(0, ...aggs.map((a) => a.impressions));

  return (
    <CollapsiblePanel
      id={`video-prestaties-${channel}`}
      icon={<PlayCircle className="w-4.5 h-4.5 text-brand-blue-ink" />}
      title="Video"
      subtitle="beoordeeld op bereik en kijkgedrag — niet op klikken of CPA"
      meta={<span className="text-micro text-muted-foreground">{aggs.length} campagne{aggs.length === 1 ? "" : "s"}</span>}
    >
      {channel === "meta" ? (
        <MetaVideoTabel rows={aggs as MetaVideoRow[]} names={names} grootsteBereik={grootsteBereik} />
      ) : (
        <LinkedInVideoTabel rows={aggs as LinkedInVideoRow[]} names={names} grootsteBereik={grootsteBereik} />
      )}
    </CollapsiblePanel>
  );
}

function MetaVideoTabel({ rows, names, grootsteBereik }: { rows: MetaVideoRow[]; names: Map<string, string>; grootsteBereik: number }) {
  const totaal = rows.reduce((t, a) => ({ impressions: t.impressions + a.impressions, spend: t.spend + a.spend, thruplay: t.thruplay + a.thruplay }), { impressions: 0, spend: 0, thruplay: 0 });
  return (
    <Tabel>
      <Kop>
        <KolomKop breed>Campagne</KolomKop>
        <KolomKop getal bijschrift="aandeel">Vertoningen</KolomKop>
        <KolomKop getal>Thruplays</KolomKop>
        <KolomKop getal>Hook rate</KolomKop>
        <KolomKop getal>Hold rate</KolomKop>
        <KolomKop getal>CPM</KolomKop>
        <KolomKop getal>CPV</KolomKop>
      </Kop>
      <Body>
        {rows.map((a) => (
          <Rij key={a.entity}>
            <NaamCel>{names.get(a.entity) ?? a.entity}</NaamCel>
            <AandeelCel waarde={int(a.impressions)} aandeel={grootsteBereik > 0 ? a.impressions / grootsteBereik : 0} />
            <GetalCel>{int(a.thruplay)}</GetalCel>
            <GetalCel zacht>{pct(a.n > 0 ? a.hookRate / a.n : null)}</GetalCel>
            <GetalCel zacht>{pct(a.n > 0 ? a.holdRate / a.n : null)}</GetalCel>
            <GetalCel zacht>{eur2(a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null)}</GetalCel>
            <GetalCel zacht>{eurCpv(a.thruplay > 0 ? a.spend / a.thruplay : null)}</GetalCel>
          </Rij>
        ))}
      </Body>
      <TotaalRij>
        <TotaalCel>Alle campagnes ({rows.length})</TotaalCel>
        <TotaalCel getal>{int(totaal.impressions)}</TotaalCel>
        <TotaalCel getal>{int(totaal.thruplay)}</TotaalCel>
        <TotaalCel>{""}</TotaalCel>
        <TotaalCel>{""}</TotaalCel>
        <TotaalCel getal>{eur2(totaal.impressions > 0 ? (totaal.spend / totaal.impressions) * 1000 : null)}</TotaalCel>
        <TotaalCel getal>{eurCpv(totaal.thruplay > 0 ? totaal.spend / totaal.thruplay : null)}</TotaalCel>
      </TotaalRij>
    </Tabel>
  );
}

function LinkedInVideoTabel({ rows, names, grootsteBereik }: { rows: LinkedInVideoRow[]; names: Map<string, string>; grootsteBereik: number }) {
  const totaal = rows.reduce((t, a) => ({ impressions: t.impressions + a.impressions, spend: t.spend + a.spend, views: t.views + a.views }), { impressions: 0, spend: 0, views: 0 });
  return (
    <Tabel>
      <Kop>
        <KolomKop breed>Campagne</KolomKop>
        <KolomKop getal bijschrift="aandeel">Vertoningen</KolomKop>
        <KolomKop getal>Views</KolomKop>
        <KolomKop getal>Completion rate</KolomKop>
        <KolomKop getal>CPM</KolomKop>
        <KolomKop getal>CPV</KolomKop>
      </Kop>
      <Body>
        {rows.map((a) => (
          <Rij key={a.entity}>
            <NaamCel>{names.get(a.entity) ?? a.entity}</NaamCel>
            <AandeelCel waarde={int(a.impressions)} aandeel={grootsteBereik > 0 ? a.impressions / grootsteBereik : 0} />
            <GetalCel>{int(a.views)}</GetalCel>
            <GetalCel zacht>{pct(a.n > 0 ? a.completionRate / a.n : null)}</GetalCel>
            <GetalCel zacht>{eur2(a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null)}</GetalCel>
            <GetalCel zacht>{eurCpv(a.views > 0 ? a.spend / a.views : null)}</GetalCel>
          </Rij>
        ))}
      </Body>
      <TotaalRij>
        <TotaalCel>Alle campagnes ({rows.length})</TotaalCel>
        <TotaalCel getal>{int(totaal.impressions)}</TotaalCel>
        <TotaalCel getal>{int(totaal.views)}</TotaalCel>
        <TotaalCel>{""}</TotaalCel>
        <TotaalCel getal>{eur2(totaal.impressions > 0 ? (totaal.spend / totaal.impressions) * 1000 : null)}</TotaalCel>
        <TotaalCel getal>{eurCpv(totaal.views > 0 ? totaal.spend / totaal.views : null)}</TotaalCel>
      </TotaalRij>
    </Tabel>
  );
}
