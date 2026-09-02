// =====================================================================
// Losse LinkedIn funnel-drop-off-analyse op de gedeelde funnel-kern. Fasen: vertoning ->
// klik -> landingspagina-klik -> form-open -> lead, over twee 28-dagen-vensters.
// Deterministisch, geen LLM; een materieel verslechterde fase landt in de wachtrij.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { analyzeLinkedInFunnel, renderLinkedInFunnelMarkdown, type LinkedInFunnelDailyRow } from "@/lib/analysis/linkedin-funnel-facts";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { eis, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

const SECTION = "linkedin_funnel_v1";
const SOP_TYPE = "linkedin_funnel";
const FETCH_DAYS = 70;

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

  // Demo-bewust, net als de GET (sloop-audit 1 sep 2026).
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
  const since = addDays(today(), -FETCH_DAYS);
  const rowsRes = await supabase
    .from("linkedin_account_daily")
    .select("date, impressions, clicks, landing_page_clicks, one_click_lead_form_opens, one_click_leads")
    .eq("client_id", clientId)
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(1000);
  const daily = eis(rowsRes, "linkedin_account_daily") as LinkedInFunnelDailyRow[];
  if (daily.length === 0) {
    return Response.json({ error: "Geen LinkedIn-dagdata voor deze klant; draai eerst de LinkedIn-sync. Bron: linkedin_account_daily." }, { status: 404 });
  }

  const facts = analyzeLinkedInFunnel(daily);
  const output = renderLinkedInFunnelMarkdown(facts);
  const actionNeeded = facts.worst !== null;

  const analysisDate = today();
  // De echte dagspan van de data (splitWindows ankert op de laatste datadatum).
  const datums = daily.map((r) => r.date).sort();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate,
      period_start: datums[0], period_end: datums[datums.length - 1], section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "LinkedIn funnel",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  const proposals: SprintHypothesisRow[] = facts.worst
    ? [{
        client_id: clientId, analysis_id: null,
        // deltaPct is negatief bij een verslechtering; Math.abs voorkomt "-24% verslechterd".
        hypothesis: `Onderzoek de LinkedIn-funnelfase ${facts.worst.from} → ${facts.worst.to} (${Math.round(Math.abs(facts.worst.deltaPct ?? 0) * 100)}% verslechterd)`,
        expected_result: "De oorzaak van de fase-verslechtering is gevonden (form-lengte, aanbod, doelgroep) en de overgangsrate herstelt richting het prior-venster.",
        measurement_metric: "De overgangsrate van deze fase in de volgende funnel-analyse.",
        timeframe: "2 weken",
        rationale: `Rate zakte van ${Math.round((facts.worst.priorRate ?? 0) * 1000) / 10}% naar ${Math.round((facts.worst.recentRate ?? 0) * 1000) / 10}% bij ${Math.round(facts.worst.recentFromVolume)} instap-volume.`,
        ice_impact: 6, ice_confidence: 7, ice_ease: 5,
        ice_total: Math.round(((6 + 7 + 5) / 3) * 10) / 10,
        status: "pending", source: "linkedin_funnel",
      }]
    : [];
  await saveProposalsReplacingPending(supabase, clientId, "linkedin_funnel", proposals);

  return Response.json({ analysis: output, actionNeeded, stages: facts.stages.length, skipped: facts.skippedStages });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
