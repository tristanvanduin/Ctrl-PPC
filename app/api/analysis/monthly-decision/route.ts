// Master Synthesis (Pijler 6), Fase D: de werkende route. Vervangt het EXECUTION_PLAN.md Stap 4
// skelet (handleDecisionSkeleton, nu ongebruikt hier) door de echte keten: evidence-ingestie
// (Fase A) -> LLM-synthese (Fase B) -> opslag (Fase C). weekly-decision/biweekly-decision
// blijven ONGEWIJZIGD op handleDecisionSkeleton -- deze uitbreiding is bewust scope-beperkt tot
// monthly, waar de audit "Master Synthesis Audit" hem plaatste.

import type { NextRequest } from "next/server";
import { getSupabase, getOpenRouterKey } from "@/lib/analysis/helpers";
import { klantVanId } from "@/lib/tenancy/klanten";
import { magSopDraaien } from "@/lib/tenancy/sop-dekking";
import { fmt, today } from "@/lib/reporting-date";
import { thirteenMonthStart } from "@/lib/meta/analysis-data";
import { runMasterSynthesis } from "@/lib/decision/master-synthesis";
import { saveMasterSynthesis } from "@/lib/decision/master-synthesis-storage";

// Zelfde reden als app/api/analysis/monthly/route.ts: zonder dit valt de route terug op Vercel's
// (veel kortere) platformdefault en breekt een lange analyse af met een platte foutpagina i.p.v.
// JSON, wat de client als "Unexpected token... is not valid JSON" laat zien in plaats van een
// bruikbare foutmelding.
// 600s sinds de upgrade naar Vercel Pro (mag in code tot 1800s) -- zelfde marge-redenering
// als app/api/analysis/monthly/route.ts, waar de kale Google-hoofdanalyse al 284-313s bleek
// te duren op de oude 300s-grens.
export const maxDuration = 600;

function berekenPeriodEnd(): string {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const analysisYear = currentMonth === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const lastCompleteMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  return fmt(new Date(analysisYear, lastCompleteMonth, 0));
}

// Laatste opgeslagen run, voor de UI-kaart (net als cross-channel's GET-handler).
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, analysis_date, period_start, period_end")
    .eq("client_id", clientId)
    .eq("sop_type", "master_synthesis")
    .eq("section", "master_synthesis_v1")
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  let clientId: string;
  try {
    const body = await request.json();
    clientId = body?.client_id;
    if (!clientId || typeof clientId !== "string") throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  const klant = await klantVanId(supabase, clientId);
  if (!klant) return Response.json({ error: "Onbekende klant" }, { status: 404 });

  if (!(await magSopDraaien(supabase, clientId))) {
    return Response.json({ error: "SOP's zijn uitgeschakeld voor dit account." }, { status: 403 });
  }

  const periodEnd = berekenPeriodEnd();
  const periodStart = thirteenMonthStart(periodEnd);
  const analysisDate = today();

  // Fase A (evidence) + Fase B (LLM-synthese) in één aanroep. runMasterSynthesis doet de
  // pre-flight zelf (isEvidencePayloadEmpty): geen LLM-call op een lege evidence_payload.
  const result = await runMasterSynthesis({ supabase, apiKey, clientId, periodEnd });

  if (result.skipped) {
    return Response.json({
      ok: true,
      status: "geen_data",
      message: result.skipReason,
      evidenceChannels: result.evidencePayload.availableChannels,
    });
  }

  if (!result.output) {
    return Response.json({
      ok: false,
      status: "synthese_mislukt",
      error: result.schemaError ?? "Synthese kon niet gevalideerd worden.",
    }, { status: 502 });
  }

  if (!result.validation?.valid) {
    // Ook na de repair-poging nog fouten: niet opslaan (geen halve/foute wachtrij-rijen), wel
    // het resultaat teruggeven zodat zichtbaar is waarom.
    return Response.json({
      ok: false,
      status: "validatie_mislukt",
      error: "Master Synthesis-output voldeed na de herstelpoging niet aan de validatie.",
      validation: result.validation,
      output: result.output,
    }, { status: 502 });
  }

  // Fase C (opslag).
  const saved = await saveMasterSynthesis({
    supabase,
    clientId,
    analysisDate,
    periodStart,
    periodEnd,
    output: result.output,
    model: result.model ?? "onbekend",
    tokensUsed: result.tokensUsed,
  });

  return Response.json({
    ok: true,
    status: "opgeslagen",
    periodStart,
    periodEnd,
    evidenceChannels: result.evidencePayload.availableChannels,
    narrative: result.output.narrative,
    hypotheses: result.output.hypotheses.length,
    tasks: result.output.tasks.length,
    hypothesesSaved: saved.hypothesesSaved,
    tasksSaved: saved.tasksSaved,
    tasksUnlinked: saved.tasksUnlinked,
    repaired: result.repaired,
    tokensUsed: result.tokensUsed,
    model: result.model,
  });
}
