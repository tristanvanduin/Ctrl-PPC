// =====================================================================
// Hefboom 2: losse budgetallocatie-analyse. Merget ads_campaign_impression_share (het
// zichtbaarheidsverlies en de budgetbenutting) met ads_campaign_monthly (de conversiewaarde
// voor ROAS) per campagne op de laatste maand, resolvet het target uit kpi_targets, en laat
// de deterministische voorcompute bepalen waar de volgende euro heen moet. LIVE-ONGETEST: de
// fetches, de merge, de LLM-call en de save vergen de echte omgeving.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callRouted } from "@/lib/analysis/llm-router";
import { recordUsage, resolveTargets, type TargetRow } from "@/lib/analysis/o2-targets-cost";
import { analyzeBudgetAllocation, type CampaignBudgetInput, type BudgetTarget } from "@/lib/analysis/budget-allocation-facts";
import { buildBudgetAllocationPrompt } from "@/lib/prompts/budget-allocation-prompt";
import { saveBudgetAllocationHypotheses } from "@/lib/analysis/standalone-to-hypotheses";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";

const SECTION = "budget_allocation_v1";
const SOP_TYPE = "budget_allocation";

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest. Zonder dit gaf deze route in
  // demo-modus een 500 en bleef het bijbehorende tabblad leeg.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });
  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const creditOordeel = await controleerSaldo(supabase, { clientId, label: SOP_TYPE });
  if (creditOordeel.blokkeert) {
    return Response.json({ error: creditOordeel.tekst }, { status: 402 });
  }

  const [isRes, monthlyRes, targetRes, clientCtx] = await Promise.all([
    supabase
      .from("ads_campaign_impression_share")
      .select("campaign_id, campaign_name, month, cost, conversions, search_budget_lost_is, search_rank_lost_is, budget_utilization")
      .eq("client_id", clientId)
      .order("month", { ascending: false }),
    supabase
      .from("ads_campaign_monthly")
      .select("campaign_id, month, conversions_value")
      .eq("client_id", clientId)
      .order("month", { ascending: false }),
    supabase.from("client_targets").select("channel, metric, target_value, valid_from, valid_to").eq("client_id", clientId).eq("channel", "google_ads"),
    fetchClientContext(supabase, clientId),
  ]);

  const isRows = isRes.data ?? [];
  if (isRows.length === 0) {
    return Response.json({ error: "Geen campagne-impression-share-data voor deze klant" }, { status: 404 });
  }

  // Conversiewaarde per campagne en maand, voor de ROAS-merge.
  const valueByKey = new Map<string, number>();
  for (const row of monthlyRes.data ?? []) {
    const key = `${row.campaign_id}|${row.month}`;
    if (!valueByKey.has(key) && typeof row.conversions_value === "number") valueByKey.set(key, row.conversions_value);
  }

  // Reduceer tot een rij per campagne (de laatste maand, want desc gesorteerd) en merge de waarde.
  const seen = new Set<string>();
  const campaigns: CampaignBudgetInput[] = [];
  for (const row of isRows) {
    if (!row.campaign_id || seen.has(row.campaign_id)) continue;
    seen.add(row.campaign_id);
    campaigns.push({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      cost: row.cost,
      conversions: row.conversions,
      conversionsValue: valueByKey.get(`${row.campaign_id}|${row.month}`) ?? null,
      budgetLostIs: row.search_budget_lost_is,
      rankLostIs: row.search_rank_lost_is,
      budgetUtilization: row.budget_utilization,
    });
  }

  // client_targets in plaats van kpi_targets (fase 2, docs/MASTERPLAN.md): zelfde bron als
  // monthly/route.ts sinds migratie 082, zodat er geen tweede lezing van hetzelfde getal bestaat.
  const months = isRows.map((r) => r.month).filter(Boolean).sort();
  const resolvedTargets = resolveTargets(
    (targetRes.data ?? []).map((row): TargetRow => ({
      channel: String(row.channel),
      metric: String(row.metric),
      targetValue: Number(row.target_value),
      validFrom: String(row.valid_from),
      validTo: row.valid_to == null ? null : String(row.valid_to),
    })),
    "google_ads",
    months.length > 0 ? `${months[months.length - 1]}-01` : today()
  );
  const target: BudgetTarget = {
    targetCpa: (resolvedTargets.cpa ?? 0) > 0 ? resolvedTargets.cpa : null,
    targetRoas: (resolvedTargets.roas ?? 0) > 0 ? resolvedTargets.roas : null,
  };

  const { campaigns: facts, scaleUp, scaleDown, summary } = analyzeBudgetAllocation(campaigns, target);
  const systemPrompt = buildBudgetAllocationPrompt({ summary, scaleUp, scaleDown, target, goalsSection: clientCtx.goalsSection });

  const response = await callRouted({
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
      period_start: `${months[0]}-01`,
      period_end: `${months[months.length - 1]}-01`,
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

  return Response.json({ analysis: response.output, summary, scaleUp, scaleDown, campaigns: facts });
}
