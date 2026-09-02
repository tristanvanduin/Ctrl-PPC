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
//
// Herbouwd 1 september 2026 na de sloop-audit: (1) de POST schreef via getSupabase() terwijl de
// GET demo-bewust las, waardoor demo-mockcijfers in de ECHTE sop_analysis_output en
// sprint_hypotheses landden; (2) de data kon maanden achterlopen zonder dat iemand het zag —
// de jongste maand wordt nu vergeleken met de laatste afgesloten maand en een achterstand wordt
// expliciet gemeld; (3) period_start/period_end stonden op de rundatum in plaats van op het
// echte datavenster.
// =====================================================================

import { NextRequest } from "next/server";
import { saveAnalysisOutputSection } from "@/lib/analysis/helpers";
import { renderSignalSection } from "@/lib/signals/render-section";
import { mergeDetections } from "@/lib/signals/types";
import { saveSignalHypotheses } from "@/lib/analysis/signals-to-hypotheses";
import { buildGeoSignals } from "@/lib/signals/geo-analysis";
import { resolveGeoMetVenster, type GeoChannel } from "@/lib/geo/geo-source";
import { today } from "@/lib/reporting-date";
import { supabaseForClient } from "@/lib/demo/server-supabase";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { laatsteAfgeslotenMaandStart, maandSleutel, maandStart } from "@/lib/analysis/db-veilig";

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

  // Het toegangsslot: deze route is LLM-loos maar schrijft wél (sop_analysis_output en de
  // wachtrij), dus hetzelfde slot als de kern-routes (sloop-audit 1 sep 2026).
  const geweigerd = await vereisKlantToegangUitBody(request, "analysis:run", clientId);
  if (geweigerd) return geweigerd;

  // Demo-bewust, net als de GET: mock-writes horen no-ops te zijn. De oude getSupabase() liet
  // demo-mockcijfers in de echte tabellen landen (sloop-audit 1 sep 2026).
  const supabase = supabaseForClient(clientId);
  if (!supabase) return Response.json({ error: "Supabase is niet geconfigureerd" }, { status: 500 });

  // resolveGeoMetVenster bepaalt zelf demo vs. echt aan de hand van clientId (zie
  // lib/geo/geo-source.ts) en levert naast de rijen ook het echte maandbereik van de data.
  const label = CHANNEL_LABEL[channel];
  const [landenRes, statenRes] = await Promise.all([
    resolveGeoMetVenster({ clientId, channel, level: "country" }),
    resolveGeoMetVenster({ clientId, channel, level: "region" }),
  ]);
  const countries = landenRes.rows;
  const states = statenRes.rows;

  if (countries.length === 0 && states.length === 0) {
    return Response.json({ error: `Geen geo-data voor ${label} in dit venster` }, { status: 404 });
  }

  // Het echte datavenster over beide niveaus heen. Null blijft null (demo-data draagt geen
  // maanden); DATE-strings vergelijken tekstueel correct.
  const maanden = [landenRes.eersteMaand, landenRes.laatsteMaand, statenRes.eersteMaand, statenRes.laatsteMaand]
    .filter((m): m is string => m != null);
  const eersteMaand = maanden.length > 0 ? maanden.reduce((a, b) => (a < b ? a : b)) : null;
  const laatsteMaand = maanden.length > 0 ? maanden.reduce((a, b) => (a > b ? a : b)) : null;

  // Versheid: is de jongste maand in de data ouder dan de laatste afgesloten kalendermaand,
  // dan beoordelen we verouderde markten en hoort de lezer dat te weten — in de tekst én in
  // het response-veld, niet stilzwijgend (sloop-audit 1 sep 2026).
  const afgeslotenMaand = laatsteAfgeslotenMaandStart();
  const verouderd = laatsteMaand != null && maandStart(laatsteMaand) < afgeslotenMaand;

  // Beide niveaus apart. Er is geen extra drempel nodig voor "is de VS groot genoeg": de detector
  // eist zelf al een minimum aantal staten dat de volume-eis haalt, dus een land met een handvol
  // marginale staten levert vanzelf niets op in plaats van een eigen norm te gaan vormen.
  const merged = mergeDetections([
    buildGeoSignals(countries, "country", label),
    buildGeoSignals(states, "region", label),
  ]);

  const title = `Landen & staten — ${label}`;
  const { section, triggeredCount, checkedIds } = renderSignalSection(merged, title);
  let output = section || `## ${title}\n\nGeen opvallende markten. Gecontroleerd: ${checkedIds.join(", ")}.`;
  if (verouderd && laatsteMaand != null) {
    output += `\n\n> **Let op: verouderde data.** De jongste maand in de geo-data is ${maandSleutel(laatsteMaand)}, terwijl de laatste afgesloten maand ${maandSleutel(afgeslotenMaand)} is. De bevindingen hierboven gaan dus over een ouder venster; draai de Google-sync om ze actueel te maken.`;
  }

  const analysisDate = today();
  // period_start/period_end: het echte datavenster (eerste t/m laatste maand in de gebruikte
  // rijen), niet de rundatum. Alleen demo-data zonder maandinformatie valt terug op de rundatum.
  const periodStart = eersteMaand != null ? maandStart(eersteMaand) : analysisDate;
  const periodEnd = laatsteMaand != null ? maandStart(laatsteMaand) : analysisDate;
  const { error: saveError } = await saveAnalysisOutputSection({
    supabase,
    row: {
      client_id: clientId, sop_type: SOURCE, analysis_date: analysisDate,
      period_start: periodStart, period_end: periodEnd, section: SECTION,
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
    verouderd,
    venster: {
      start: eersteMaand != null ? maandSleutel(eersteMaand) : null,
      eind: laatsteMaand != null ? maandSleutel(laatsteMaand) : null,
    },
  });
}
