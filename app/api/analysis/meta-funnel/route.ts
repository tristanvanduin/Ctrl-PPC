// =====================================================================
// Losse Meta funnel-drop-off-analyse (uit stap 8 van de Meta-SOP losgetrokken). De fase-
// overgangen over twee 28-dagen-vensters, deterministisch berekend en verwoord door de
// pure kern (lib/analysis/meta-funnel-facts). Geen LLM. Een materieel verslechterde fase
// landt als voorstel in de goedkeuringswachtrij (bron meta_funnel).
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { analyzeMetaFunnel, renderMetaFunnelMarkdown, type MetaFunnelDailyRow } from "@/lib/analysis/meta-funnel-facts";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { eis, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

const SECTION = "meta_funnel_v1";
const SOP_TYPE = "meta_funnel";
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

  // Demo-bewust, net als de GET (sloop-audit 1 sep 2026: POST gebruikte de echte client
  // terwijl GET demo-bewust was).
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
  const since = addDays(today(), -FETCH_DAYS);
  const rowsRes = await supabase
    .from("meta_account_daily")
    .select("date, impressions, link_clicks, landing_page_views, add_to_cart, initiate_checkout, conversions")
    .eq("client_id", clientId)
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(1000);
  const daily = eis(rowsRes, "meta_account_daily") as MetaFunnelDailyRow[];
  if (daily.length === 0) {
    return Response.json({ error: "Geen Meta-dagdata voor deze klant; draai eerst de Meta-sync. Bron: meta_account_daily." }, { status: 404 });
  }

  const facts = analyzeMetaFunnel(daily);
  const output = renderMetaFunnelMarkdown(facts);
  const actionNeeded = facts.worst !== null;

  const analysisDate = today();
  // De echte grenzen van wat geanalyseerd is: splitWindows ankert op de laatste datadatum,
  // dus de periode is de dagspan van de data — niet "70 dagen wandklok tot vandaag".
  const datums = daily.map((r) => r.date).sort();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate,
      period_start: datums[0], period_end: datums[datums.length - 1], section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "Meta funnel",
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  const proposals: SprintHypothesisRow[] = facts.worst
    ? [{
        client_id: clientId, analysis_id: null,
        // deltaPct is negatief bij een verslechtering; Math.abs voorkomt "-24% verslechterd".
        hypothesis: `Onderzoek de Meta-funnelfase ${facts.worst.from} → ${facts.worst.to} (${Math.round(Math.abs(facts.worst.deltaPct ?? 0) * 100)}% verslechterd)`,
        expected_result: "De oorzaak van de fase-verslechtering is gevonden (creative, doelgroep of landingservaring) en de overgangsrate herstelt richting het prior-venster.",
        measurement_metric: "De overgangsrate van deze fase in de volgende funnel-analyse.",
        timeframe: "2 weken",
        rationale: `Rate zakte van ${Math.round((facts.worst.priorRate ?? 0) * 1000) / 10}% naar ${Math.round((facts.worst.recentRate ?? 0) * 1000) / 10}% bij ${facts.worst.recentFromVolume} instap-volume.`,
        ice_impact: 6, ice_confidence: 7, ice_ease: 5,
        ice_total: Math.round(((6 + 7 + 5) / 3) * 10) / 10,
        status: "pending", source: "meta_funnel",
      }]
    : [];
  await saveProposalsReplacingPending(supabase, clientId, "meta_funnel", proposals);

  return Response.json({ analysis: output, actionNeeded, stages: facts.stages.length, skipped: facts.skippedStages });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
