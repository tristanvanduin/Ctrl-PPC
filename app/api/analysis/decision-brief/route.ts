// Decision Brief-export (masterplan 17.21): compact, deterministisch beslisdocument naast het
// bestaande volledige SOP-rapport (/api/analysis/pdf). Bouwt op wat al bestaat -- geen nieuwe
// LLM-call, alleen een nieuwe render van final_sop/operating_detail die de pijplijn toch al
// opslaat, plus optioneel de portfolio-synthese van het bureau.

import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { canAccessClient } from "@/lib/auth/roles";
import { getSupabase } from "@/lib/analysis/helpers";
import { buildDecisionBrief, renderDecisionBriefMarkdown, type ClientBriefInput } from "@/lib/analysis/decision-brief";
import { renderDecisionBriefPdf } from "@/lib/analysis/decision-brief-pdf-renderer";
import type { FinalSopSynthesis, OperatingDetailLayer } from "@/lib/analysis/monthly-structured";
import type { PortfolioSynthesisResult } from "@/lib/analysis/portfolio-synthesis";

interface StructuredPayload {
  final_sop?: FinalSopSynthesis;
  operating_detail?: OperatingDetailLayer;
}

/**
 * GET /api/analysis/decision-brief?client_ids=a,b,c&agency_id=xxx&format=pdf|md
 *
 * client_ids: comma-gescheiden lijst, elk moet de laatste monthly structured_monthly_v2 hebben
 *   (dezelfde bron als het volledige SOP-rapport). Klanten zonder final_sop worden overgeslagen,
 *   niet met een gok gevuld.
 * agency_id: optioneel. Als gezet, wordt de laatste portfolio_synthesis_v1 van dat bureau erbij
 *   gehaald voor Deel 1's cross-account-sectie. Zonder agency_id blijft die sectie leeg (eerlijk,
 *   geen verzonnen portfolio-synthese voor een los account).
 * format: "pdf" (default) of "md".
 */
export async function GET(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const clientIdsParam = request.nextUrl.searchParams.get("client_ids");
  const agencyId = request.nextUrl.searchParams.get("agency_id");
  const format = request.nextUrl.searchParams.get("format") === "md" ? "md" : "pdf";

  if (!clientIdsParam) return Response.json({ error: "client_ids parameter vereist (comma-gescheiden)" }, { status: 400 });
  const requestedClientIds = clientIdsParam.split(",").map((id) => id.trim()).filter(Boolean);
  if (requestedClientIds.length === 0) return Response.json({ error: "client_ids parameter is leeg" }, { status: 400 });

  // Zelfde regel als requireClientAccess elders: onbevoegde klanten stil laten vallen in plaats
  // van een 403 die verklapt of de klant bestaat.
  const clientIds = requestedClientIds.filter((id) => canAccessClient(auth.scope, id));
  if (clientIds.length === 0) return Response.json({ error: "Geen van de opgegeven klanten is toegankelijk" }, { status: 403 });

  const clientNameRows = await supabase.from("accounts").select("client_id, name").in("client_id", clientIds);
  const nameByClientId = new Map((clientNameRows.data ?? []).map((r) => [String(r.client_id), String(r.name ?? r.client_id)]));

  const structuredRows = await Promise.all(
    clientIds.map(async (clientId) => {
      const { data } = await supabase
        .from("sop_analysis_output")
        .select("output")
        .eq("client_id", clientId)
        .eq("sop_type", "monthly")
        .eq("section", "structured_monthly_v2")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data?.output) return null;
      try {
        const parsed = (typeof data.output === "string" ? JSON.parse(data.output) : data.output) as StructuredPayload;
        if (!parsed.final_sop) return null;
        return { clientId, finalSop: parsed.final_sop, operatingDetail: parsed.operating_detail };
      } catch {
        return null;
      }
    })
  );

  const clients: ClientBriefInput[] = structuredRows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({
      accountName: nameByClientId.get(r.clientId) ?? r.clientId,
      finalSop: r.finalSop,
      operatingDetail: r.operatingDetail,
    }));

  if (clients.length === 0) {
    return Response.json({ error: "Geen enkele opgegeven klant heeft een monthly structured_monthly_v2-analyse" }, { status: 404 });
  }

  let portfolio: PortfolioSynthesisResult | null = null;
  if (agencyId) {
    const { data } = await supabase
      .from("agency_analysis_output")
      .select("output")
      .eq("agency_id", agencyId)
      .eq("section", "portfolio_synthesis_v1")
      .order("analysis_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.output) {
      try {
        portfolio = (typeof data.output === "string" ? JSON.parse(data.output) : data.output) as PortfolioSynthesisResult;
      } catch {
        portfolio = null;
      }
    }
  }

  const brief = buildDecisionBrief(clients, portfolio);

  if (format === "md") {
    return new Response(renderDecisionBriefMarkdown(brief), {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="decision-brief-${brief.generatedAt}.md"` },
    });
  }

  const pdfBuffer = await renderDecisionBriefPdf(brief);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="decision-brief-${brief.generatedAt}.pdf"` },
  });
}
