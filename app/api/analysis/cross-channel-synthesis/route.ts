// Kanaaloverstijgende SYNTHESE — de LLM-laag die lib/analysis/cross-channel-synthesis.ts bouwt
// (masterplan 17.12). Los van /api/analysis/cross-channel (volledig deterministisch, geen LLM):
// die route detecteert SIGNALEN tussen kanalen; deze route SYNTHETISEERT de al afgeronde
// eindconclusies van elk kanaal tot één samenhangend verhaal + acties, pas als alle beschikbare
// kanalen deze cyclus klaar zijn. Zie het bestand zelf voor de volledige toelichting.

import { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey } from "@/lib/analysis/helpers";
import { runCrossChannelSynthesis } from "@/lib/analysis/cross-channel-synthesis";
import { laadBeschikbareKanalen } from "@/lib/kanalen/beschikbaar";
import { lastCompleteMonth } from "@/lib/period/period-range";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";

const SOP_TYPE = "cross_channel";
const SECTION = "cross_channel_synthesis_v1";

function periodBounds(): { start: string; end: string } {
  const month = lastCompleteMonth(); // "YYYY-MM"
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10); // laatste dag van die maand
  return { start, end };
}

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOP_TYPE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.output) return Response.json({ synthesis: null, analysisDate: null });

  try {
    const synthesis = JSON.parse(String(data.output));
    return Response.json({ synthesis, analysisDate: data.analysis_date });
  } catch {
    return Response.json({ synthesis: null, analysisDate: null });
  }
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  // "as never": zelfde workaround als trigger-sops/route.ts al gebruikt -- laadBeschikbareKanalen's
  // structurele parametertype laat TS bij een volle SupabaseClient "Type instantiation is
  // excessively deep and possibly infinite" geven, ondanks dat de vorm wel klopt.
  const beschikbareKanalen = await laadBeschikbareKanalen(supabase as never, clientId);
  const { start, end } = periodBounds();

  try {
    const result = await runCrossChannelSynthesis({
      supabase,
      apiKey,
      clientId,
      beschikbareKanalen,
      analysisDate: today(),
      periodStart: start,
      periodEnd: end,
    });

    if (result.skipped) {
      return Response.json({ skipped: true, reason: result.reason }, { status: 409 });
    }
    return Response.json({
      skipped: false,
      synthesis: result.result,
      model: result.model,
      tokensUsed: result.tokensUsed,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Synthese mislukt" }, { status: 500 });
  }
}
