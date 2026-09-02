// Document 2: Agency Portfolio Brief (masterplan 17.22). Bureaubreed managementoverzicht --
// toont alle klanten van het bureau naast elkaar. Losse route van het klantdocument: dit mag
// meerdere accounts tonen, het klantdocument mag dat nooit.
//
// Een falende databron is een 500 die de bron noemt (dataFoutNaarResponse); een 404 betekent
// alleen nog "bureau onbekend of geen klant met SOP's aan". Klanten zonder analyse staan in
// het document zelf, onder "Zonder analyse".

import { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { dataFoutNaarResponse } from "@/lib/analysis/db-veilig";
import { opsomming } from "@/lib/util/tekst";
import {
  GECONTROLEERDE_KANALEN,
  generateAgencyPortfolioBrief,
  renderAgencyPortfolioBriefMarkdown,
  type AgencyPortfolioBrief,
} from "@/lib/analysis/decision-brief";
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

  let brief: AgencyPortfolioBrief | null;
  try {
    brief = await generateAgencyPortfolioBrief(supabase, agencyId);
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    return Response.json(
      { error: "Agency portfolio brief kon niet worden opgebouwd", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  if (!brief) {
    return Response.json(
      { error: `Bureau niet gevonden, of geen enkele klant met SOP's aan. Maandanalyses worden gezocht op ${opsomming(GECONTROLEERDE_KANALEN)}.` },
      { status: 404 }
    );
  }

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
