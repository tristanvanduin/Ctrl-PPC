// Masterplan sectie 5.4 (Campaign Type Intelligence): de Shopping-scorecard. Puur lezend, geen
// LLM-aanroep, geen schrijfactie -- computeShoppingScorecard() (lib/shopping-scorecard.ts) draait
// op ads_campaign_monthly (campaign_type = SHOPPING, via ads_campaign_metadata) en
// ads_product_performance_monthly (die tabel draagt zijn eigen campaign_type-kolom, dus daar
// direct op gefilterd i.p.v. via de campagnenaam-join). supabaseForClient in plaats van
// getSupabase: ook voor de demo-klant bruikbaar, net als de andere scorecards.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { computeShoppingScorecard, type ShoppingCampaignMonthlyRow, type ShoppingProductRow } from "@/lib/shopping-scorecard";

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

  const { data: shoppingMeta, error: metaError } = await supabase
    .from("ads_campaign_metadata")
    .select("campaign_id, campaign_name")
    .eq("client_id", clientId)
    .eq("campaign_type", "SHOPPING");
  if (metaError) return Response.json({ error: metaError.message }, { status: 500 });

  const shoppingCampaigns = shoppingMeta ?? [];
  if (shoppingCampaigns.length === 0) {
    return Response.json({ health: null, campaignCount: 0 });
  }
  const shoppingCampaignNames = shoppingCampaigns.map((c) => String(c.campaign_name));

  const vanaf = vensterStart();
  const [campMonthlyData, productData] = await Promise.all([
    supabase.from("ads_campaign_monthly")
      .select("campaign_name, month, cost, conversions, clicks, impressions")
      .eq("client_id", clientId)
      .in("campaign_name", shoppingCampaignNames)
      .gte("month", vanaf),
    supabase.from("ads_product_performance_monthly")
      .select("product_title, cost, clicks, conversions, impressions")
      .eq("client_id", clientId)
      .eq("campaign_type", "SHOPPING")
      .gte("month", vanaf),
  ]);
  if (campMonthlyData.error) return Response.json({ error: campMonthlyData.error.message }, { status: 500 });
  if (productData.error) return Response.json({ error: productData.error.message }, { status: 500 });

  const campMonthlyRows: ShoppingCampaignMonthlyRow[] = (campMonthlyData.data ?? []).map((r) => ({
    campaign_name: String(r.campaign_name ?? ""),
    month: String(r.month ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));
  const productRows: ShoppingProductRow[] = (productData.data ?? []).map((r) => ({
    product_title: String(r.product_title ?? ""),
    cost: Number(r.cost ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));

  const health = computeShoppingScorecard(campMonthlyRows, productRows);
  return Response.json({ health, campaignCount: shoppingCampaigns.length });
}
