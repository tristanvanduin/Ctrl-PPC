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
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function enforced(): boolean {
  return process.env.O1_AUTH_ENFORCED === "true";
}

// Whitelabel_actief staat op agencies, en agencies is geen tabel die de browser met de anon-
// sleutel rechtstreeks leest (geen client_id, dus buiten het gebruikelijke RLS-patroon). Deze
// ene lookup gaat daarom via de service-role, zoals de rest van /api/admin/* al doet -- maar
// hier voor precies één rij, gescopet op de eigen bureaus van de ingelogde gebruiker, niet als
// beheerdersactie.
async function whitelabelActief(agencyIds: string[]): Promise<boolean> {
  if (agencyIds.length === 0) return false;
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const { data } = await admin.from("agencies").select("whitelabel_actief").in("id", agencyIds);
  return (data ?? []).some((r) => (r as { whitelabel_actief: boolean }).whitelabel_actief);
}

export async function GET() {
  const auth = await getAuthUser();

  if (!auth) {
    // Zonder enforcement: geen sessie is de normale toestand, geen fout.
    if (!enforced()) {
      return Response.json({
        enforced: false, id: null, email: null, role: null, capabilities: [], scope: [],
        agencyId: null, whitelabelActief: false,
      });
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
    // Voor de white-label-logoresolutie in de zijbalk. Bij lidmaatschap van meerdere bureaus
    // wint het eerste -- in de praktijk heeft een gebruiker er precies één.
    agencyId: auth.agencyIds[0] ?? null,
    whitelabelActief: await whitelabelActief(auth.agencyIds),
  });
}
