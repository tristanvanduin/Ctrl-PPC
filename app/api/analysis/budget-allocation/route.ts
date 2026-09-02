// =====================================================================
// Hefboom 2: losse budgetallocatie-analyse. Merget ads_campaign_impression_share (het
// zichtbaarheidsverlies en de budgetbenutting) met ads_campaign_monthly (kosten,
// conversies, conversiewaarde) per campagne op ÉÉN afgesloten peilmaand, resolvet het
// target uit client_targets, en laat de deterministische voorcompute bepalen waar de
// volgende euro heen moet.
//
// Herbouwd 1 september 2026 na de sloop-audit: de oude route beoordeelde "de laatste
// maand per campagne" (mogelijk de lopende deelmaand, per campagne verschillend), plakte
// "-01" achter een volledige datum waardoor de save faalde ná de betaalde LLM-call, en
// negeerde queryfouten. Nu: één afgesloten peilmaand voor iedereen, gepagineerde en
// foutgecontroleerde datalaag, en een expliciete dekkingsgrens (alleen campagnes met
// IS-data — Search; wat daarbuiten spend heeft wordt geteld en benoemd).
// =====================================================================

import { NextRequest } from "next/server";
import { getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callLayer } from "@/lib/analysis/llm-router";
import { recordUsage, resolveTargets, type TargetRow } from "@/lib/analysis/o2-targets-cost";
import { analyzeBudgetAllocation, type CampaignBudgetInput, type BudgetTarget } from "@/lib/analysis/budget-allocation-facts";
import { buildBudgetAllocationPrompt } from "@/lib/prompts/budget-allocation-prompt";
import { saveBudgetAllocationHypotheses } from "@/lib/analysis/standalone-to-hypotheses";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  eis, alleRijen, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandStart, maandSleutel,
} from "@/lib/analysis/db-veilig";

const SECTION = "budget_allocation_v1";
const SOP_TYPE = "budget_allocation";
// Ruim genoeg om bij een achterlopende sync de jongste maand mét data te vinden.
const VENSTER_MAANDEN = 14;

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

  // Demo-bewust, net als de GET: mock-writes horen no-ops te zijn.
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
    const [isFetch, targetRes, clientCtx] = await Promise.all([
      alleRijen<{
        campaign_id: string; campaign_name: string; month: string;
        cost: number | null; conversions: number | null;
        search_budget_lost_is: number | null; search_rank_lost_is: number | null;
        budget_utilization: number | null;
      }>(
        (van, tot) => supabase
          .from("ads_campaign_impression_share")
          .select("campaign_id, campaign_name, month, cost, conversions, search_budget_lost_is, search_rank_lost_is, budget_utilization")
          .eq("client_id", clientId)
          .gte("month", vensterStart)
          .lte("month", vensterEind)
          .order("month", { ascending: false })
          .order("campaign_id", { ascending: true })
          .range(van, tot),
        "ads_campaign_impression_share"
      ),
      supabase
        .from("client_targets")
        .select("channel, metric, target_value, valid_from, valid_to")
        .eq("client_id", clientId)
        .eq("channel", "google_ads"),
      fetchClientContext(supabase, clientId),
    ]);

    const isRows = isFetch.rijen;
    if (isRows.length === 0) {
      return Response.json(
        { error: `Geen campagne-impression-share-data in de laatste ${VENSTER_MAANDEN} afgesloten maanden. Bron: ads_campaign_impression_share; draai de Google-sync als die leeg hoort te zijn.` },
        { status: 404 }
      );
    }

    // Eén peilmaand voor iedereen: de jongste maand in de IS-rijen.
    const peilmaand = isRows.map((r) => maandSleutel(r.month)).sort().at(-1) as string;
    const peilmaandStart = `${peilmaand}-01`;
    const inPeilmaand = isRows.filter((r) => maandSleutel(r.month) === peilmaand);

    // Kosten/conversies/waarde uit ads_campaign_monthly voor diezelfde peilmaand — de
    // maandtabel is de boekhouding, de IS-tabel de zichtbaarheid; en de campagne-typen
    // erbuiten (PMax, Display, Video) bepalen de dekkingsgrens.
    const maandRes = await supabase
      .from("ads_campaign_monthly")
      .select("campaign_id, campaign_type, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .eq("month", peilmaandStart)
      .limit(2000);
    const maandRijen = eis(maandRes, "ads_campaign_monthly");
    const maandPerCampagne = new Map(maandRijen.map((r) => [r.campaign_id, r]));

    const campaigns: CampaignBudgetInput[] = inPeilmaand
      .filter((r) => r.campaign_id)
      .map((row) => {
        const maand = maandPerCampagne.get(row.campaign_id);
        return {
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          cost: maand?.cost ?? row.cost,
          conversions: maand?.conversions ?? row.conversions,
          conversionsValue: maand?.conversions_value ?? null,
          budgetLostIs: row.search_budget_lost_is,
          rankLostIs: row.search_rank_lost_is,
          budgetUtilization: row.budget_utilization,
        };
      });

    const gedekteIds = new Set(campaigns.map((c) => c.campaignId));
    const buitenDekking = maandRijen.filter((r) => !gedekteIds.has(r.campaign_id) && (r.cost ?? 0) > 0);
    const dekking = {
      peilmaand,
      buitenDekkingCampagnes: buitenDekking.length,
      buitenDekkingKosten: Math.round(buitenDekking.reduce((s, r) => s + (r.cost ?? 0), 0)),
    };

    // client_targets in plaats van kpi_targets (fase 2, docs/MASTERPLAN.md): zelfde bron als
    // monthly/route.ts sinds migratie 082, zodat er geen tweede lezing van hetzelfde getal bestaat.
    const resolvedTargets = resolveTargets(
      eis(targetRes, "client_targets").map((row): TargetRow => ({
        channel: String(row.channel),
        metric: String(row.metric),
        targetValue: Number(row.target_value),
        validFrom: String(row.valid_from),
        validTo: row.valid_to == null ? null : String(row.valid_to),
      })),
      "google_ads",
      peilmaandStart
    );
    const target: BudgetTarget = {
      targetCpa: (resolvedTargets.cpa ?? 0) > 0 ? resolvedTargets.cpa : null,
      targetRoas: (resolvedTargets.roas ?? 0) > 0 ? resolvedTargets.roas : null,
    };

    const { campaigns: facts, scaleUp, scaleDown, summary } = analyzeBudgetAllocation(campaigns, target);
    const systemPrompt = buildBudgetAllocationPrompt({ summary, scaleUp, scaleDown, target, dekking, goalsSection: clientCtx.goalsSection });

    const response = await callLayer("narrative", {
      apiKey,
      systemPrompt,
      userMessage: "Lever de budgetallocatie-analyse met een concreet herallocatie-voorstel.",
      maxTokens: 8192,
      label: "budget-allocation",
    });

    const analysisDate = today();

    void recordUsage(supabase, {
      runKey: `budget-allocation-${clientId}-${analysisDate}`,
      clientId,
      channel: "google_ads",
      sopType: SOP_TYPE,
      stepLabel: "Budgetallocatie",
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
        period_start: maandStart(peilmaandStart),
        period_end: maandStart(peilmaandStart),
        section: SECTION,
        output: response.output,
        model_used: response.model,
        tokens_used: response.tokensUsed,
        step_number: 1,
        step_name: "Budgetallocatie",
      },
    });
    if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

    // Voed de goedkeuringswachtrij: aggregeer de op/af-schaal-adviezen tot één voorstel.
    await saveBudgetAllocationHypotheses(supabase, { summary, scaleUp, scaleDown }, { clientId, analysisId: null });
    await verbruikCredit(supabase, { clientId, label: SOP_TYPE, runKey: `budget-allocation-${clientId}-${analysisDate}` });

    return Response.json({
      analysis: response.output,
      summary,
      scaleUp,
      scaleDown,
      campaigns: facts,
      dekking: {
        ...dekking,
        verouderd: peilmaandStart < vensterEind,
        rijenAfgekapt: isFetch.afgekapt,
      },
    });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
