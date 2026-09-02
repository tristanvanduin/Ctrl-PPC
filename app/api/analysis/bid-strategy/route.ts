// =====================================================================
// Hefboom 3: losse biedstrategie-fit-analyse.
//
// Herbouwd 1 september 2026 na de sloop-audit. De oude route las bidding_strategy uit
// ads_campaign_impression_share — een kolom die daar nooit heeft bestaan — en slikte de
// queryfout in, waardoor elke aanroep als een geloofwaardige 404 eindigde. Daarbovenop
// plakte hij "-01" achter een month-waarde die al een volledige datum is, waardoor de
// save met een ongeldige datum zou falen ná de betaalde LLM-call.
//
// Nu: de strategie komt uit ads_campaign_metadata (waar hij staat, mét de ingestelde
// doelwaarde en serving_status), de prestaties uit ads_campaign_monthly over de laatste
// drie AFGESLOTEN maanden, elke query met verplichte foutcontrole (lib/analysis/db-veilig),
// en de classificatie weegt volume per maand en toetst ook de doelhoogte (review_target).
// =====================================================================

import { NextRequest } from "next/server";
import { getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callLayer } from "@/lib/analysis/llm-router";
import { recordUsage, resolveTargets, type TargetRow } from "@/lib/analysis/o2-targets-cost";
import { analyzeBidStrategy, type CampaignBidInput, type BidGoal } from "@/lib/analysis/bid-strategy-facts";
import { buildBidStrategyPrompt } from "@/lib/prompts/bid-strategy-prompt";
import { saveBidStrategyHypotheses } from "@/lib/analysis/standalone-to-hypotheses";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  eis, alleRijen, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandStart,
} from "@/lib/analysis/db-veilig";

const SECTION = "bid_strategy_v1";
const SOP_TYPE = "bid_strategy";
// Drie afgesloten maanden: genoeg om maandruis te dempen, kort genoeg om een recente
// strategiewissel niet te laten verdrinken in oude cijfers.
const VENSTER_MAANDEN = 3;

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date, period_start, period_end")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

export async function POST(request: NextRequest) {
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust, net als de GET: de demo-klant hoort demo-rijen te zien en mock-writes
  // horen no-ops te zijn — niet met fictieve cijfers in de echte tabellen te landen.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const creditOordeel = await controleerSaldo(supabase, { clientId, label: SOP_TYPE });
  if (creditOordeel.blokkeert) {
    return Response.json({ error: creditOordeel.tekst }, { status: 402 });
  }

  const vensterStart = afgeslotenMaandenTerugStart(VENSTER_MAANDEN - 1);
  const vensterEind = laatsteAfgeslotenMaandStart();

  try {
    const [metadataRes, targetRes, clientCtx] = await Promise.all([
      supabase
        .from("ads_campaign_metadata")
        .select("campaign_id, campaign_name, campaign_type, bidding_strategy, bidding_strategy_target, serving_status")
        .eq("client_id", clientId),
      supabase
        .from("client_targets")
        .select("channel, metric, target_value, valid_from, valid_to")
        .eq("client_id", clientId)
        .eq("channel", "google_ads"),
      fetchClientContext(supabase, clientId),
    ]);
    const metadata = eis(metadataRes, "ads_campaign_metadata");
    const targetRijen = eis(targetRes, "client_targets");

    // Alleen campagnes die (nog) leveren: een ENDED-campagne heeft geen biedstrategie om
    // te herzien. We melden het aantal wel, zodat de dekking eerlijk is.
    const actief = metadata.filter((m) => m.serving_status !== "ENDED" && m.campaign_id);
    if (actief.length === 0) {
      return Response.json(
        { error: "Geen actieve campagnes met metadata voor deze klant. Bron: ads_campaign_metadata; draai de Google-sync als die leeg hoort te zijn." },
        { status: 404 }
      );
    }

    // Prestaties over het venster, gepagineerd en aflopend gesorteerd zodat een eventuele
    // afkap nooit stil de nieuwste maanden kost.
    const prestaties = await alleRijen<{
      campaign_id: string; month: string; cost: number | null;
      conversions: number | null; conversions_value: number | null;
    }>(
      (van, tot) => supabase
        .from("ads_campaign_monthly")
        .select("campaign_id, month, cost, conversions, conversions_value")
        .eq("client_id", clientId)
        .gte("month", vensterStart)
        .lte("month", vensterEind)
        .order("month", { ascending: false })
        .order("campaign_id", { ascending: true })
        .range(van, tot),
      "ads_campaign_monthly"
    );

    const perCampagne = new Map<string, { cost: number; conversions: number; value: number }>();
    for (const r of prestaties.rijen) {
      const t = perCampagne.get(r.campaign_id) ?? { cost: 0, conversions: 0, value: 0 };
      t.cost += r.cost ?? 0;
      t.conversions += r.conversions ?? 0;
      t.value += r.conversions_value ?? 0;
      perCampagne.set(r.campaign_id, t);
    }

    const campaigns: CampaignBidInput[] = actief.map((m) => {
      const p = perCampagne.get(m.campaign_id) ?? { cost: 0, conversions: 0, value: 0 };
      return {
        campaignId: m.campaign_id,
        campaignName: m.campaign_name ?? m.campaign_id,
        biddingStrategy: m.bidding_strategy,
        biddingStrategyTarget: m.bidding_strategy_target,
        conversions: p.conversions,
        cost: p.cost,
        conversionsValue: p.value,
      };
    });

    // Accountdoelen op de laatste afgesloten maand — dezelfde bron (client_targets) en
    // hetzelfde peilmoment als de maand-SOP, zodat er niet twee lezingen van het doel bestaan.
    const resolvedTargets = resolveTargets(
      targetRijen.map((row): TargetRow => ({
        channel: String(row.channel),
        metric: String(row.metric),
        targetValue: Number(row.target_value),
        validFrom: String(row.valid_from),
        validTo: row.valid_to == null ? null : String(row.valid_to),
      })),
      "google_ads",
      vensterEind
    );
    const goal: BidGoal = {
      hasCpaTarget: (resolvedTargets.cpa ?? 0) > 0,
      hasRoasTarget: (resolvedTargets.roas ?? 0) > 0,
      cpaTarget: (resolvedTargets.cpa ?? 0) > 0 ? resolvedTargets.cpa : null,
      roasTarget: (resolvedTargets.roas ?? 0) > 0 ? resolvedTargets.roas : null,
    };

    const { campaigns: facts, summary } = analyzeBidStrategy(campaigns, goal, VENSTER_MAANDEN);
    const systemPrompt = buildBidStrategyPrompt({ summary, campaigns: facts, goal, goalsSection: clientCtx.goalsSection });

    const response = await callLayer("narrative", {
      apiKey,
      systemPrompt,
      userMessage: "Lever de biedstrategie-fit-analyse met concrete adviezen per mismatch.",
      maxTokens: 8192,
      label: "bid-strategy",
    });

    const analysisDate = today();

    void recordUsage(supabase, {
      runKey: `bid-strategy-${clientId}-${analysisDate}`,
      clientId,
      channel: "google_ads",
      sopType: SOP_TYPE,
      stepLabel: "Biedstrategie-fit",
      model: response.model,
      promptTokens: response.promptTokens ?? 0,
      cachedPromptTokens: response.cachedPromptTokens ?? 0,
      completionTokens: response.completionTokens ?? 0,
    });

    const { error: saveError } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId,
        sop_type: SOP_TYPE,
        analysis_date: analysisDate,
        period_start: maandStart(vensterStart),
        period_end: maandStart(vensterEind),
        section: SECTION,
        output: response.output,
        model_used: response.model,
        tokens_used: response.tokensUsed,
        step_number: 1,
        step_name: "Biedstrategie-fit",
      },
    });
    if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

    // Voed de goedkeuringswachtrij: aggregeer de biedstrategie-mismatches tot één voorstel.
    await saveBidStrategyHypotheses(supabase, { summary, campaigns: facts }, { clientId, analysisId: null });
    await verbruikCredit(supabase, { clientId, label: SOP_TYPE, runKey: `bid-strategy-${clientId}-${analysisDate}` });

    return Response.json({
      analysis: response.output,
      summary,
      campaigns: facts,
      dekking: {
        actieveCampagnes: actief.length,
        beeindigdeCampagnes: metadata.length - actief.length,
        venster: { start: vensterStart, eind: vensterEind, maanden: VENSTER_MAANDEN },
        prestatieRijenAfgekapt: prestaties.afgekapt,
      },
    });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
