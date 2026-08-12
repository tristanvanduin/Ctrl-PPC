// Kanaalneutrale forecast t.b.v. de client-side Account Health-badge op Meta- en LinkedIn-
// tabbladen. Google blijft draaien via het bestaande /api/google-ads/client-data +
// ClientDataProvider-pad (ForecastContext) -- dat is Google-specifiek gebouwd (customerId-param,
// live API-call) en hier bewust niet aangeraakt. Deze route is de kleine, losse aanvulling voor
// de kanalen die dat pad nooit hadden.
//
// Leunt volledig op computeAnalysisTargets(channel) uit fase A (12 aug 2026): voor Meta/LinkedIn
// leest die fact_core rechtstreeks, al gevuld door refresh_rollups(). Geen nieuwe berekening
// hier, puur een dunne HTTP-laag eromheen -- zelfde patroon als de andere GET-routes onder
// app/api/analysis/* (geen aparte requireCapability-check, valt onder de O1-middleware zoals de
// rest van die map).

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { computeAnalysisTargets, type AnalysisChannel } from "@/lib/analysis/compute-targets";

function isChannel(v: string | null): v is AnalysisChannel {
  return v === "google" || v === "meta" || v === "linkedin";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  const channel = url.searchParams.get("channel");

  if (!clientId || !isChannel(channel)) {
    return Response.json(
      { error: "clientId en een geldige channel ('google'|'meta'|'linkedin') zijn verplicht" },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const result = await computeAnalysisTargets(admin, clientId, channel);
  return Response.json({ forecast: result?.forecast ?? null });
}
