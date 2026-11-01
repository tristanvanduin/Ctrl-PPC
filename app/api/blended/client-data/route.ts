import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { fetchBlendedHistoricalData } from "@/lib/api/blended-historical";
import { dataFoutNaarResponse } from "@/lib/analysis/db-veilig";

/**
 * GET /api/blended/client-data?clientId=xxx
 *
 * Jaren-/maandhistorie over Google + Meta + LinkedIn + Microsoft samen, voor het Jaaroverzicht,
 * de Prognose-tabel en de Pacing op "Alle kanalen" (zelfde Verwacht/Gerealiseerd/Prognose/Ratio-
 * tabel als Google altijd al had, nu ook met gecombineerde data -- feedback 22 augustus). Het
 * antwoord draagt ook `dataStand` (tot welke maand de data over alle kanalen vol is) en
 * `perKanaal` (dezelfde maanden per kanaal, zodat de Pacing per kanaal kan paren). Zie
 * lib/api/blended-historical.ts voor de bronnen.
 *
 * Bewust GEEN live-API-aanroepen (in tegenstelling tot /api/google-ads/client-data): dit leest
 * fact_core (Google) en de dagtabellen (Meta, LinkedIn, Microsoft) rechtstreeks, dezelfde bronnen
 * als de KPI-band. Ook bewust GEEN supabaseForClient()/demo-mock-wrapper -- die serveert curated
 * JS-fixtures die deze tabellen niet dekken (het "split-brain"-patroon uit masterplan 17.78); deze
 * route hoort voor demo-greentech dezelfde echte databaserijen te lezen als voor een productieklant.
 */
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  try {
    const data = await fetchBlendedHistoricalData(supabase, clientId);
    if (!data) {
      return Response.json({ error: `Geen blended data voor "${clientId}"` }, { status: 404 });
    }
    return Response.json(data);
  } catch (e) {
    // Een kapotte query is een 500 die de bron noemt, geen "geen data"-404.
    const fout = dataFoutNaarResponse(e);
    if (fout) return fout;
    throw e;
  }
}
