// =====================================================================
// Landen- en statenanalyse. De geo-kaart liet al zien wáár het verkeer vandaan komt, maar trok
// geen conclusie — een kaart is een kijkinstrument. Deze route beoordeelt de markten en zet de
// bevindingen in de wachtrij, onder de bron "geo_markets".
//
// Twee niveaus in één run: landen, en binnen de Verenigde Staten de staten. Ze worden apart
// beoordeeld, want een staat hoort tegen andere staten te worden afgezet en niet tegen landen;
// anders wordt een structureel duurdere markt (hogere CPC's in de VS) als probleem gemarkeerd.
//
// Leest via lib/geo/geo-source.ts, dezelfde bron als de kaart, zodat scherm en analyse per
// definitie hetzelfde zeggen. Deterministisch, geen LLM.
// =====================================================================

import { NextRequest } from "next/server";
import { getSupabase, saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { renderSignalSection } from "@/lib/signals/render-section";
import { mergeDetections } from "@/lib/signals/types";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { buildGeoSignals } from "@/lib/signals/geo-analysis";
import { resolveGeo, type GeoChannel } from "@/lib/geo/geo-source";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";

const SOURCE = "geo_markets" as const;
const SECTION = "geo_markets_v1";
const CHANNELS: GeoChannel[] = ["google", "meta", "linkedin", "blended"];
const CHANNEL_LABEL: Record<GeoChannel, string> = {
  google: "Google", meta: "Meta", linkedin: "LinkedIn", blended: "Alle kanalen",
};

function parseChannel(v: string | null): GeoChannel {
  return CHANNELS.includes(v as GeoChannel) ? (v as GeoChannel) : "google";
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  // Demo-rijen voor de demo-klant, de echte client voor de rest.
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const { data } = await supabase
    .from("sop_analysis_output")
    .select("output, model_used, analysis_date")
    .eq("client_id", clientId)
    .eq("sop_type", SOURCE)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ analysis: data ?? null });
}

export async function POST(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  const channel = parseChannel(request.nextUrl.searchParams.get("channel"));
  // Demo mag expliciet worden meegegeven; anders volgt de route de env-vlag, zodat een
  // demo-omgeving dezelfde mock ziet als de kaart en analyse en scherm niet uiteenlopen.
  const demoParam = request.nextUrl.searchParams.get("demo");
  const demo = demoParam === "1" || (demoParam == null && process.env.NEXT_PUBLIC_DEMO_MODE === "true");
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  const label = CHANNEL_LABEL[channel];
  const [countries, states] = await Promise.all([
    resolveGeo({ clientId, channel, level: "country", demo }),
    resolveGeo({ clientId, channel, level: "region", demo }),
  ]);

  if (countries.length === 0 && states.length === 0) {
    return Response.json({ error: `Geen geo-data voor ${label} in dit venster` }, { status: 404 });
  }

  // Beide niveaus apart. Er is geen extra drempel nodig voor "is de VS groot genoeg": de detector
  // eist zelf al een minimum aantal staten dat de volume-eis haalt, dus een land met een handvol
  // marginale staten levert vanzelf niets op in plaats van een eigen norm te gaan vormen.
  const merged = mergeDetections([
    buildGeoSignals(countries, "country", label),
    buildGeoSignals(states, "region", label),
  ]);

  const title = `Landen & staten — ${label}`;
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, title);
  const output = section || `## ${title}\n\nGeen opvallende markten. Gecontroleerd: ${checkedIds.join(", ")}.`;

  const analysisDate = today();
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOURCE, analysis_date: analysisDate,
      period_start: analysisDate, period_end: analysisDate, section: SECTION,
      output, model_used: "deterministisch", tokens_used: 0, step_number: 1, step_name: title,
    },
  });
  if (saveError) return Response.json({ error: "Opslaan mislukt", detail: saveError }, { status: 500 });

  await saveSignalHypotheses(supabase, merged.triggered, SOURCE, { clientId, analysisId: null });

  return Response.json({
    analysis: output,
    signals: triggeredCount,
    checked: checkedIds.length,
    markets: { countries: countries.length, states: states.length },
  });
}
