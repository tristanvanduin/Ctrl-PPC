// Het afronden van een weekly- of biweekly-run: pas na de extractie, en alleen als de bevindingen
// er staan.
//
// ── WAAROM DIT NIET MEER IN DE ROUTE STAAT ──────────────────────────────────
//
// De acht kanaalpaden in weekly/ en biweekly/ schreven eerst de "full"-rij (het afrondingsteken
// waarop de due-check en de cross-channel-synthese leunen), draaiden dan de extractie, en zetten
// de job daarna onvoorwaardelijk op "gereed" met een 200. Mislukte de bevindingen-parse of het
// opslaan, dan zei de job "gereed", toonde de knop een nieuwe "laatst gedraaid"-datum, en sloeg de
// cron de volgende cyclus over: een halve run telde als gedraaid (doorlichting 13 november).
//
// Nu: mislukt de extractie, dan gaat de job op failed met de reden, komt er geen "full"-rij, en
// geeft de route een 502. Geslaagd met waarschuwingen (bevindingen die afvielen, getallen die niet
// uit de brondata kwamen) staat in de jobmelding zelf, niet alleen in een serverlog.

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveAnalysisOutputSection, type AnalysisResult } from "./helpers";
import { markProgressCompleted, markProgressFailed } from "@/lib/progress/server";
import { extractieUitkomst } from "./bevinding-weergave";
import type { ExtractionResult } from "./extract-structured";

/** Het afrondingsteken: section "full". Alleen een run met opgeslagen bevindingen krijgt hem. */
async function schrijfAfrondingsteken(supabase: SupabaseClient, result: AnalysisResult): Promise<void> {
  await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: result.clientId, sop_type: result.sopType, analysis_date: result.analysisDate,
      period_start: result.periodStart, period_end: result.periodEnd,
      section: "full", output: result.output, model_used: result.model, tokens_used: result.tokensUsed,
    },
  });
}

/**
 * Rondt de run af. Geeft een Response terug als de run mislukt is (de route geeft die direct
 * terug), anders null en gaat de route door met zijn normale antwoord.
 */
export async function rondExtractieAf(supabase: SupabaseClient, opts: {
  jobId: string;
  result: AnalysisResult;
  extraction: ExtractionResult;
  gereedTekst: string;
}): Promise<Response | null> {
  const { jobId, result, extraction, gereedTekst } = opts;
  const afronding = extractieUitkomst(extraction, gereedTekst);
  const metadata = {
    analysis_date: result.analysisDate,
    sop_type: result.sopType,
    findings: extraction.findings.length,
    recommendations: extraction.recommendations.length,
    tasks: extraction.tasks.length,
    waarschuwingen: extraction.waarschuwingen,
    brondata: extraction.brondata,
  };
  if (afronding.mislukt) {
    await markProgressFailed(supabase, {
      jobId,
      errorMessage: afronding.melding,
      metadata,
      partialOutputExists: true,
    });
    return Response.json({
      jobId,
      ...result,
      error: afronding.melding,
      structured: {
        findings: extraction.findings.length,
        saved: extraction.saved,
        findingsParseOk: extraction.findingsParseOk,
        recsParseOk: extraction.recsParseOk,
        waarschuwingen: extraction.waarschuwingen,
      },
    }, { status: 502 });
  }
  await schrijfAfrondingsteken(supabase, result);
  await markProgressCompleted(supabase, { jobId, message: afronding.melding, metadata });
  return null;
}
