import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { fetchBlendedHistoricalData } from "@/lib/api/blended-historical";

/**
 * GET /api/blended/client-data?clientId=xxx
 *
 * Jaren-/maandhistorie over Google + Meta + LinkedIn samen, voor de Prognose-tabel op
 * "Alle kanalen" (zelfde Verwacht/Gerealiseerd/Prognose/Ratio-tabel als Google altijd al had,
 * nu ook met gecombineerde data -- feedback 22 augustus).
 *
 * Bewust GEEN live-API-aanroepen (in tegenstelling tot /api/google-ads/client-data): dit leest
 * fact_core rechtstreeks, dezelfde bron als Campagnes/Overzicht voor Meta/LinkedIn al gebruiken.
 * Ook bewust GEEN supabaseForClient()/demo-mock-wrapper -- die serveert curated JS-fixtures die
 * fact_core niet dekken (het "split-brain"-patroon uit masterplan 17.78); deze route hoort voor
 * demo-greentech dezelfde echte databaserijen te lezen als voor een productieklant.
 */
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const data = await fetchBlendedHistoricalData(supabase, clientId);
  if (!data) {
    return Response.json({ error: `Geen blended data voor "${clientId}"` }, { status: 404 });
  }

  return Response.json(data);
}
