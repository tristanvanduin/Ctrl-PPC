import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { syncMerchantProductSnapshots } from "@/lib/api/merchant-products";
import type { GoogleAdsCredentials } from "@/lib/api/google-ads";
import { credentialsUitOmgeving } from "@/lib/tenancy/credentials";

export const maxDuration = 300;


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const credentials = credentialsUitOmgeving();
  let clientId: string;
  try {
    const body = await request.json();
    clientId = body.client_id;
    if (!clientId) throw new Error("missing");
  } catch {
    return Response.json({ error: "Verwacht: { client_id }" }, { status: 400 });
  }

  const result = await syncMerchantProductSnapshots({
    supabase,
    clientId,
    credentials,
    forceRefresh: true,
  });

  return Response.json({
    clientId,
    tracker: result.tracker,
    message: result.message,
    productCount: result.products.length,
  });
}
