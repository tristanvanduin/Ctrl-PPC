// =====================================================================
// Losse Google funnel-drop-off-analyse op de gedeelde funnel-kern. Google levert account-
// breed drie fasen (vertoning -> klik -> conversie) op WEEKDATA (ads_account_weekly);
// het venster is 4 weken vs de 4 weken ervoor. Deterministisch, geen LLM.
//
// Herbouwd 1 september 2026 na de sloop-audit: het venster bevatte de lopende (deel)week
// én de jongste dagen waarin conversies nog nadruppelen, waardoor de klik→conversie-rate
// structureel gedrukt werd en een "materiële verslechtering" vaker een meetartefact was
// dan een funnelprobleem. Nu tellen alleen afgesloten weken mee die ook de
// conversie-lag (client_settings.conversion_lag_days, elders al de standaard) voorbij
// zijn. Queryfouten worden gemeld in plaats van als "geen data" gelezen.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { analyzeGoogleFunnel, renderGoogleFunnelMarkdown, type GoogleFunnelWeeklyRow } from "@/lib/analysis/google-funnel-facts";
import { saveProposalsReplacingPending, type SprintHypothesisRow } from "@/lib/second-opinion/findings-to-hypotheses";
import { today, addDays } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { eis, dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

const SECTION = "google_funnel_v1";
const SOP_TYPE = "google_funnel";
const FETCH_DAYS = 84; // 12 weken: ruim voor 2×4 afgesloten weken, ook met lag ertussen

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
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

  // Demo-bewust, net als de GET.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  try {
    const vandaag = today();
    const since = addDays(vandaag, -FETCH_DAYS);

    // De conversie-lag van deze klant (default 3, hetzelfde als biweekly en expert-layers):
    // een week telt pas mee als hij afgesloten is ÉN zijn conversies zijn nagedruppeld.
    const lagRes = await supabase
      .from("client_settings")
      .select("conversion_lag_days")
      .eq("client_id", clientId)
      .maybeSingle();
    const lagDays = (lagRes.data?.conversion_lag_days as number | null) ?? 3;
    // week_start + 6 is de laatste dag van de week; die moet minstens lagDays achter
    // vandaag liggen. Dus: week_start <= vandaag - 7 - lagDays.
    const laatsteWeekStart = addDays(vandaag, -(7 + Math.max(0, lagDays)));

    const rowsRes = await supabase
      .from("ads_account_weekly")
      .select("week_start, impressions, clicks, conversions")
      .eq("client_id", clientId)
      .gte("week_start", since)
      .lte("week_start", laatsteWeekStart)
      .order("week_start", { ascending: false })
      .limit(1000);
    const rows = eis(rowsRes, "ads_account_weekly");

    const weekly: GoogleFunnelWeeklyRow[] = rows.map((r) => ({
      date: String(r.week_start), impressions: r.impressions, clicks: r.clicks, conversions: r.conversions,
    }));
    if (weekly.length === 0) {
      return Response.json(
        { error: "Geen afgesloten Google-weekdata voor deze klant. Bron: ads_account_weekly; draai de Google-sync als die leeg hoort te zijn." },
        { status: 404 }
      );
    }

    const facts = analyzeGoogleFunnel(weekly);
    const output = renderGoogleFunnelMarkdown(facts);
    const actionNeeded = facts.worst !== null;

    const analysisDate = today();
    const weekStarts = weekly.map((w) => w.date).sort();
    const { error: saveError } = await saveAnalysisOutputSection({
      supabase,
      row: {
        client_id: clientId, sop_type: SOP_TYPE, analysis_date: analysisDate,
        // De echte grenzen van wat geanalyseerd is: eerste weekstart t/m einde laatste week.
        period_start: weekStarts[0], period_end: addDays(weekStarts[weekStarts.length - 1], 6),
        section: SECTION,
        output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: "Google funnel",
      },
    });
    if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

    const proposals: SprintHypothesisRow[] = facts.worst
      ? [{
          client_id: clientId, analysis_id: null,
          // deltaPct is hier per definitie negatief; Math.abs voorkomt de dubbele
          // ontkenning "-24% verslechterd".
          hypothesis: `Onderzoek de Google-funnelfase ${facts.worst.from} → ${facts.worst.to} (${Math.round(Math.abs(facts.worst.deltaPct ?? 0) * 100)}% verslechterd)`,
          expected_result: "De oorzaak van de fase-verslechtering is gevonden (zoekintentie, landing, meting) en de overgangsrate herstelt richting het prior-venster.",
          measurement_metric: "De overgangsrate van deze fase in de volgende funnel-analyse.",
          timeframe: "2 weken",
          rationale: `Rate zakte van ${Math.round((facts.worst.priorRate ?? 0) * 1000) / 10}% naar ${Math.round((facts.worst.recentRate ?? 0) * 1000) / 10}% bij ${Math.round(facts.worst.recentFromVolume)} instap-volume. Alleen afgesloten weken buiten de conversie-lag (${lagDays}d) geteld.`,
          ice_impact: 6, ice_confidence: 7, ice_ease: 5,
          ice_total: Math.round(((6 + 7 + 5) / 3) * 10) / 10,
          status: "pending", source: "google_funnel",
        }]
      : [];
    await saveProposalsReplacingPending(supabase, clientId, "google_funnel", proposals);

    return Response.json({ analysis: output, actionNeeded, stages: facts.stages.length, skipped: facts.skippedStages });
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    throw e;
  }
}
