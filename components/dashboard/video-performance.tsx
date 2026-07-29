"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_VIDEO_ROWS } from "@/lib/demo/video-demo";
import { CollapsiblePanel } from "@/components/ui/disclosure";
import {
  aggregateVideoCampaigns, diagnoseVideo, VIDEO_DIAGNOSIS_LABEL, VIDEO_DIAGNOSIS_EXPLAIN,
  type VideoCampaignRow, type VideoDiagnosis,
} from "@/lib/video/video-performance";

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
        <div key={s.label} className="flex flex-col items-center gap-0.5 w-9">
          <div className="w-full h-6 bg-slate-100 rounded-sm relative overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 bg-rm-blue/70 rounded-sm"
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
    return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;
  }
  // Geen videocampagnes: niets tonen. Een lege videokaart onder een Search-account is ruis.
  if (aggs.length === 0) return null;

  return (
    <CollapsiblePanel
      id="video-prestaties"
      icon={<PlayCircle className="w-4.5 h-4.5 text-rm-blue" />}
      title="Video (YouTube)"
      subtitle="beoordeeld op bereik en kijkgedrag — niet op klikken of CPA"
      meta={<span className="text-micro text-muted-foreground">{aggs.length} campagne{aggs.length === 1 ? "" : "s"}</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-medium">Campagne</th>
              <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
              <th className="px-3 py-2 font-medium text-right">Views</th>
              <th className="px-3 py-2 font-medium text-right">View rate</th>
              <th className="px-3 py-2 font-medium text-right">CPM</th>
              <th className="px-3 py-2 font-medium text-right">CPV</th>
              <th className="px-3 py-2 font-medium">Kijkdiepte</th>
              <th className="px-5 py-2 font-medium">Duiding</th>
            </tr>
          </thead>
          <tbody>
            {aggs.map((a) => {
              const d = diagnoseVideo(a);
              return (
                <tr key={a.campaignId} className="border-b border-border/50 align-middle">
                  <td className="px-5 py-2 text-rm-gray font-medium">{a.campaignName}</td>
                  <td className="px-3 py-2 text-right">{int(a.impressions)}</td>
                  <td className="px-3 py-2 text-right">{int(a.videoViews)}</td>
                  <td className="px-3 py-2 text-right">{pct(a.viewRate)}</td>
                  <td className="px-3 py-2 text-right">{eur2(a.cpm)}</td>
                  <td className="px-3 py-2 text-right">{eurCpv(a.cpv)}</td>
                  <td className="px-3 py-2"><QuartileBar p25={a.p25} p50={a.p50} p75={a.p75} p100={a.p100} /></td>
                  <td className="px-5 py-2">
                    <span
                      className={`inline-block rounded-md border px-1.5 py-0.5 text-micro font-medium ${DIAGNOSIS_STYLE[d]}`}
                      title={VIDEO_DIAGNOSIS_EXPLAIN[d]}
                    >
                      {VIDEO_DIAGNOSIS_LABEL[d]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* De duiding uitgeschreven: een badge alleen laat de lezer raden wat te doen. */}
      <div className="px-5 py-3 border-t border-border space-y-1">
        {[...new Set(aggs.map((a) => diagnoseVideo(a)))].map((d) => (
          <p key={d} className="text-meta text-muted-foreground">
            <strong className="text-rm-gray">{VIDEO_DIAGNOSIS_LABEL[d]}:</strong> {VIDEO_DIAGNOSIS_EXPLAIN[d]}
          </p>
        ))}
      </div>
    </CollapsiblePanel>
  );
}
