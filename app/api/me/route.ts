// De eigen identiteit, rol, rechten en beurs-scope, voor de UI-gating (useAccess).
//
// WAAROM DIT GEEN 401 GEEFT ZOLANG DE AUTH UIT STAAT
//
// Eerder viel dit endpoint terug op requireUser, wat zonder sessie een 401 oplevert. Dat is
// correct als de enforcement aan staat, maar zolang O1_AUTH_ENFORCED uit staat is er per
// definitie geen sessie en is er ook niets mis. Het gevolg was een rode fout in de console op
// ELKE pagina — en zulke ruis verbergt de fouten die er wel toe doen. Bij de rondgang langs de
// tabbladen stonden er achttien van deze meldingen tussen de echte vondsten.
//
// Nu is de toestand expliciet in het antwoord in plaats van verstopt in een statuscode. Dat
// leest ook beter: de client hoeft niet uit "401" af te leiden dat de beveiliging uit staat.

import { getAuthUser } from "@/lib/auth/server";

function enforced(): boolean {
  return process.env.O1_AUTH_ENFORCED === "true";
}

export async function GET() {
  const auth = await getAuthUser();

  if (!auth) {
    // Zonder enforcement: geen sessie is de normale toestand, geen fout.
    if (!enforced()) {
      return Response.json({ enforced: false, id: null, email: null, role: null, capabilities: [], scope: [] });
    }
    return Response.json({ enforced: true, error: "Niet ingelogd" }, { status: 401 });
  }

  return Response.json({
    enforced: enforced(),
    id: auth.id,
    email: auth.email,
    role: auth.role,
    capabilities: auth.capabilities,
    // "all" of een lijst. Dat onderscheid moet bewaard blijven: bij een nieuwe beurs is
    // "alle beurzen" iets anders dan "toevallig deze beurzen".
    scope: auth.scope,
  });
}
