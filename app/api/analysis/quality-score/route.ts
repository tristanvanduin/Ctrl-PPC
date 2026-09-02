// =====================================================================
// G2: losse quality-score-analyse. Gespiegeld op het G1-patroon (GET haalt de laatste op,
// POST draait een nieuwe). De deterministische voorcompute komt uit quality-score-facts.ts,
// de interpretatie uit de prompt met de componenten-no-go hard erin.
//
// Herbouwd 1 september 2026 na de sloop-audit. De oude route haalde ALLE keyword-rijen op,
// oplopend gesorteerd en zonder limiet: bij meer dan 1000 rijen (een middelgrote klant
// heeft er duizenden) hield de PostgREST-cap precies de óúdste rijen over, waardoor de
// "analysemaand" stil maanden of jaren in het verleden lag — met een groene status. Nu:
// venster van 13 afgesloten maanden, aflopend gepagineerd, verplichte foutcontrole, en
// een verouderd-vlag wanneer de jongste data ouder is dan de laatste afgesloten maand.
// =====================================================================

import { NextRequest } from "next/server";
import { getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callLayer } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import { saveQualityScoreHypotheses } from "@/lib/analysis/standalone-to-hypotheses";
import { analyzeQualityScore, type KeywordQsPerformanceRow } from "@/lib/analysis/quality-score-facts";
import { buildQualityScorePrompt } from "@/lib/prompts/quality-score-prompt";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  alleRijen, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandStart, maandSleutel,
} from "@/lib/analysis/db-veilig";

const SECTION = "quality_score_v1";
const SOP_TYPE = "quality_score";
// 13 afgesloten maanden: het venster dat het routecommentaar altijd al beloofde.
const VENSTER_MAANDEN = 13;

// GET: de laatst opgeslagen quality-score-analyse voor een klant.
export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest. Zonder dit gaf deze route in
  // demo-modus een 500 en bleef het bijbehorende tabblad leeg.
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

// POST: draai een nieuwe quality-score-analyse.
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
  // De keyword-maandrijen over het venster, aflopend gepagineerd: een grote klant heeft
  // duizenden rijen en de nieuwste maand mag nooit de afkap zijn.
  const keywordFetch = await alleRijen<KeywordQsPerformanceRow>(
    (van, tot) => supabase
      .from("ads_keyword_performance_monthly")
      .select("month, campaign_name, ad_group_name, keyword_text, match_type, impressions, clicks, cost, conversions, quality_score")
      .eq("client_id", clientId)
      .gte("month", vensterStart)
      .lte("month", vensterEind)
      .order("month", { ascending: false })
      .order("cost", { ascending: false })
      .order("id", { ascending: true }) // vaste volgorde bij gelijke kosten, anders is paginering loterij
      .range(van, tot),
    "ads_keyword_performance_monthly",
    { max: 30_000 }
  );
  const clientCtx = await fetchClientContext(supabase, clientId);

  const keywordRows = keywordFetch.rijen;
  if (keywordRows.length === 0) {
    return Response.json(
      { error: `Geen keyword-data in de laatste ${VENSTER_MAANDEN} afgesloten maanden. Bron: ads_keyword_performance_monthly; draai de Google-sync als die leeg hoort te zijn.` },
      { status: 404 }
    );
  }

  const facts = analyzeQualityScore(keywordRows);
  const verouderd = facts.analysisMonth != null && `${facts.analysisMonth}-01` < vensterEind;
  const systemPrompt = buildQualityScorePrompt({ facts, verouderd, goalsSection: clientCtx.goalsSection });

  const response = await callLayer("narrative", {
    apiKey,
    systemPrompt,
    userMessage: "Lever de quality-score-analyse met geprioriteerde acties.",
    maxTokens: 8192,
    label: "quality-score",
  });

  const analysisDate = today();
  const months = keywordRows.map((r) => r.month).filter(Boolean).sort();
  const periodStart = maandStart(String(months[0]));
  const periodEnd = maandStart(String(months[months.length - 1]));

  // O2-kostenregistratie: een synthetische run-sleutel, want een losse analyse heeft geen jobId.
  void recordUsage(supabase, {
    runKey: `quality-score-${clientId}-${analysisDate}`,
    clientId,
    channel: "google_ads",
    sopType: SOP_TYPE,
    stepLabel: "Quality Score",
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
      period_start: periodStart,
      period_end: periodEnd,
      section: SECTION,
      output: response.output,
      model_used: response.model,
      tokens_used: response.tokensUsed,
      step_number: 1,
      step_name: "Quality Score",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  // Voed de goedkeuringswachtrij: flags + prioriteits-keywords tot één voorstel.
  await saveQualityScoreHypotheses(supabase, { flags: facts.flags, priorityKeywords: facts.priorityKeywords }, { clientId, analysisId: null });
  await verbruikCredit(supabase, { clientId, label: SOP_TYPE, runKey: `quality-score-${clientId}-${analysisDate}` });

  return Response.json({
    analysis: response.output,
    summary: facts.summary,
    flags: facts.flags,
    priorityKeywords: facts.priorityKeywords,
    dekking: {
      analysemaand: facts.analysisMonth,
      verouderd,
      venster: { start: maandSleutel(vensterStart), eind: maandSleutel(vensterEind), maanden: VENSTER_MAANDEN },
      rijenAfgekapt: keywordFetch.afgekapt,
    },
  });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
