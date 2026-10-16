import { NextRequest } from "next/server";
import {
  listAdAccounts,
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getConversionEvents,
  type MetaAdsCredentials,
} from "@/lib/api/meta-ads";
import { vereisKlantToegangUitBody } from "@/lib/auth/server";
import { supabaseForClient } from "@/lib/demo/server-supabase";

function getCredentials(): MetaAdsCredentials | null {
  const accessToken = process.env.META_ADS_ACCESS_TOKEN;

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    appId: process.env.META_ADS_APP_ID,
    appSecret: process.env.META_ADS_APP_SECRET,
  };
}

export async function GET(request: NextRequest) {
  // Koppelstatus PER KLANT, uit de rij die de sync gebruikt (lib/sync/kanaal-runs.ts). Een bureau
  // met eigen sleutels in de kluis heeft geen omgevingstoken nodig, dus dat is hier niet de maat.
  // Alleen status, laatste sync en een vlag gaan naar buiten -- geen ruwe fouttekst.
  if (request.nextUrl.searchParams.get("action") === "status") {
    const clientId = request.nextUrl.searchParams.get("client_id");
    if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });
    const toegang = await vereisKlantToegangUitBody(request, "client:read", clientId);
    if (toegang) return toegang;
    const supabase = supabaseForClient(clientId);
    if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });
    const { data, error } = await supabase
      .from("meta_connections")
      .select("status, last_sync_at, last_error")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ status: data?.status ?? null, lastSyncAt: data?.last_sync_at ?? null, faalt: !!data?.last_error });
  }

  const credentials = getCredentials();
  if (!credentials) {
    return Response.json(
      { error: "Meta Ads API credentials not configured", connected: false },
      { status: 200 }
    );
  }

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action");
  const adAccountId = searchParams.get("adAccountId") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";

  try {
    switch (action) {
      case "accounts":
        const accounts = await listAdAccounts(credentials);
        return Response.json({ connected: true, accounts });

      case "account-monthly":
        const monthly = await getAccountMetricsByMonth(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: monthly });

      case "account-weekly":
        const weekly = await getAccountMetricsByWeek(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: weekly });

      case "campaigns":
        const campaigns = await getCampaignMetricsByMonth(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: campaigns });

      case "conversion-events":
        const events = await getConversionEvents(credentials, adAccountId, startDate, endDate);
        return Response.json({ data: events });

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message, connected: false }, { status: 500 });
  }
}
