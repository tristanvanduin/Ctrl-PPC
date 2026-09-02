// =====================================================================
// Google video & Performance Max als analyse in plaats van als losse schermen.
//
// De kijkdiepte-duiding, de uitsluit-voorstellen voor placements en de scheefheid in de
// PMax-netwerkverdeling bestonden al, maar bleven in hun eigen kaart hangen: je zag ze wel,
// maar er kwam geen hypothese, taak of sprintitem uit. Deze route draait dezelfde
// deterministische analyses en laat ze door de gedeelde molen gaan — renderen als SOP-sectie
// én wegschrijven als voorstel in de wachtrij, onder de bron "google_video".
//
// Deterministisch, geen LLM. Venster: de laatste 6 afgesloten maanden.
//
// Herbouwd 1 september 2026 na de sloop-audit: (1) het venster was "nu minus 180 dagen"
// zonder maandsnap, waardoor de oudste maand vrijwel altijd wegviel (~150 dagen in plaats van
// de beloofde 180); (2) queryfouten werden geslikt en lazen als "geen data"; (3) de twee lege
// poten (videokolommen overal 0, ads_video_placements leeg) werden stilzwijgend overgeslagen
// alsof de PMax-poot het hele verhaal was — nu benoemt de output eerlijk wat er níét
// beoordeeld kon worden en waarom; (4) het toegangsslot ontbrak op een schrijvende route.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { renderSignalSection } from "@/lib/signals/render-section";
import { mergeDetections } from "@/lib/signals/types";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { aggregateVideoCampaigns, type VideoCampaignRow } from "@/lib/video/video-performance";
import { aggregatePlacements, judgePlacements, type PlacementInput } from "@/lib/video/placement-analysis";
import { buildNetworkSplit, type NetworkRow } from "@/lib/pmax/network-split";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  alleRijen, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandSleutel,
} from "@/lib/analysis/db-veilig";
import {
  buildVideoDepthSignals, buildPlacementWasteSignals, buildPmaxNetworkSignals,
} from "@/lib/signals/google-video";

const SOURCE = "google_video" as const;
const SECTION = "google_video_v1";
const LABEL = "Google video & Performance Max";
// Zes afgesloten maanden: dezelfde omvang als de oude 180-dagen-belofte, maar dan op
// maandgrenzen, zodat de oudste maand niet halverwege wordt afgesneden.
const VENSTER_MAANDEN = 6;

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

  // Het toegangsslot: LLM-loos maar schrijvend, dus hetzelfde slot als de kern-routes
  // (sloop-audit 1 sep 2026).
  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-rijen voor de demo-klant, de echte client voor de rest.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  // Venster op maandgrenzen (sloop-audit 1 sep 2026): "nu minus 180 dagen" viel vrijwel altijd
  // midden in een maand, en omdat de month-kolom de éérste van de maand draagt, verdween de
  // oudste maand dan volledig uit het venster.
  const vensterStart = afgeslotenMaandenTerugStart(VENSTER_MAANDEN - 1);
  const vensterEind = laatsteAfgeslotenMaandStart();

  try {
  // Alle drie de bronnen gepagineerd en met verplichte foutcontrole (alleRijen gooit
  // DataLaagFout): een kapotte query las hier eerder als "geen data" (sloop-audit 1 sep 2026).
  const [videoFetch, placementFetch, networkFetch] = await Promise.all([
    alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("ads_campaign_monthly")
        .select("campaign_id, campaign_name, campaign_type, month, impressions, cost, video_views, avg_cpm, avg_cpv, video_view_rate, video_quartile_p25, video_quartile_p50, video_quartile_p75, video_quartile_p100")
        .eq("client_id", clientId)
        .gte("month", vensterStart)
        .lte("month", vensterEind)
        .gt("video_views", 0)
        .order("month", { ascending: false })
        .order("id", { ascending: true })
        .range(van, tot),
      "ads_campaign_monthly (video)"
    ),
    alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("ads_video_placements")
        .select("placement, display_name, placement_type, target_url, campaign_name, impressions, clicks, cost, conversions, video_views, metrics_complete, source")
        .eq("client_id", clientId)
        .gte("month", vensterStart)
        .lte("month", vensterEind)
        .order("month", { ascending: false })
        .order("id", { ascending: true })
        .range(van, tot),
      "ads_video_placements"
    ),
    alleRijen<Record<string, unknown>>(
      (van, tot) => supabase
        .from("ads_pmax_network_breakdown")
        .select("network_type, cost, conversions, conversions_value, impressions, clicks")
        .eq("client_id", clientId)
        .gte("month", vensterStart)
        .lte("month", vensterEind)
        .order("month", { ascending: false })
        .order("id", { ascending: true })
        .range(van, tot),
      "ads_pmax_network_breakdown"
    ),
  ]);

  const videoRows: VideoCampaignRow[] = videoFetch.rijen.map((r) => ({
    campaignId: s(r.campaign_id), campaignName: s(r.campaign_name), campaignType: s(r.campaign_type) || null,
    month: s(r.month), impressions: n(r.impressions), cost: n(r.cost), videoViews: n(r.video_views),
    avgCpm: n(r.avg_cpm), avgCpv: n(r.avg_cpv), videoViewRate: n(r.video_view_rate),
    videoQuartileP25: n(r.video_quartile_p25), videoQuartileP50: n(r.video_quartile_p50),
    videoQuartileP75: n(r.video_quartile_p75), videoQuartileP100: n(r.video_quartile_p100),
  }));

  const placementRows: PlacementInput[] = placementFetch.rijen.map((r) => ({
    placement: s(r.placement), displayName: s(r.display_name), placementType: s(r.placement_type) || "UNKNOWN",
    targetUrl: s(r.target_url), campaignName: s(r.campaign_name),
    impressions: n(r.impressions), clicks: n(r.clicks), cost: n(r.cost),
    conversions: n(r.conversions), videoViews: n(r.video_views),
    metricsComplete: r.metrics_complete !== false,
    source: r.source === "pmax" ? "pmax" : "video",
  }));

  const networkRows: NetworkRow[] = networkFetch.rijen.map((r) => ({
    networkType: s(r.network_type) || "UNKNOWN",
    cost: n(r.cost), conversions: n(r.conversions), conversionsValue: n(r.conversions_value),
    impressions: n(r.impressions), clicks: n(r.clicks),
  }));

  // Niets van de drie aanwezig: geen video en geen PMax in dit account. Dan is er niets te
  // analyseren en hoort er ook geen lege sectie of wachtrij-opschoning te volgen.
  if (videoRows.length === 0 && placementRows.length === 0 && networkRows.length === 0) {
    return Response.json(
      { error: `Geen video- of Performance Max-data in de laatste ${VENSTER_MAANDEN} afgesloten maanden` },
      { status: 404 }
    );
  }

  const merged = mergeDetections([
    buildVideoDepthSignals(aggregateVideoCampaigns(videoRows)),
    buildPlacementWasteSignals(judgePlacements(aggregatePlacements(placementRows))),
    buildPmaxNetworkSignals(buildNetworkSplit(networkRows)),
  ]);

  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, LABEL);
  let output = section || `## ${LABEL}\n\nGeen opvallende bevindingen in de laatste ${VENSTER_MAANDEN} afgesloten maanden. Gecontroleerd: ${checkedIds.join(", ")}.`;

  // Eerlijk benoemen wat er NIET beoordeeld kon worden (sloop-audit 1 sep 2026). Bij de
  // huidige datastand staan de videokolommen in ads_campaign_monthly overal op 0 en is
  // ads_video_placements leeg in de hele database: er is nog geen VIDEO-sync gedraaid. De
  // route toonde dan alleen de PMax-poot, alsof dat de hele analyse was.
  const nietBeoordeeld: string[] = [];
  if (videoRows.length === 0) {
    nietBeoordeeld.push(`- **Kijkdiepte niet beoordeeld.** Bron ads_campaign_monthly bevat in dit venster geen rijen met videovertoningen (video_views overal 0). Reden: er is nog geen VIDEO-sync gedraaid die de videokolommen vult.`);
  }
  if (placementRows.length === 0) {
    nietBeoordeeld.push(`- **Placements niet beoordeeld.** Bron ads_video_placements is leeg voor deze klant. Reden: er is nog geen VIDEO-sync gedraaid die placements aanlevert.`);
  }
  if (networkRows.length === 0) {
    nietBeoordeeld.push(`- **PMax-netwerkverdeling niet beoordeeld.** Bron ads_pmax_network_breakdown is leeg in dit venster.`);
  }
  if (nietBeoordeeld.length > 0) {
    output += `\n\n### Niet beoordeeld in deze run\n\n${nietBeoordeeld.join("\n")}`;
  }

  const analysisDate = today();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOURCE, analysis_date: analysisDate,
      period_start: vensterStart, period_end: vensterEind, section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: LABEL,
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, SOURCE, { clientId, analysisId: null });

  return Response.json({
    analysis: output,
    signals: triggeredCount,
    checked: checkedIds.length,
    dekking: {
      video: videoRows.length > 0,
      placements: placementRows.length > 0,
      pmax: networkRows.length > 0,
      venster: { start: maandSleutel(vensterStart), eind: maandSleutel(vensterEind), maanden: VENSTER_MAANDEN },
    },
  });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
