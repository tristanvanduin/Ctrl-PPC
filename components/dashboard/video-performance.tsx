"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_VIDEO_ROWS } from "@/lib/demo/video-demo";
import { CollapsiblePanel } from "@/components/ui/disclosure";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel, GetalCel, AandeelCel, TotaalRij, TotaalCel } from "./data-table";
import {
  aggregateVideoCampaigns, diagnoseVideo, VIDEO_DIAGNOSIS_LABEL, VIDEO_DIAGNOSIS_EXPLAIN,
  type VideoCampaignRow, type VideoDiagnosis,
} from "@/lib/video/video-performance";
import { Laadvlak } from "@/components/ui/laadvlak";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// YouTube/Demand Gen-prestaties met de maten die bij video horen: CPM (wat kost bereik), CPV (wat
// kost een view), view rate en kijkdiepte. Verschijnt alléén als er echt videocampagnes draaien —
// een lege videokaart onder een puur Search-account is ruis.

const eur2 = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v));
// CPV ligt doorgaans tussen een halve en enkele centen; op twee decimalen wordt €0,018 en €0,036
// allebei "€0,02" en verdwijnt een verschil van een factor twee. Vandaar drie decimalen.
const eurCpv = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v));
const pct = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("nl-NL", { style: "percent", maximumFractionDigits: 1 }).format(v));
const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);

const DIAGNOSIS_STYLE: Record<VideoDiagnosis, string> = {
  hook_zwak: "bg-amber-50 text-amber-800 border-amber-200",
  boodschap_landt: "bg-emerald-50 text-emerald-800 border-emerald-200",
  middenmoot: "bg-slate-50 text-slate-700 border-slate-200",
  te_weinig_data: "bg-slate-50 text-muted-foreground border-slate-200",
};

// De kijkdiepte-balk: p25 -> p100 loopt altijd aflopend, dus één balk met vier merktekens leest
// beter dan vier losse getallen. Toont waar de afhaak zit.
function QuartileBar({ p25, p50, p75, p100 }: { p25: number | null; p50: number | null; p75: number | null; p100: number | null }) {
  if (p25 == null) return <span className="text-muted-foreground">—</span>;
  const steps = [
    { label: "25%", v: p25 },
    { label: "50%", v: p50 },
    { label: "75%", v: p75 },
    { label: "100%", v: p100 },
  ];
  return (
    <div className="flex items-end gap-1 h-9" role="img" aria-label={`Kijkdiepte: ${steps.map((s) => `${s.label} ${pct(s.v)}`).join(", ")}`}>
      {steps.map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-0.5 w-6">
          {/* Zes eenheden breed en niet negen: het plafond uit de mark-specificatie is
              vierentwintig pixels, en dit stond op zesendertig. Bij een verzadigde vulling leest
              zo'n breedte als een verfvlak in plaats van als een meetwaarde — dezelfde correctie
              als bij de staafdiagrammen.

              De baan komt uit `--spoor`, net als bij de aandeelstrepen; hij stond op `slate-100`,
              een vaste tint die niets van het thema weet. En alleen de bovenkant is afgerond: aan
              de basislijn hoort een balk vierkant te eindigen, want daar begint hij niet — daar
              stáát hij op. */}
          <div className="w-full h-6 rounded-sm relative overflow-hidden" style={{ background: "var(--spoor, rgba(15,23,42,0.07))" }}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-brand-blue/70 rounded-t-sm"
              style={{ height: `${Math.max(2, Math.min(100, (s.v ?? 0) * 100))}%` }}
            />
          </div>
          <span className="text-micro text-muted-foreground leading-none">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function VideoPerformance({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<VideoCampaignRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isDemoMode()) { setRows(DEMO_VIDEO_ROWS); return; }

    const sb = supabase;
    if (!sb) { setRows([]); return; }
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    sb.from("ads_campaign_monthly")
      .select("campaign_id, campaign_name, campaign_type, month, impressions, cost, video_views, avg_cpm, avg_cpv, video_view_rate, video_quartile_p25, video_quartile_p50, video_quartile_p75, video_quartile_p100")
      .eq("client_id", clientId)
      .gte("month", since)
      .gt("video_views", 0)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (cancelled) return;
        setRows((data ?? []).map((r) => ({
          campaignId: String(r.campaign_id ?? ""),
          campaignName: String(r.campaign_name ?? ""),
          campaignType: (r.campaign_type as string) ?? null,
          month: String(r.month ?? ""),
          impressions: Number(r.impressions ?? 0),
          cost: Number(r.cost ?? 0),
          videoViews: Number(r.video_views ?? 0),
          avgCpm: Number(r.avg_cpm ?? 0),
          avgCpv: Number(r.avg_cpv ?? 0),
          videoViewRate: Number(r.video_view_rate ?? 0),
          videoQuartileP25: Number(r.video_quartile_p25 ?? 0),
          videoQuartileP50: Number(r.video_quartile_p50 ?? 0),
          videoQuartileP75: Number(r.video_quartile_p75 ?? 0),
          videoQuartileP100: Number(r.video_quartile_p100 ?? 0),
        })));
      }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId]);

  const aggs = useMemo(() => {
    if (!rows) return [];
    return aggregateVideoCampaigns(rows).sort((a, b) => b.cost - a.cost);
  }, [rows]);

  if (rows === null) {
    return <Laadvlak vorm="tabel" regels={2} titel="Video (YouTube)" />;
  }
  // Geen videocampagnes: niets tonen. Een lege videokaart onder een Search-account is ruis.
  if (aggs.length === 0) return null;

  return (
    <CollapsiblePanel
      id="video-prestaties"
      icon={<PlayCircle className="w-4.5 h-4.5 text-brand-blue-ink" />}
      title="Video (YouTube)"
      subtitle="beoordeeld op bereik en kijkgedrag — niet op klikken of CPA"
      meta={<span className="text-micro text-muted-foreground">{aggs.length} campagne{aggs.length === 1 ? "" : "s"}</span>}
    >
      {(() => {
        const totaal = aggs.reduce(
          (t, a) => ({ impressions: t.impressions + a.impressions, videoViews: t.videoViews + a.videoViews, cost: t.cost + a.cost }),
          { impressions: 0, videoViews: 0, cost: 0 },
        );
        const grootsteBereik = Math.max(0, ...aggs.map((a) => a.impressions));
        return (
          <Tabel>
            <Kop>
              <KolomKop breed>Campagne</KolomKop>
              <KolomKop getal bijschrift="aandeel">Vertoningen</KolomKop>
              <KolomKop getal>Views</KolomKop>
              <KolomKop getal>View rate</KolomKop>
              <KolomKop getal>CPM</KolomKop>
              <KolomKop getal>CPV</KolomKop>
              <KolomKop>Kijkdiepte</KolomKop>
              <KolomKop>Duiding</KolomKop>
            </Kop>
            <Body>
              {aggs.map((a) => {
                const d = diagnoseVideo(a);
                return (
                  <Rij key={a.campaignId}>
                    <NaamCel>{a.campaignName}</NaamCel>
                    {/* De streep op vertoningen: dit paneel beoordeelt op bereik, en dan is de
                        eerste vraag welke campagne het bereik draagt. Op view rate, CPM en CPV
                        staat er geen — dat zijn verhoudingen. */}
                    <AandeelCel waarde={int(a.impressions)} aandeel={grootsteBereik > 0 ? a.impressions / grootsteBereik : 0} />
                    <GetalCel>{int(a.videoViews)}</GetalCel>
                    <GetalCel zacht>{pct(a.viewRate)}</GetalCel>
                    <GetalCel zacht>{eur2(a.cpm)}</GetalCel>
                    <GetalCel zacht>{eurCpv(a.cpv)}</GetalCel>
                    <Cel><QuartileBar p25={a.p25} p50={a.p50} p75={a.p75} p100={a.p100} /></Cel>
                    {/* De badge IS de trigger. Hieronder stond dezelfde uitleg nog een keer als
                        alinea, en in het badge-attribuut een derde keer -- drie kopieën van een
                        zin die je één keer leest en daarna nooit meer. Een echte hover haalt hem
                        binnen bereik van toetsenbord en aanraking, wat een title-attribuut geen
                        van beide doet. */}
                    <Cel>
                      <Tooltip>
                        <TooltipTrigger
                          className={`inline-block cursor-help rounded-md border px-1.5 py-0.5 text-micro font-medium whitespace-nowrap ${DIAGNOSIS_STYLE[d]}`}
                        >
                          {VIDEO_DIAGNOSIS_LABEL[d]}
                        </TooltipTrigger>
                        {/* In een `block`, net als in components/ui/uitleg.tsx: de bubbel is een
                            inline-flex met gap, dus losse kinderen worden kolommen. Hier is het nu
                            één string en zou het goed gaan, maar de volgende die er een <strong>
                            bij zet ziet de tekst uiteenvallen zonder te weten waarom. */}
                        <TooltipContent side="left" className="max-w-72 items-start text-left leading-snug">
                          <span className="block">{VIDEO_DIAGNOSIS_EXPLAIN[d]}</span>
                        </TooltipContent>
                      </Tooltip>
                    </Cel>
                  </Rij>
                );
              })}
            </Body>
            {/* View rate, CPM en CPV uit de totalen en niet als gemiddelde van de campagnewaarden:
                anders weegt een campagne met duizend vertoningen even zwaar als een met een miljoen.
                De kijkdiepte krijgt geen totaal — die is per campagne al naar vertoningen gewogen,
                en een balk over alle campagnes samen zou een gemiddelde tonen dat niemand bekijkt. */}
            <TotaalRij>
              <TotaalCel>Alle campagnes ({aggs.length})</TotaalCel>
              <TotaalCel getal>{int(totaal.impressions)}</TotaalCel>
              <TotaalCel getal>{int(totaal.videoViews)}</TotaalCel>
              <TotaalCel getal>{pct(totaal.impressions > 0 ? totaal.videoViews / totaal.impressions : null)}</TotaalCel>
              <TotaalCel getal>{eur2(totaal.impressions > 0 ? (totaal.cost / totaal.impressions) * 1000 : null)}</TotaalCel>
              <TotaalCel getal>{eurCpv(totaal.videoViews > 0 ? totaal.cost / totaal.videoViews : null)}</TotaalCel>
              <TotaalCel>{""}</TotaalCel>
              <TotaalCel>{""}</TotaalCel>
            </TotaalRij>
          </Tabel>
        );
      })()}

    </CollapsiblePanel>
  );
}
