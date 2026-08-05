import { NextRequest } from "next/server";
import {
  listAccessibleCustomers,
  getAccountMetricsByMonth,
  getAccountMetricsByWeek,
  getCampaignMetricsByMonth,
  getConversionActions,
  type GoogleAdsCredentials,
} from "@/lib/api/google-ads";
import { credentialsUitOmgeving } from "@/lib/tenancy/credentials";


export async function GET(request: NextRequest) {
  const credentials = credentialsUitOmgeving();
  if (!credentials) {
    return Response.json(
      { error: "Google Ads API credentials not configured", connected: false },
      { status: 200 }
    );
  }

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action");
  const customerId = searchParams.get("customerId") || "";
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";

  try {
    switch (action) {
      case "status":
        return Response.json({ connected: true });

      case "customers":
        const customers = await listAccessibleCustomers(credentials);
        return Response.json({ connected: true, customers });

      case "account-monthly":
        const monthly = await getAccountMetricsByMonth(credentials, customerId, startDate, endDate);
        return Response.json({ data: monthly });

      case "account-weekly":
        const weekly = await getAccountMetricsByWeek(credentials, customerId, startDate, endDate);
        return Response.json({ data: weekly });

      case "campaigns":
        const campaigns = await getCampaignMetricsByMonth(credentials, customerId, startDate, endDate);
        return Response.json({ data: campaigns });

      case "conversion-actions":
        const actions = await getConversionActions(credentials, customerId);
        return Response.json({ data: actions });

      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message, connected: false }, { status: 500 });
  }
}
