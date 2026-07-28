// =====================================================================
// Google video & Performance Max als analyse in plaats van als losse schermen.
//
// De kijkdiepte-duiding, de uitsluit-voorstellen voor placements en de scheefheid in de
// PMax-netwerkverdeling bestonden al, maar bleven in hun eigen kaart hangen: je zag ze wel,
// maar er kwam geen hypothese, taak of sprintitem uit. Deze route draait dezelfde
// deterministische analyses en laat ze door de gedeelde molen gaan — renderen als SOP-sectie
// én wegschrijven als voorstel in de wachtrij, onder de bron "google_video".
//
// Deterministisch, geen LLM. Venster: de laatste 180 dagen, gelijk aan de kaarten zelf.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { renderSignalSection } from "@/lib/signals/render-section";
import { mergeDetections } from "@/lib/signals/types";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { aggregateVideoCampaigns, type VideoCampaignRow } from "@/lib/video/video-performance";
import { aggregatePlacements, judgePlacements, type PlacementInput } from "@/lib/video/placement-analysis";
import { buildNetworkSplit, type NetworkRow } from "@/lib/pmax/network-split";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import {
  buildVideoDepthSignals, buildPlacementWasteSignals, buildPmaxNetworkSignals,
} from "@/lib/signals/google-video";

const SOURCE = "google_video" as const;
const SECTION = "google_video_v1";
const LABEL = "Google video & Performance Max";
const WINDOW_DAYS = 180;

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOURCE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const s = (v: unknown): string => (v == null ? "" : String(v));

export async function POST(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [videoRes, placementRes, networkRes] = await Promise.all([
    supabase
      .from("ads_campaign_monthly")
      .select("campaign_id, campaign_name, campaign_type, month, impressions, cost, video_views, avg_cpm, avg_cpv, video_view_rate, video_quartile_p25, video_quartile_p50, video_quartile_p75, video_quartile_p100")
      .eq("client_id", clientId)
      .gte("month", since)
      .gt("video_views", 0),
    supabase
      .from("ads_video_placements")
      .select("placement, display_name, placement_type, target_url, campaign_name, impressions, clicks, cost, conversions, video_views, metrics_complete, source")
      .eq("client_id", clientId)
      .gte("month", since),
    supabase
      .from("ads_pmax_network_breakdown")
      .select("network_type, cost, conversions, conversions_value, impressions, clicks")
      .eq("client_id", clientId)
      .gte("month", since),
  ]);

  const videoRows: VideoCampaignRow[] = (videoRes.data ?? []).map((r) => ({
    campaignId: s(r.campaign_id), campaignName: s(r.campaign_name), campaignType: s(r.campaign_type) || null,
    month: s(r.month), impressions: n(r.impressions), cost: n(r.cost), videoViews: n(r.video_views),
    avgCpm: n(r.avg_cpm), avgCpv: n(r.avg_cpv), videoViewRate: n(r.video_view_rate),
    videoQuartileP25: n(r.video_quartile_p25), videoQuartileP50: n(r.video_quartile_p50),
    videoQuartileP75: n(r.video_quartile_p75), videoQuartileP100: n(r.video_quartile_p100),
  }));

  const placementRows: PlacementInput[] = (placementRes.data ?? []).map((r) => ({
    placement: s(r.placement), displayName: s(r.display_name), placementType: s(r.placement_type) || "UNKNOWN",
    targetUrl: s(r.target_url), campaignName: s(r.campaign_name),
    impressions: n(r.impressions), clicks: n(r.clicks), cost: n(r.cost),
    conversions: n(r.conversions), videoViews: n(r.video_views),
    metricsComplete: r.metrics_complete !== false,
    source: r.source === "pmax" ? "pmax" : "video",
  }));

  const networkRows: NetworkRow[] = (networkRes.data ?? []).map((r) => ({
    networkType: s(r.network_type) || "UNKNOWN",
    cost: n(r.cost), conversions: n(r.conversions), conversionsValue: n(r.conversions_value),
    impressions: n(r.impressions), clicks: n(r.clicks),
  }));

  // Niets van de drie aanwezig: geen video en geen PMax in dit account. Dan is er niets te
  // analyseren en hoort er ook geen lege sectie of wachtrij-opschoning te volgen.
  if (videoRows.length === 0 && placementRows.length === 0 && networkRows.length === 0) {
    return Response.json({ error: "Geen video- of Performance Max-data in dit venster" }, { status: 404 });
  }

  const merged = mergeDetections([
    buildVideoDepthSignals(aggregateVideoCampaigns(videoRows)),
    buildPlacementWasteSignals(judgePlacements(aggregatePlacements(placementRows))),
    buildPmaxNetworkSignals(buildNetworkSplit(networkRows)),
  ]);

  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, LABEL);
  const output = section || `## ${LABEL}\n\nGeen opvallende bevindingen in de laatste ${WINDOW_DAYS} dagen. Gecontroleerd: ${checkedIds.join(", ")}.`;

  const analysisDate = today();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOURCE, analysis_date: analysisDate,
      period_start: analysisDate, period_end: analysisDate, section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: LABEL,
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, SOURCE, { clientId, analysisId: null });

  return Response.json({ analysis: output, signals: triggeredCount, checked: checkedIds.length });
}
