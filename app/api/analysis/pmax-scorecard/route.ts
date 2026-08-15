// Masterplan sectie 5.4 (Campaign Type Intelligence): de PMax-scorecard. Puur lezend, geen
// LLM-aanroep, geen schrijfactie -- computePmaxScorecard() (lib/pmax-scorecard.ts) draait op
// dezelfde vijf PMax-tabellen als lib/analysis/pmax-expert-layer.ts (asset-, netwerk-,
// placement- en campagnedata). supabaseForClient in plaats van getSupabase: ook voor de
// demo-klant bruikbaar, net als de Search-scorecard.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { computePmaxScorecard, type PmaxCampaignMonthlyRow, type PmaxPlacementRow } from "@/lib/pmax-scorecard";
import type { AssetRegel } from "@/lib/pmax/assetdekking";
import type { NetworkRow } from "@/lib/pmax/network-split";

// Zelfde venster als lib/analysis/pmax-expert-layer.ts: twaalf maanden voor asset-/netwerk-/
// placementdata, zodat deze route niet stilzwijgend afwijkt van de signalen die dezelfde tabellen
// al gebruiken.
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

  const { data: pmaxMeta, error: metaError } = await supabase
    .from("ads_campaign_metadata")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("campaign_type", "PERFORMANCE_MAX");
  if (metaError) return Response.json({ error: metaError.message }, { status: 500 });

  const pmaxCampaigns = pmaxMeta ?? [];
  if (pmaxCampaigns.length === 0) {
    return Response.json({ health: null, campaignCount: 0 });
  }
  const pmaxCampaignNames = pmaxCampaigns.map((c) => String(c.campaign_name));

  const vanaf = vensterStart();
  const [assetData, networkData, placementData, campMonthlyData] = await Promise.all([
    supabase.from("ads_pmax_asset_performance")
      .select("month, asset_group_name, asset_id, asset_type, performance_label")
      .eq("client_id", clientId).gte("month", vanaf),
    supabase.from("ads_pmax_network_breakdown")
      .select("network_type, cost, conversions, conversions_value, impressions, clicks")
      .eq("client_id", clientId).gte("month", vanaf),
    supabase.from("ads_pmax_placements")
      .select("placement, cost, conversions, impressions")
      .eq("client_id", clientId).gte("month", vanaf).limit(2000),
    supabase.from("ads_campaign_monthly")
      .select("campaign_name, month, cost, conversions")
      .eq("client_id", clientId)
      .gte("month", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
  ]);
  if (assetData.error) return Response.json({ error: assetData.error.message }, { status: 500 });
  if (networkData.error) return Response.json({ error: networkData.error.message }, { status: 500 });
  if (placementData.error) return Response.json({ error: placementData.error.message }, { status: 500 });
  if (campMonthlyData.error) return Response.json({ error: campMonthlyData.error.message }, { status: 500 });

  const assetRows: AssetRegel[] = (assetData.data ?? []).map((r) => ({
    asset_group_name: r.asset_group_name as string | null,
    asset_id: r.asset_id as string | null,
    asset_type: r.asset_type as string | null,
    performance_label: r.performance_label as string | null,
    month: r.month as string | null,
  }));
  const networkRows: NetworkRow[] = (networkData.data ?? []).map((r) => ({
    networkType: String(r.network_type ?? "UNKNOWN"),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversionsValue: Number(r.conversions_value ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
  }));
  const placementRows: PmaxPlacementRow[] = (placementData.data ?? []).map((r) => ({
    placement: String(r.placement ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));
  const campMonthlyRows: PmaxCampaignMonthlyRow[] = (campMonthlyData.data ?? []).map((r) => ({
    campaign_name: String(r.campaign_name ?? ""),
    month: String(r.month ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
  }));

  const health = computePmaxScorecard({ assetRows, networkRows, placementRows, campMonthlyRows, pmaxCampaignNames });
  return Response.json({ health, campaignCount: pmaxCampaigns.length });
}
