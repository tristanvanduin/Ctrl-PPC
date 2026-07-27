// =====================================================================
// Land × kanaal — de doorsnede die de kaart en de kanaalverdeling apart al hadden.
//
// Bron: ads_geo_performance_monthly (land × campagne, uit geographic_view) samengevoegd met
// ads_campaign_metadata (campagnetype). Voor Zoeken, Display en Video is één campagne één
// kanaal, dus die doorsnede is een join en geen extra API-call.
//
// Performance Max is de uitzondering: daar spant één campagne alle kanalen. Die rijen komen terug
// als kanaal "pmax_onverdeeld" — budget bekend, kanaaltoewijzing niet gemeten. Zie
// lib/geo/channel-matrix.ts voor waarom we die niet toerekenen.
// =====================================================================

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDemoSupabase } from "@/lib/demo/mock-supabase";
import { demoRows } from "@/lib/demo/demo-rows";
import { buildChannelMatrix, type GeoCampaignRow } from "@/lib/geo/channel-matrix";

const WINDOW_DAYS = 180;
function sinceMonth(): string {
  const d = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const demo = sp.get("demo") === "1";
  if (!clientId) return Response.json({ error: "clientId is verplicht" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const real = url && key ? createClient(url, key) : null;
  const sb = demo ? createDemoSupabase(real, demoRows()) : real;
  if (!sb) return Response.json({ cells: [], evidence: "geen-bron" });

  const [geoRes, metaRes] = await Promise.all([
    sb.from("ads_geo_performance_monthly")
      .select("country_code, campaign_id, impressions, clicks, cost, conversions, conversions_value")
      .eq("client_id", clientId)
      .gte("month", sinceMonth()),
    sb.from("ads_campaign_metadata")
      .select("campaign_id, campaign_type")
      .eq("client_id", clientId),
  ]);

  const campaignTypeById = new Map<string, string>();
  for (const r of (metaRes.data ?? []) as Record<string, unknown>[]) {
    const id = String(r.campaign_id ?? "");
    if (id) campaignTypeById.set(id, String(r.campaign_type ?? ""));
  }

  const rows: GeoCampaignRow[] = ((geoRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    countryCode: r.country_code == null ? null : String(r.country_code),
    campaignId: r.campaign_id == null ? null : String(r.campaign_id),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    cost: Number(r.cost ?? 0),
    conversions: Number(r.conversions ?? 0),
    conversionsValue: Number(r.conversions_value ?? 0),
  }));

  return Response.json({
    evidence: demo ? "demo" : "platform",
    cells: buildChannelMatrix(rows, campaignTypeById),
  });
}
