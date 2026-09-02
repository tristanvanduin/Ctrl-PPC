// Document 1: Client Decision Brief (masterplan 17.22-17.23). Naslagwerk voor de specialist,
// intern bij het bureau -- gaat niet ongefilterd naar de eindklant (die krijgt de bestaande
// maandrapportage). Losse route van het bureaudocument, met eigen toegangscontrole per klant.
//
// Een falende databron is hier een 500 die de bron noemt (dataFoutNaarResponse), geen 404
// "geen analyse": die twee zagen er eerder hetzelfde uit, en dan blijft een kapotte kolom
// maandenlang onzichtbaar achter een geloofwaardige melding.

import { NextRequest } from "next/server";
import { requireClientAccess } from "@/lib/auth/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { dataFoutNaarResponse } from "@/lib/analysis/db-veilig";
import { opsomming } from "@/lib/util/tekst";
import {
  GECONTROLEERDE_KANALEN,
  generateClientDecisionBrief,
  renderClientDecisionBriefMarkdown,
  type ClientDecisionBrief,
} from "@/lib/analysis/decision-brief";
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

  let brief: ClientDecisionBrief | null;
  try {
    brief = await generateClientDecisionBrief(supabase, clientId);
  } catch (e) {
    const dataFout = dataFoutNaarResponse(e);
    if (dataFout) return dataFout;
    return Response.json(
      { error: "Decision brief kon niet worden opgebouwd", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  if (!brief) {
    return Response.json(
      { error: `Geen maandanalyse (structured_monthly_v2) gevonden voor deze klant. Gecontroleerd: ${opsomming(GECONTROLEERDE_KANALEN)}.` },
      { status: 404 }
    );
  }

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
