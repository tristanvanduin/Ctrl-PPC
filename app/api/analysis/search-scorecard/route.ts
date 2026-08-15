// Masterplan sectie 5.4 (Campaign Type Intelligence): de Search-scorecard. Puur lezend, geen
// LLM-aanroep, geen schrijfactie -- computeSearchScorecard() (lib/search-scorecard.ts) draait op
// ads_campaign_impression_share (campaign_type = SEARCH) en ads_keyword_performance_monthly.
// supabaseForClient in plaats van getSupabase: dit is een leesroute die ook voor de demo-klant
// moet werken, net als bid-strategy en budget-allocation.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { computeSearchScorecard, type SearchImpressionShareRow } from "@/lib/search-scorecard";
import type { KeywordQsRow } from "@/lib/analysis/metric-cross-checks";

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data: isRows, error: isError } = await supabase
    .from("ads_campaign_impression_share")
    .select("campaign_id, month, cost, conversions, clicks, impressions, search_impression_share, search_budget_lost_is, search_rank_lost_is")
    .eq("client_id", clientId)
    .eq("campaign_type", "SEARCH")
    .order("month");
  if (isError) return Response.json({ error: isError.message }, { status: 500 });

  const rows: SearchImpressionShareRow[] = (isRows ?? []).map((r) => ({
    campaignId: String(r.campaign_id),
    month: String(r.month),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    searchImpressionShare: Number(r.search_impression_share ?? 0),
    searchBudgetLostIS: Number(r.search_budget_lost_is ?? 0),
    searchRankLostIS: Number(r.search_rank_lost_is ?? 0),
  }));

  // Alleen keywords van Search-campagnes, in de laatst beschikbare maand -- dezelfde
  // campaign_id-verzameling die de impression-share-rijen al opleverden, geen tweede filter op
  // campaign_type nodig (die kolom staat niet op ads_keyword_performance_monthly).
  const laatsteMaand = rows.length > 0 ? rows.map((r) => r.month).sort().slice(-1)[0] : null;
  const searchCampagneIds = [...new Set(rows.map((r) => r.campaignId))];

  let keywords: KeywordQsRow[] = [];
  if (laatsteMaand && searchCampagneIds.length > 0) {
    const { data: kwRows, error: kwError } = await supabase
      .from("ads_keyword_performance_monthly")
      .select("cost, quality_score")
      .eq("client_id", clientId)
      .eq("month", laatsteMaand)
      .in("campaign_id", searchCampagneIds);
    if (kwError) return Response.json({ error: kwError.message }, { status: 500 });
    keywords = (kwRows ?? []).map((r) => ({
      cost: Number(r.cost ?? 0),
      quality_score: r.quality_score == null ? null : Number(r.quality_score),
    }));
  }

  const health = computeSearchScorecard(rows, keywords);
  return Response.json({ health, campaignCount: searchCampagneIds.length });
}
