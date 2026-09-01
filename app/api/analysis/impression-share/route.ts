// =====================================================================
// G1: losse impression-share-analyse. Gespiegeld op het search-terms-patroon (GET haalt
// de laatste op, POST draait een nieuwe). De deterministische diagnose komt uit
// impression-share-facts.ts, de interpretatie uit de prompt.
//
// Herbouwd 1 september 2026 na de sloop-audit: de oude route haalde de hele historie
// OPLOPEND op zonder limiet (de PostgREST-cap sneed dan precies de nieuwste maanden weg),
// plakte "-01" achter een month-waarde die al een volledige datum is (waardoor de save
// faalde ná de betaalde LLM-call), en negeerde queryfouten. Nu: venster van afgesloten
// maanden, gepagineerd en aflopend, verplichte foutcontrole, en één peilmaand voor alle
// campagnes met een verouderd-vlag als de sync achterloopt.
// =====================================================================

import { NextRequest } from "next/server";
import { getOpenRouterKey, fetchClientContext, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { callLayer } from "@/lib/analysis/llm-router";
import { recordUsage } from "@/lib/analysis/o2-targets-cost";
import {
  analyzeCampaignImpressionShare,
  analyzeGeoImpressionShare,
  type CampaignImpressionShareRow,
  type CountryImpressionShareRow,
} from "@/lib/analysis/impression-share-facts";
import { buildImpressionSharePrompt } from "@/lib/prompts/impression-share-prompt";
import { saveImpressionShareHypotheses } from "@/lib/analysis/standalone-to-hypotheses";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { verbruikCredit, controleerSaldo } from "@/lib/analysis/credit-costs";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import {
  eis, alleRijen, dataFoutNaarResponse,
  laatsteAfgeslotenMaandStart, afgeslotenMaandenTerugStart, maandStart, maandSleutel,
} from "@/lib/analysis/db-veilig";

const SECTION = "impression_share_v1";
const SOP_TYPE = "impression_share";
// Ruim genoeg om ook bij een achterlopende sync de jongste maand mét data te vinden
// (plus de maand ervoor voor de MoM), krap genoeg om niet de hele historie te slepen.
const VENSTER_MAANDEN = 14;

// GET: de laatst opgeslagen impression-share-analyse voor een klant.
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

// POST: draai een nieuwe impression-share-analyse.
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

  // Demo-bewust, net als de GET: mock-writes horen no-ops te zijn, geen fictieve rijen in
  // de echte tabellen.
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
    // Campagne- en landniveau impression share over het venster van afgesloten maanden.
    // Aflopend gesorteerd en gepagineerd: een afkap kan nooit stil de jongste maanden kosten.
    const [campaignFetch, countryRes, clientCtx] = await Promise.all([
      alleRijen<CampaignImpressionShareRow>(
        (van, tot) => supabase
          .from("ads_campaign_impression_share")
          .select("campaign_id, campaign_name, campaign_type, month, conversions, cost, search_impression_share, search_budget_lost_is, search_rank_lost_is, daily_budget, budget_utilization")
          .eq("client_id", clientId)
          .gte("month", vensterStart)
          .lte("month", vensterEind)
          .order("month", { ascending: false })
          .order("campaign_id", { ascending: true })
          .range(van, tot),
        "ads_campaign_impression_share"
      ),
      supabase
        .from("ads_country_impression_share")
        .select("country_code, month, search_impression_share, search_budget_lost_is, search_rank_lost_is, total_cost")
        .eq("client_id", clientId)
        .gte("month", vensterStart)
        .lte("month", vensterEind)
        .order("month", { ascending: false })
        .limit(1000),
      fetchClientContext(supabase, clientId),
    ]);

    const campaignRows = campaignFetch.rijen;
    if (campaignRows.length === 0) {
      return Response.json(
        { error: `Geen impression-share-data in de laatste ${VENSTER_MAANDEN} afgesloten maanden. Bron: ads_campaign_impression_share; draai de Google-sync als die leeg hoort te zijn.` },
        { status: 404 }
      );
    }
    const countryRows = eis(countryRes, "ads_country_impression_share") as CountryImpressionShareRow[];

    const { campaigns, summary } = analyzeCampaignImpressionShare(campaignRows);
    const geo = analyzeGeoImpressionShare(countryRows);
    const verouderd = summary.peilmaand !== "" && `${summary.peilmaand}-01` < vensterEind;

    const systemPrompt = buildImpressionSharePrompt({
      summary, campaigns, geo: geo.countries, geoPeilmaand: geo.peilmaand, verouderd,
      goalsSection: clientCtx.goalsSection,
    });

    const response = await callLayer("narrative", {
      apiKey,
      systemPrompt,
      userMessage: "Lever de impression-share-analyse met geprioriteerde acties.",
      maxTokens: 8192,
      label: "impression-share",
    });

    const analysisDate = today();

    // O2-kostenregistratie: een synthetische run-sleutel, want een losse analyse heeft geen jobId.
    void recordUsage(supabase, {
      runKey: `impression-share-${clientId}-${analysisDate}`,
      clientId,
      channel: "google_ads",
      sopType: SOP_TYPE,
      stepLabel: "Impression Share",
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
        period_end: summary.peilmaand ? `${summary.peilmaand}-01` : maandStart(vensterEind),
        section: SECTION,
        output: response.output,
        model_used: response.model,
        tokens_used: response.tokensUsed,
        step_number: 1,
        step_name: "Impression Share",
      },
    });
    if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

    // Voed de goedkeuringswachtrij: aggregeer het budget-/rang-verlies tot één voorstel.
    await saveImpressionShareHypotheses(supabase, { summary, campaigns }, { clientId, analysisId: null });
    await verbruikCredit(supabase, { clientId, label: SOP_TYPE, runKey: `impression-share-${clientId}-${analysisDate}` });

    return Response.json({
      analysis: response.output,
      summary,
      campaigns,
      geo: geo.countries,
      dekking: {
        peilmaand: summary.peilmaand || maandSleutel(vensterEind),
        verouderd,
        venster: { start: vensterStart, eind: vensterEind, maanden: VENSTER_MAANDEN },
        rijenAfgekapt: campaignFetch.afgekapt,
      },
    });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
