// Document 1: Client Decision Brief (masterplan 17.22). Veilig om rechtstreeks met de klant zelf
// te delen -- bevat nooit data of namen van andere accounts (zie anonymizePatternText() in
// lib/analysis/decision-brief.ts). Losse route van het bureaudocument, met eigen toegangscontrole
// per klant.

import { NextRequest } from "next/server";
import { requireClientAccess } from "@/lib/auth/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { generateClientDecisionBrief, renderClientDecisionBriefMarkdown } from "@/lib/analysis/decision-brief";
import { renderClientDecisionBriefPdf } from "@/lib/analysis/decision-brief-pdf-renderer";

/** GET /api/analysis/decision-brief/client?client_id=xxx&format=pdf|md (default pdf) */
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  if (!clientId) return Response.json({ error: "client_id parameter vereist" }, { status: 400 });

  const auth = await requireClientAccess("client:read", clientId);
  if (auth instanceof Response) return auth;

  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const format = request.nextUrl.searchParams.get("format") === "md" ? "md" : "pdf";

  const brief = await generateClientDecisionBrief(supabase, clientId);
  if (!brief) return Response.json({ error: "Geen monthly analyse (structured_monthly_v2) gevonden voor deze klant" }, { status: 404 });

  if (format === "md") {
    return new Response(renderClientDecisionBriefMarkdown(brief), {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="decision-brief-${clientId}.md"` },
    });
  }
  const pdfBuffer = await renderClientDecisionBriefPdf(brief);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="decision-brief-${clientId}.pdf"` },
  });
}
