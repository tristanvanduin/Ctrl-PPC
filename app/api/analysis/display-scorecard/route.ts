// Masterplan sectie 5.4 (Campaign Type Intelligence): de Display-scorecard. Puur lezend, geen
// LLM-aanroep, geen schrijfactie -- computeDisplayScorecard() (lib/display-scorecard.ts) draait op
// ads_campaign_monthly (campaign_type = DISPLAY, via ads_campaign_metadata, zelfde join-vorm als
// de PMax-scorecard) en ads_audience_performance_monthly. supabaseForClient in plaats van
// getSupabase: ook voor de demo-klant bruikbaar, net als de andere scorecards.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { computeDisplayScorecard, type DisplayCampaignMonthlyRow, type DisplayAudienceRow } from "@/lib/display-scorecard";

// Zelfde venster als de andere scorecards: twaalf maanden voor de trend-factoren.
function vensterStart(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12, 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data: displayMeta, error: metaError } = await supabase
    .from("ads_campaign_metadata")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("campaign_type", "DISPLAY");
  if (metaError) return Response.json({ error: metaError.message }, { status: 500 });

  const displayCampaigns = displayMeta ?? [];
  if (displayCampaigns.length === 0) {
    return Response.json({ health: null, campaignCount: 0 });
  }
  const displayCampaignNames = displayCampaigns.map((c) => String(c.campaign_name));

  const vanaf = vensterStart();
  const [campMonthlyData, audienceData] = await Promise.all([
    supabase.from("ads_campaign_monthly")
      .select("campaign_name, month, cost, conversions, clicks, impressions")
      .eq("client_id", clientId)
      .in("campaign_name", displayCampaignNames)
      .gte("month", vanaf),
    supabase.from("ads_audience_performance_monthly")
      .select("audience_type, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .in("campaign_name", displayCampaignNames)
      .gte("month", vanaf),
  ]);
  if (campMonthlyData.error) return Response.json({ error: campMonthlyData.error.message }, { status: 500 });
  if (audienceData.error) return Response.json({ error: audienceData.error.message }, { status: 500 });

  const campMonthlyRows: DisplayCampaignMonthlyRow[] = (campMonthlyData.data ?? []).map((r) => ({
    campaign_name: String(r.campaign_name ?? ""),
    month: String(r.month ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));
  const audienceRows: DisplayAudienceRow[] = (audienceData.data ?? []).map((r) => ({
    audience_type: r.audience_type as string | null,
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversions_value: Number(r.conversions_value ?? 0),
  }));

  const health = computeDisplayScorecard(campMonthlyRows, audienceRows);
  return Response.json({ health, campaignCount: displayCampaigns.length });
}
