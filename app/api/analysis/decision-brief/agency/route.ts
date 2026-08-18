// Document 2: Agency Portfolio Brief (masterplan 17.22). Bureaubreed managementoverzicht --
// toont alle klanten van het bureau naast elkaar. Losse route van het klantdocument: dit mag
// meerdere accounts tonen, het klantdocument mag dat nooit.

import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { generateAgencyPortfolioBrief, renderAgencyPortfolioBriefMarkdown } from "@/lib/analysis/decision-brief";
import { renderAgencyPortfolioBriefPdf } from "@/lib/analysis/decision-brief-pdf-renderer";

/** GET /api/analysis/decision-brief/agency?agency_id=xxx&format=pdf|md (default pdf) */
export async function GET(request: NextRequest) {
  const auth = await requireCapability("client:read");
  if (auth instanceof Response) return auth;

  const agencyId = request.nextUrl.searchParams.get("agency_id") || auth.agencyIds[0];
  if (!agencyId) return Response.json({ error: "agency_id parameter vereist (of geen bureau gekoppeld aan deze gebruiker)" }, { status: 400 });
  if (!auth.agencyIds.includes(agencyId)) return Response.json({ error: "Onvoldoende rechten" }, { status: 403 });

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const format = request.nextUrl.searchParams.get("format") === "md" ? "md" : "pdf";

  const brief = await generateAgencyPortfolioBrief(supabase, agencyId);
  if (!brief) return Response.json({ error: "Geen bureau of geen enkele klant met een geldige monthly analyse gevonden" }, { status: 404 });

  if (format === "md") {
    return new Response(renderAgencyPortfolioBriefMarkdown(brief), {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="agency-portfolio-brief-${brief.generatedAt}.md"` },
    });
  }
  const pdfBuffer = await renderAgencyPortfolioBriefPdf(brief);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="agency-portfolio-brief-${brief.generatedAt}.pdf"` },
  });
}
