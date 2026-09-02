// =====================================================================
// RSA-insights: losse copy-analyse op asset-niveau (het Google-equivalent van M3/M4).
// Gespiegeld op het G-patroon (GET haalt de laatste op, POST draait een nieuwe). De
// deterministische voorcompute komt uit rsa-insights-facts.ts met de dubbeltelling-
// hierarchie hard in de prompt. LIVE-ONGETEST: vergt de sync-taak die google_ads_rsa_assets
// vult (ad_group_ad_asset_view, velden bekend) plus migratie 020.
//
// Herbouwd 1 september 2026 na de sloop-audit: (1) de fetch had geen limiet, dus de
// PostgREST-cap van 1000 sneed bij een grote klant een willekeurige subset — nu gepagineerd,
// aflopend op maand en met vaste volgorde, over een venster van 3 afgesloten maanden (de
// facts analyseren uitsluitend de jongste maand; het venster is er alleen om een
// achterlopende sync op te vangen); (2) period_start/period_end besloegen alle opgehaalde
// maanden terwijl alleen de laatste geanalyseerd wordt — nu staan beide op de geanalyseerde
// maand; (3) toegangsslot, demo-bewuste client en verplichte queryfout-controle toegevoegd.
// =====================================================================

import { NextRequest } from "next/server";
import { getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callLayer } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { analyzeRsaInsights, type RsaAssetRow } from "@/lib/analysis/rsa-insights-facts";
import { saveRsaInsightsHypotheses } from "@/lib/analysis/standalone-to-hypotheses";
import { buildRsaInsightsPrompt } from "@/lib/prompts/rsa-insights-prompt";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  alleRijen, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandStart, maandSleutel,
} from "@/lib/analysis/db-veilig";

const SECTION = "rsa_insights_v1";
const SOP_TYPE = "rsa_insights";
// De facts analyseren alleen de jongste maand in de data; drie afgesloten maanden venster is
// genoeg om een sync die een of twee maanden achterloopt alsnog te vinden.
const VENSTER_MAANDEN = 3;

// GET: de laatst opgeslagen RSA-analyse voor een klant.
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

// POST: draai een nieuwe RSA-copy-analyse.
export async function POST(request: NextRequest) {
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  // Het toegangsslot, zelfde patroon als de kern-routes (sloop-audit 1 sep 2026).
  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust, net als de GET: mock-writes horen no-ops te zijn, geen fictieve rijen in de
  // echte tabellen (sloop-audit 1 sep 2026; de oude getSupabase() schreef demo-runs echt weg).
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
  // Gepagineerd langs de PostgREST-cap, aflopend op maand met vaste vervolgsleutels: zonder
  // limiet kapte de cap van 1000 hier stil een willekeurige subset af (sloop-audit 1 sep 2026).
  // google_ads_rsa_assets heeft geen id-kolom; (month, ad_id, asset_id) is per rij uniek.
  const assetFetch = await alleRijen<RsaAssetRow>(
    (van, tot) => supabase
      .from("google_ads_rsa_assets")
      .select("month, campaign_name, ad_group_name, ad_id, asset_id, field_type, asset_text, pinned_field, performance_label, impressions, clicks, conversions, cost")
      .eq("client_id", clientId)
      .gte("month", vensterStart)
      .lte("month", vensterEind)
      .order("month", { ascending: false })
      .order("ad_id", { ascending: true })
      .order("asset_id", { ascending: true })
      .range(van, tot),
    "google_ads_rsa_assets"
  );
  const clientCtx = await fetchClientContext(supabase, clientId);

  const assetRows = assetFetch.rijen;
  if (assetRows.length === 0) {
    return Response.json(
      { error: `Geen RSA-asset-data in de laatste ${VENSTER_MAANDEN} afgesloten maanden. Bron: google_ads_rsa_assets; de sync op ad_group_ad_asset_view (migratie 020) moet eerst vullen.` },
      { status: 404 }
    );
  }

  const facts = analyzeRsaInsights(assetRows);
  const systemPrompt = buildRsaInsightsPrompt({ facts, goalsSection: clientCtx.goalsSection });

  const response = await callLayer("narrative", {
    apiKey,
    systemPrompt,
    userMessage: "Lever de RSA-copy-analyse met de geprioriteerde schrijfopdrachten voor de content-marketeer.",
    maxTokens: 8192,
    label: "rsa-insights",
  });

  const analysisDate = today();
  // period_start/period_end: de GEANALYSEERDE maand (de facts kijken alleen naar de jongste),
  // niet het hele opgehaalde venster (sloop-audit 1 sep 2026). analysisMonth kan theoretisch
  // null zijn; dan valt de periode terug op de venstergrens in plaats van te crashen.
  const analyseMaand = facts.analysisMonth != null ? maandStart(facts.analysisMonth) : vensterEind;
  const verouderd = analyseMaand < vensterEind;

  void recordUsage(supabase, {
    runKey: `rsa-insights-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "RSA Copy Insights",
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
      period_start: analyseMaand,
      period_end: analyseMaand,
      section: SECTION,
      output: response.output,
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: "RSA Copy Insights",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij: aggregeer de geprioriteerde schrijfopdrachten tot één voorstel.
  await saveRsaInsightsHypotheses(supabase, facts, { clientId, analysisId: null });
  await verbruikCredit(supabase, { clientId, label: SOP_TYPE, runKey: `rsa-insights-${clientId}-${analysisDate}` });

  return Response.json({
    analysis: response.output,
    summary: facts.summary,
    actions: facts.actions,
    dekking: {
      analysemaand: facts.analysisMonth,
      verouderd,
      venster: { start: maandSleutel(vensterStart), eind: maandSleutel(vensterEind), maanden: VENSTER_MAANDEN },
      rijenAfgekapt: assetFetch.afgekapt,
    },
  });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
