"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Ban, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { DEMO_PLACEMENTS } from "@/lib/demo/video-demo";
import {
  aggregatePlacements, judgePlacements, wastedSpend, placementTypeLabel,
  type PlacementInput, type PlacementVerdict,
} from "@/lib/video/placement-analysis";

// Waar het videobudget landde, met een voorstel welke placements uit te sluiten. Bij YouTube kiest
// Google de plek; dit maakt zichtbaar wat dat oplevert. Bewust een voorstel met onderbouwing en
// geen knop die het meteen doet — uitsluiten is in zijn effect lastig terug te draaien.

const eur = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const int = (v: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(v);

const VERDICT_LABEL: Record<PlacementVerdict, string> = {
  uitsluiten: "Uitsluiten",
  bekijken: "Bekijken",
  houden: "Houden",
  te_weinig_data: "Te weinig data",
};

const VERDICT_STYLE: Record<PlacementVerdict, string> = {
  uitsluiten: "bg-red-50 text-red-800 border-red-200",
  bekijken: "bg-amber-50 text-amber-800 border-amber-200",
  houden: "bg-emerald-50 text-emerald-800 border-emerald-200",
  te_weinig_data: "bg-slate-50 text-muted-foreground border-slate-200",
};

// Volgorde waarin de tabel leest: eerst waar actie op zit.
const VERDICT_ORDER: PlacementVerdict[] = ["uitsluiten", "bekijken", "houden", "te_weinig_data"];

export function VideoPlacements({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<PlacementInput[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isDemoMode()) { setRows(DEMO_PLACEMENTS); return; }

    const sb = supabase;
    if (!sb) { setRows([]); return; }
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    sb.from("ads_video_placements")
      .select("placement, display_name, placement_type, target_url, campaign_name, impressions, clicks, cost, conversions, video_views, metrics_complete, source")
      .eq("client_id", clientId)
      .gte("month", since)
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        if (cancelled) return;
        setRows((data ?? []).map((r) => ({
          placement: String(r.placement ?? ""),
          displayName: String(r.display_name ?? ""),
          placementType: String(r.placement_type ?? "UNKNOWN"),
          targetUrl: String(r.target_url ?? ""),
          campaignName: String(r.campaign_name ?? ""),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          cost: Number(r.cost ?? 0),
          conversions: Number(r.conversions ?? 0),
          videoViews: Number(r.video_views ?? 0),
          metricsComplete: r.metrics_complete !== false,
          source: (r.source === "pmax" ? "pmax" : "video") as "video" | "pmax",
        })));
      }, () => { if (!cancelled) setRows([]); });

    return () => { cancelled = true; };
  }, [clientId]);

  const judged = useMemo(() => {
    if (!rows) return [];
    return judgePlacements(aggregatePlacements(rows))
      .sort((a, b) => {
        const d = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
        return d !== 0 ? d : b.agg.cost - a.agg.cost;
      });
  }, [rows]);

  const waste = useMemo(() => wastedSpend(judged), [judged]);
  const excluding = judged.filter((j) => j.verdict === "uitsluiten");
  // Gescheiden tellen: van PMax-placements kent Google de kosten niet, dus die mogen niet
  // meegeteld worden in een bedrag. Ze wel meetellen zou het bedrag te laag of te stellig maken.
  const withCost = excluding.filter((j) => j.agg.metricsComplete);
  const impressionsOnly = excluding.filter((j) => !j.agg.metricsComplete);

  if (rows === null) {
    return <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-rm-blue" /></div>;
  }
  if (judged.length === 0) return null; // geen videoplacements: niets te tonen

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Ban className="w-4.5 h-4.5 text-rm-blue" />
        <h3 className="text-sm font-semibold text-rm-gray">Waar je video&apos;s draaien</h3>
        <span className="text-[11px] text-muted-foreground">voorstel welke placements uit te sluiten</span>
      </div>

      {excluding.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-red-50/50 space-y-1">
          {withCost.length > 0 && (
            <p className="text-[12px] text-rm-gray">
              <strong>{withCost.length} placement{withCost.length === 1 ? "" : "s"}</strong> kostte{withCost.length === 1 ? "" : "n"} samen{" "}
              <strong>{eur(waste)}</strong> zonder één conversie. Uitsluiten geeft dat budget terug aan de plekken die wél werken.
            </p>
          )}
          {impressionsOnly.length > 0 && (
            <p className="text-[12px] text-rm-gray">
              Daarnaast {impressionsOnly.length === 1 ? "staat er 1 plaatsing" : `staan er ${impressionsOnly.length} plaatsingen`} uit{" "}
              <strong>Performance Max</strong> met samen {int(impressionsOnly.reduce((s, j) => s + j.agg.impressions, 0))} vertoningen.
              Google geeft daar geen kosten of conversies bij, dus wat die precies kosten is niet te zeggen.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Uit te sluiten in Google Ads via de campagne → Content → Uitsluitingen; voor Performance Max
            alleen accountbreed. Dit dashboard doet het niet automatisch: eenmaal uitgesloten leer je
            niets meer over die plek.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-medium">Placement</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium text-right">Vertoningen</th>
              <th className="px-3 py-2 font-medium text-right">Kosten</th>
              <th className="px-3 py-2 font-medium text-right">Views</th>
              <th className="px-3 py-2 font-medium text-right">Klikken</th>
              <th className="px-3 py-2 font-medium text-right">Conv.</th>
              <th className="px-3 py-2 font-medium text-right">CPA</th>
              <th className="px-5 py-2 font-medium">Advies</th>
            </tr>
          </thead>
          <tbody>
            {judged.map(({ agg, verdict, reason }) => (
              <tr key={agg.placement} className="border-b border-border/50 align-top">
                <td className="px-5 py-2">
                  <div className="text-rm-gray font-medium flex items-center gap-1">
                    {agg.displayName || agg.placement}
                    {agg.targetUrl && (
                      <a href={agg.targetUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-rm-blue">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{reason}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {placementTypeLabel(agg.placementType)}
                  {agg.sources.includes("pmax") && <span className="block text-[9px] text-muted-foreground">via PMax</span>}
                </td>
                <td className="px-3 py-2 text-right">{int(agg.impressions)}</td>
                <td className="px-3 py-2 text-right">{agg.metricsComplete ? eur(agg.cost) : <span className="text-muted-foreground" title="Performance Max levert geen kosten per placement">onbekend</span>}</td>
                <td className="px-3 py-2 text-right">{agg.metricsComplete ? int(agg.videoViews) : "—"}</td>
                <td className="px-3 py-2 text-right">{agg.metricsComplete ? int(agg.clicks) : "—"}</td>
                <td className="px-3 py-2 text-right">{!agg.metricsComplete ? "—" : agg.conversions === 0 ? "—" : int(agg.conversions)}</td>
                <td className="px-3 py-2 text-right">{agg.cpa == null ? "—" : eur(agg.cpa)}</td>
                <td className="px-5 py-2">
                  <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${VERDICT_STYLE[verdict]}`}>
                    {VERDICT_LABEL[verdict]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
