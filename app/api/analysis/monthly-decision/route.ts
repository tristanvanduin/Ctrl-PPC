// Master Synthesis: de werkende route. Evidence-ingestie (Fase A) -> LLM-synthese (Fase B) ->
// opslag (Fase C). weekly-decision/biweekly-decision blijven op handleDecisionSkeleton -- die
// schrijven niets en roepen geen model aan.
//
// HERBOUW 2 SEPTEMBER 2026 (sloop-audit beslislaag)
// - Toegang: vereisKlantToegangUitBody + supabaseForClient, zoals elke andere analyse-POST.
// - Periode: lastCompleteMonth() en een UTC-correcte einddag (db-veilig). De oude route rekende
//   met new Date().getMonth() (server-UTC) naast analysisDate = today() (Amsterdam): tussen
//   00:00 en 02:00 op de eerste van de maand lag periodEnd een maand te vroeg.
// - Fouten zijn fouten: een datalaagfout in de evidence is een 500 die de bron noemt, geen
//   "geen_data"; een schrijffout is een 500, geen "opgeslagen".
// - `automatisch`/magSopDraaien was dode code: geen cron roept deze route aan (vercel.json kent
//   alleen /api/sync/cron; trigger-sops kent monthly-decision niet). Weg, tot er een aanroeper is.

import type { NextRequest } from "next/server";
import { getOpenRouterKey } from "@/lib/analysis/helpers";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { klantVanId } from "@/lib/tenancy/klanten";
import { today } from "@/lib/reporting-date";
import { eis, dataFoutNaarResponse, laatsteAfgeslotenMaandGrenzen, afgeslotenMaandenTerugStart } from "@/lib/analysis/db-veilig";
import { runMasterSynthesis } from "@/lib/decision/master-synthesis";
import { saveMasterSynthesis, MASTER_SYNTHESIS_SECTION, MASTER_SYNTHESIS_SOP_TYPE } from "@/lib/decision/master-synthesis-storage";

// Zelfde reden als app/api/analysis/monthly/route.ts: zonder dit valt de route terug op Vercel's
// (veel kortere) platformdefault en breekt een lange analyse af met een platte foutpagina i.p.v.
// JSON. 600s sinds Vercel Pro.
export const maxDuration = 600;

// 13 afgesloten maanden: de laatste afgesloten maand plus twaalf ervoor.
const VENSTER_MAANDEN_TERUG = 12;

// Laatste opgeslagen run, voor de UI-kaart.
export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  try {
    const rijen = eis(
      await supabase
        .from("sop_analysis_output")
        .select("output, analysis_date, period_start, period_end, model_used")
        .eq("client_id", clientId)
        .eq("sop_type", MASTER_SYNTHESIS_SOP_TYPE)
        .eq("section", MASTER_SYNTHESIS_SECTION)
        .order("analysis_date", { ascending: false })
        .limit(1),
      "sop_analysis_output (master_synthesis_v1)"
    );
    return Response.json({ analysis: rijen[0] ?? null });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}

export async function POST(request: NextRequest) {
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body?.client_id;
    if (!clientId || typeof clientId !== "string") throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const klant = await klantVanId(supabase, clientId);
  if (!klant) return Response.json({ error: "Onbekende klant" }, { status: 404 });

  const grenzen = laatsteAfgeslotenMaandGrenzen();
  const periodEnd = grenzen.eind;
  const periodStart = afgeslotenMaandenTerugStart(VENSTER_MAANDEN_TERUG);
  const analysisDate = today();

  try {
    // Fase A (evidence) + Fase B (LLM-synthese) in één aanroep; de pre-flight
    // (isEvidencePayloadEmpty) voorkomt een LLM-call op een lege evidence_payload.
    const result = await runMasterSynthesis({ supabase, apiKey, clientId, periodEnd });
    const dekking = result.evidencePayload.dekking;

    if (result.skipped) {
      return Response.json({
        ok: true,
        status: "geen_data",
        message: result.skipReason,
        evidenceChannels: result.evidencePayload.availableChannels,
        dekking,
      });
    }

    if (!result.output) {
      return Response.json({
        ok: false,
        status: "synthese_mislukt",
        error: result.schemaError ?? "Synthese kon niet gevalideerd worden.",
        rawKop: result.rawKop,
        dekking,
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
        dekking,
      }, { status: 502 });
    }

    // Fase C (opslag). Elke schrijffout gooit DataLaagFout -> 500 hieronder.
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
      wezenOpgeruimd: saved.wezenOpgeruimd,
      repaired: result.repaired,
      validationWarnings: result.validation.warnings,
      toegestaneCijfers: result.toegestaneCijfers,
      tokensUsed: result.tokensUsed,
      model: result.model,
      dekking,
    });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
