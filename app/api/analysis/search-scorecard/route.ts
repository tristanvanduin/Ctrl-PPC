// Masterplan sectie 5.4 (Campaign Type Intelligence): de Search-scorecard. Puur lezend, geen
// LLM-aanroep, geen schrijfactie -- computeSearchScorecard() (lib/search-scorecard.ts) draait op
// ads_campaign_impression_share (campaign_type = SEARCH) en ads_keyword_performance_monthly.
// supabaseForClient in plaats van getSupabase: dit is een leesroute die ook voor de demo-klant
// moet werken, net als bid-strategy en budget-allocation.
//
// Herbouwd 1 september 2026 na de sloop-audit, met twee lessen uit de andere leesroutes:
//
// 1. De IS-fetch had geen datumvenster en geen limiet: elke maand die de klant ooit had ging
//    mee (de lopende deelmaand incluis), en boven de PostgREST-cap van 1000 rijen bepaalde de
//    oplopende sortering dat precies de nieuwste maanden wegvielen. Nu: twaalf AFGESLOTEN
//    maanden, aflopend gepagineerd via alleRijen(), lopende deelmaand uitgesloten.
//
// 2. Keywords werden gevraagd voor exact de laatste IS-maand. Live loopt de keywordtabel
//    maanden achter op de IS-tabel (geverifieerd 1 september: keyword-max 2026-04 naast
//    IS-max 2026-08), dus kwam er bij elke echte klant 0 rijen terug en viel Search Quality
//    stil. Nu: de jongste maand die de keywordtabel zélf heeft (≤ de laatste IS-maand), met
//    die maand als label in de factortekst zodat de veroudering zichtbaar is.

import { NextRequest } from "next/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { computeSearchScorecard, type SearchImpressionShareRow } from "@/lib/search-scorecard";
import type { KeywordQsRow } from "@/lib/analysis/metric-cross-checks";
import {
  alleRijen, eis, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandSleutel,
} from "@/lib/analysis/db-veilig";

// Zelfde venster als de andere scorecards: twaalf (afgesloten) maanden voor de trend-factoren.
const VENSTER_MAANDEN = 12;

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const vensterVanaf = afgeslotenMaandenTerugStart(VENSTER_MAANDEN - 1);
  const vensterTot = laatsteAfgeslotenMaandStart();

  try {
  const isFetch = await alleRijen<Record<string, unknown>>(
    (van, tot) => supabase
      .from("ads_campaign_impression_share")
      .select("campaign_id, month, cost, conversions, clicks, impressions, search_impression_share, search_budget_lost_is, search_rank_lost_is")
      .eq("client_id", clientId)
      .eq("campaign_type", "SEARCH")
      .gte("month", vensterVanaf)
      .lte("month", vensterTot)
      .order("month", { ascending: false })
      .order("id", { ascending: true }) // vaste volgorde binnen een maand, anders is paginering loterij
      .range(van, tot),
    "ads_campaign_impression_share"
  );

  const rows: SearchImpressionShareRow[] = isFetch.rijen.map((r) => ({
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

  // Alleen keywords van Search-campagnes -- dezelfde campaign_id-verzameling die de
  // impression-share-rijen al opleverden, geen tweede filter op campaign_type nodig (die kolom
  // staat niet op ads_keyword_performance_monthly).
  const laatsteISMaand = rows.length > 0 ? rows.map((r) => r.month).sort().slice(-1)[0] : null;
  const searchCampagneIds = [...new Set(rows.map((r) => r.campaignId))];

  let keywords: KeywordQsRow[] = [];
  let keywordMaand: string | null = null;
  if (laatsteISMaand && searchCampagneIds.length > 0) {
    // Eerst de jongste maand die de keywordtabel zelf heeft (zie de kop, les 2).
    const maandRijen = eis(
      await supabase
        .from("ads_keyword_performance_monthly")
        .select("month")
        .eq("client_id", clientId)
        .in("campaign_id", searchCampagneIds)
        .lte("month", laatsteISMaand)
        .order("month", { ascending: false })
        .limit(1),
      "ads_keyword_performance_monthly (jongste maand)"
    );
    keywordMaand = maandRijen.length > 0 ? String(maandRijen[0].month) : null;

    if (keywordMaand) {
      const maand = keywordMaand; // const voor de closure: TS houdt de narrowing van een let niet vast
      const kwFetch = await alleRijen<Record<string, unknown>>(
        (van, tot) => supabase
          .from("ads_keyword_performance_monthly")
          .select("cost, quality_score")
          .eq("client_id", clientId)
          .eq("month", maand)
          .in("campaign_id", searchCampagneIds)
          .order("cost", { ascending: false })
          .order("id", { ascending: true })
          .range(van, tot),
        "ads_keyword_performance_monthly"
      );
      keywords = kwFetch.rijen.map((r) => ({
        cost: Number(r.cost ?? 0),
        quality_score: r.quality_score == null ? null : Number(r.quality_score),
      }));
    }
  }

  const health = computeSearchScorecard(rows, keywords, keywordMaand ? maandSleutel(keywordMaand) : null);
  return Response.json({ health, campaignCount: searchCampagneIds.length });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
