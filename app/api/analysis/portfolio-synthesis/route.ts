// Portfolio-synthese (masterplan 17.15): de LLM-laag die lib/analysis/portfolio-synthesis.ts
// bouwt. Zelfde tier-gate als de bestaande Macro-portfolioroute (app/api/platform/agency-
// macrotrends/route.ts): vanaf Growth inbegrepen, geen aparte, nieuwe module -- dit hoort bij
// hetzelfde "eigen portfolio van het bureau"-scherm, niet bij God View (cross-agency, nog
// gebouwd:false) en niet bij cross-channel (blijft binnen 1 klant).

import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { heeftTenminste } from "@/lib/chat/toegang";
import { lijstAccountsMetSops } from "@/lib/tenancy/sop-dekking";
import { runPortfolioSynthesis, SECTION } from "@/lib/analysis/portfolio-synthesis";
import { getOpenRouterKey } from "@/lib/analysis/helpers";
import { lastCompleteMonth } from "@/lib/period/period-range";
import { today } from "@/lib/reporting-date";

function periodBounds(): { start: string; end: string } {
  const month = lastCompleteMonth();
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0, 10);
  return { start, end };
}

async function resolveAgencyAndLicence(admin: ReturnType<typeof getSupabaseAdmin>, agencyId: string) {
  const { data: bureau, error } = await admin!
    .from("agencies")
    .select("licentie")
    .eq("id", agencyId)
    .maybeSingle();
  if (error || !bureau) return null;
  return bureau;
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0];
  if (!agencyId) return Response.json({ error: "Geen bureau gekoppeld aan deze gebruiker" }, { status: 403 });

  const { data } = await admin
    .from("agency_analysis_output")
    .select("output, analysis_date")
    .eq("agency_id", agencyId)
    .eq("section", SECTION)
    .order("analysis_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.output) return Response.json({ synthesis: null, analysisDate: null });
  try {
    return Response.json({ synthesis: JSON.parse(String(data.output)), analysisDate: data.analysis_date });
  } catch {
    return Response.json({ synthesis: null, analysisDate: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY ontbreekt server-side" }, { status: 500 });

  const agencyId = auth.agencyIds[0];
  if (!agencyId) return Response.json({ error: "Geen bureau gekoppeld aan deze gebruiker" }, { status: 403 });

  const bureau = await resolveAgencyAndLicence(admin, agencyId);
  if (!bureau) return Response.json({ error: "Bureau niet gevonden" }, { status: 403 });
  if (!heeftTenminste(bureau.licentie, "growth")) {
    return Response.json(
      { error: "Portfolio-synthese is vanaf de Growth-tier inbegrepen. Upgrade om dit te gebruiken." },
      { status: 403 }
    );
  }

  const apiKey = getOpenRouterKey();
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY niet geconfigureerd" }, { status: 500 });

  const clientIds = await lijstAccountsMetSops(admin, agencyId);
  if (clientIds == null) return Response.json({ error: "Kon de portfolio niet ophalen" }, { status: 500 });

  const { data: accountRows } = await admin
    .from("accounts")
    .select("client_id, name")
    .eq("agency_id", agencyId)
    .in("client_id", clientIds.length > 0 ? clientIds : [""]);
  const clients = (accountRows ?? []).map((r) => ({ clientId: String(r.client_id), clientName: String(r.name ?? r.client_id) }));

  const { start, end } = periodBounds();

  try {
    const result = await runPortfolioSynthesis({
      supabase: admin,
      apiKey,
      agencyId,
      clients,
      analysisDate: today(),
      periodStart: start,
      periodEnd: end,
    });

    if (result.skipped) {
      return Response.json({ skipped: true, reason: result.reason }, { status: 409 });
    }
    return Response.json({
      skipped: false,
      synthesis: result.result,
      model: result.model,
      tokensUsed: result.tokensUsed,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Portfolio-synthese mislukt" }, { status: 500 });
  }
}
