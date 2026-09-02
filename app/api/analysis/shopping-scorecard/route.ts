// Masterplan sectie 5.4 (Campaign Type Intelligence): de Shopping-scorecard. Puur lezend, geen
// LLM-aanroep, geen schrijfactie -- computeShoppingScorecard() (lib/shopping-scorecard.ts) draait
// op ads_campaign_monthly (campaign_type = SHOPPING, via ads_campaign_metadata) en
// ads_product_performance_monthly (die tabel draagt zijn eigen campaign_type-kolom, dus daar
// direct op gefilterd i.p.v. via de metadata-join). supabaseForClient in plaats van
// getSupabase: ook voor de demo-klant bruikbaar, net als de andere scorecards.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { computeShoppingScorecard, type ShoppingCampaignMonthlyRow, type ShoppingProductRow } from "@/lib/shopping-scorecard";
import { eis, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

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

  try {
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
  // Join op campaign_id, niet op campaign_name: beide tabellen dragen campaign_id, en namen
  // zijn geen identiteit -- een hernoemde campagne verdween met een naam-join stilzwijgend uit
  // de scorecard terwijl zijn historie er gewoon staat (sloop-audit 1 september).
  const shoppingCampaignIds = shoppingCampaigns.map((c) => c.campaign_id);

  const vanaf = vensterStart();
  const [campMonthlyData, productData] = await Promise.all([
    supabase.from("ads_campaign_monthly")
      .select("campaign_name, month, cost, conversions, clicks, impressions")
      .eq("client_id", clientId)
      .in("campaign_id", shoppingCampaignIds)
      .gte("month", vanaf),
    supabase.from("ads_product_performance_monthly")
      .select("product_id, product_title, cost, clicks, conversions, impressions")
      .eq("client_id", clientId)
      .eq("campaign_type", "SHOPPING")
      .gte("month", vanaf),
  ]);

  const campMonthlyRows: ShoppingCampaignMonthlyRow[] = eis(campMonthlyData, "ads_campaign_monthly").map((r) => ({
    campaign_name: String(r.campaign_name ?? ""),
    month: String(r.month ?? ""),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));
  const productRows: ShoppingProductRow[] = eis(productData, "ads_product_performance_monthly").map((r) => ({
    // product_id is de aggregatiesleutel in de scorecard; null blijft null zodat de
    // titel-terugval daar bewust gebeurt en niet hier stilletjes via String(null).
    product_id: r.product_id == null ? null : String(r.product_id),
    product_title: String(r.product_title ?? ""),
    cost: Number(r.cost ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
    impressions: Number(r.impressions ?? 0),
  }));

  const health = computeShoppingScorecard(campMonthlyRows, productRows);
  return Response.json({ health, campaignCount: shoppingCampaigns.length });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
